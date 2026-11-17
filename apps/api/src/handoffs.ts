import {
  fillHandoffTemplates,
  handoffTemplateDefaults,
  handoffTitle,
  isValidHandoffBranch,
} from "../../../packages/shared/handoff-templates.ts";
import { startHandoffRequestSchema } from "../../../packages/shared/handoffs.ts";
import { randomUUID } from "node:crypto";
import type {
  DetectToolsResult,
  Handoff,
  HandoffStartRoute,
  StartHandoffRequest,
  StartHandoffResult,
  ReadHandoffStatesRequest,
  ReadHandoffStatesResult,
  ListThreadsRequest,
  ListThreadsResult,
} from "../../../packages/shared/handoffs.ts";
import {
  sameThread,
  selectThreadOffers,
  type HandoffAdoptRoute,
  type HandoffThreadDismissal,
  type HandoffThreadOffer,
  type ListedHandoffThread,
} from "../../../packages/shared/handoff-threads.ts";
import type { AppApiStorage } from "./storage.ts";
import type { ApiEvents } from "./events.ts";
import { adoptHandoff, shouldRefresh, startHandoff } from "./handoff-state.ts";
import { createHookToken } from "./handoff-hooks.ts";

/** A saved connection as a handoff operation receives it: no secrets. */
export interface HandoffConnection {
  id: string;
  pluginId: string;
  label: string;
  tenantLabel: string;
  autoSync: boolean;
  autoSyncIntervalMinutes: number;
  connectedAt: number;
  lastSyncAt?: number;
  lastError?: string;
  config: Record<string, string | number | boolean>;
  access?: string[];
}

interface HandoffTool {
  id: string;
  label?: string;
  connection?: "required" | "none";
  listsThreads?: boolean;
}

interface Options {
  storage: AppApiStorage;
  plugins: {
    listPlugins(): Promise<
      Array<{
        id: string;
        capabilities: {
          handoff?: { promptTemplate?: string; tools: HandoffTool[] };
        };
      }>
    >;
    detectTools?(
      pluginId: string,
      projectId: string,
      connection?: HandoffConnection,
    ): Promise<DetectToolsResult>;
    startHandoff(
      pluginId: string,
      request: StartHandoffRequest,
      projectId: string,
      connection?: HandoffConnection,
    ): Promise<StartHandoffResult>;
    readHandoffStates(
      pluginId: string,
      request: ReadHandoffStatesRequest,
      projectId: string,
      connection?: HandoffConnection,
    ): Promise<ReadHandoffStatesResult>;
    listThreads?(
      pluginId: string,
      request: ListThreadsRequest,
      projectId: string,
      connection?: HandoffConnection,
    ): Promise<ListThreadsResult>;
  };
  /**
   * The plugin's saved connection, for an operation, or undefined when it
   * no longer exists. Throws when it can't be used now, such as while its
   * secrets can't be read.
   */
  connection?(
    pluginId: string,
    connectionId: string,
  ): Promise<HandoffConnection | undefined>;
  /**
   * Why the plugin's handoffs can't run now, such as the plugin being off,
   * in words that end "before <action>", by default "refreshing it".
   */
  unavailableReason?(
    pluginId: string,
    toolId: string,
    action?: string,
  ): Promise<string | undefined>;
  onChange(records: Handoff[]): void;
  /**
   * The loopback URL a handoff's hooks post to, with its token (#726).
   * Without it, starts carry no hook.
   */
  hookUrl?(id: string, token: string): string;
  /** Runs when a handoff is removed, so its hook state goes with it. */
  onRemove?(id: string): void;
  events?: ApiEvents;
  now?: () => number;
  /** Handoffs per `readHandoffStates` call. Tests make it small. */
  refreshBatchSize?: number;
}

/**
 * 100 handoffs, each with at most a 4 KB native result plus title, branch and
 * pull requests, keep a refresh answer far below the runtime's 8 MiB result
 * limit (`MAX_PLUGIN_RESULT_BYTES`).
 */
export const REFRESH_BATCH_SIZE = 100;

/**
 * How long a tool's thread listing in a folder answers every item page
 * before the tool is asked again, failed or not.
 */
export const THREAD_LISTING_INTERVAL_MS = 5 * 60_000;
/** Threads asked of a tool per folder, changed within the last 30 days. */
const THREAD_LISTING_LIMIT = 50;
const THREAD_LISTING_WINDOW_MS = 30 * 86_400_000;
/**
 * Link takes a thread from a listing at most this old. An item page left
 * open longer reopens the item, which lists again.
 */
export const THREAD_LINK_MAX_AGE_MS = 30 * 60_000;

interface ThreadListing {
  at: number;
  threads: ListedHandoffThread[];
  failed: boolean;
}

export class HandoffRefused extends Error {}
export class HandoffTemplateRefused extends HandoffRefused {}

/** Why a tool that uses a connection has none to run with. */
const pickConnection = (tool: HandoffTool) =>
  `Pick a connection for ${tool.label ?? tool.id} in its settings on the plugin's page.`;
const DELETED_CONNECTION =
  "The connection this handoff ran through was deleted.";
/** A handoff started before its tool used a connection can't go on. */
export const HANDOFF_NEEDS_CONNECTION =
  "This tool now hands off through a connection. Start a new handoff.";

/** Local handoffs and refresh scheduling. The host owns project scope. */
export class Handoffs {
  private readonly options: Options;
  private readonly now: () => number;
  private visible = false;
  private ticking = false;
  private refreshing?: Promise<unknown>;
  private lastPublished?: string;
  /**
   * Each tool's last listing per folder and connection, by `listingKey`,
   * kept in memory: the offers on item pages come from it, and Link takes
   * the thread from it, never from the window.
   */
  private readonly listings = new Map<
    string,
    ThreadListing | Promise<ThreadListing>
  >();
  constructor(options: Options) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  async publish(force = false) {
    const records = await this.options.storage.listHandoffs();
    const visible = JSON.stringify(
      records.map(({ checkedAt: _checkedAt, ...record }) => record),
    );
    if (force || visible !== this.lastPublished) {
      this.lastPublished = visible;
      this.options.onChange(records);
    }
  }
  async start(input: HandoffStartRoute): Promise<Handoff> {
    const folder = (
      await this.options.storage.listRepositoryFolders(input.projectId)
    ).find((f) => f.id === input.folderId);
    if (!folder)
      throw new HandoffRefused(
        "This repository folder is no longer available.",
      );
    const plugin = (await this.options.plugins.listPlugins()).find(
      (p) => p.id === input.pluginId,
    );
    const tool = plugin?.capabilities.handoff?.tools.find(
      (t) => t.id === input.toolId,
    );
    if (!plugin?.capabilities.handoff || !tool)
      throw new HandoffRefused("This handoff tool is not available.");
    const connection = await this.startConnection(input, tool);
    const templates =
      (await this.options.storage.getHandoffTemplates(input.pluginId)) ??
      handoffTemplateDefaults(plugin.capabilities.handoff.promptTemplate);
    const filled = fillHandoffTemplates(templates, {
      ...input,
      repoName: folder.name,
    });
    const branch = input.branchOverride ?? filled.branch;
    if (branch && (branch.length > 500 || !isValidHandoffBranch(branch)))
      throw new HandoffTemplateRefused(
        "The branch template produces an invalid git branch. Edit the branch template or leave it empty for no worktree.",
      );
    // An empty title (an empty template, or a slot the item doesn't have)
    // falls back to the item's own title; an empty prompt can't be sent.
    const title =
      handoffTitle(filled.title).trim() ||
      handoffTitle(input.item.title).trim() ||
      input.item.key;
    const prompt = input.promptOverride ?? filled.prompt;
    if (!prompt.trim())
      throw new HandoffTemplateRefused(
        "The prompt template produces an empty prompt for this item. Edit the prompt template.",
      );
    // The id and hook token exist before the start, so the tool can be
    // given the URL; only a start that succeeds keeps them.
    const id = randomUUID();
    const hook = this.options.hookUrl ? createHookToken() : undefined;
    const request = startHandoffRequestSchema.parse({
      tool: input.toolId,
      folder: { id: folder.id, name: folder.name },
      title,
      ...(branch ? { branch } : {}),
      prompt,
      item: { key: input.item.key, url: input.item.url },
      settings: input.settings,
      ...(hook ? { hook: { url: this.options.hookUrl!(id, hook.token) } } : {}),
    });
    let result: StartHandoffResult;
    try {
      result = await this.options.plugins.startHandoff(
        input.pluginId,
        request,
        input.projectId,
        ...(connection ? [connection] : []),
      );
    } catch (error) {
      throw new HandoffRefused(
        error instanceof Error
          ? error.message
          : "The tool refused the handoff.",
      );
    }
    const { pluginId, toolId, workItemId, projectId, folderId } = input;
    const record = startHandoff(
      {
        id,
        pluginId,
        toolId,
        workItemId,
        projectId,
        folderId,
        ...(connection ? { connectionId: connection.id } : {}),
        title: request.title,
        branch: request.branch,
      },
      result,
      this.now(),
    );
    await this.options.storage.addHandoff(record, hook?.tokenHash);
    await this.options.storage
      .useRepositoryFolder(input.projectId, input.folderId)
      .catch(() => undefined);
    await this.publish();
    return record;
  }
  /**
   * The connection a start runs through: the one the route names, else the
   * one the tool's settings picked, else the plugin's only connection. A
   * tool that uses none gets none.
   */
  private async startConnection(
    input: HandoffStartRoute,
    tool: HandoffTool,
  ): Promise<HandoffConnection | undefined> {
    if (tool.connection !== "required") {
      if (input.connectionId)
        throw new HandoffRefused(
          `${tool.label ?? tool.id} uses no connection.`,
        );
      return undefined;
    }
    const connectionId =
      input.connectionId ??
      (await this.pickedConnection(input.pluginId, tool.id));
    if (!connectionId) throw new HandoffRefused(pickConnection(tool));
    let connection: HandoffConnection | undefined;
    try {
      connection = await this.options.connection?.(
        input.pluginId,
        connectionId,
      );
    } catch (error) {
      throw new HandoffRefused(
        error instanceof Error
          ? error.message
          : "This connection can't be used now.",
      );
    }
    if (!connection)
      throw new HandoffRefused("This connection no longer exists.");
    return connection;
  }
  /** The connection the tool's settings picked, else the plugin's only one. */
  private async pickedConnection(pluginId: string, toolId: string) {
    const picked = (
      await this.options.storage.getHandoffToolConnections(pluginId)
    )[toolId];
    if (picked) return picked;
    const connections = await this.options.storage.listConnections(pluginId);
    return connections.length === 1 ? connections[0]!.id : undefined;
  }
  /**
   * Which of the plugin's tools this computer has. Tools without a
   * connection are detected together, as before; each connection the tools'
   * settings picked is detected for its own tools. A connection that fails
   * marks only its tools missing, with why.
   */
  async detect(
    pluginId: string,
    projectId: string,
  ): Promise<DetectToolsResult> {
    const detectTools = this.options.plugins.detectTools?.bind(
      this.options.plugins,
    );
    if (!detectTools) throw new HandoffRefused("Detection is unavailable.");
    const plugin = (await this.options.plugins.listPlugins()).find(
      (p) => p.id === pluginId,
    );
    const tools = plugin?.capabilities.handoff?.tools ?? [];
    const connected = tools.filter((tool) => tool.connection === "required");
    if (!connected.length) return detectTools(pluginId, projectId);
    const plain = new Set(
      tools.filter((tool) => tool.connection !== "required").map((t) => t.id),
    );
    const found: DetectToolsResult["tools"] = [];
    if (plain.size)
      found.push(
        ...(await detectTools(pluginId, projectId)).tools.filter((tool) =>
          plain.has(tool.id),
        ),
      );
    const groups = new Map<string, HandoffTool[]>();
    const unpicked: HandoffTool[] = [];
    for (const tool of connected) {
      const connectionId = await this.pickedConnection(pluginId, tool.id);
      if (!connectionId) unpicked.push(tool);
      else
        groups.set(connectionId, [...(groups.get(connectionId) ?? []), tool]);
    }
    for (const [connectionId, group] of groups) {
      const ids = new Set(group.map((tool) => tool.id));
      try {
        const connection = await this.options.connection?.(
          pluginId,
          connectionId,
        );
        if (!connection) throw new Error("This connection no longer exists.");
        const answer = await detectTools(pluginId, projectId, connection);
        found.push(...answer.tools.filter((tool) => ids.has(tool.id)));
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Detection failed.";
        found.push(
          ...group.map((tool) => ({ id: tool.id, available: false, reason })),
        );
      }
    }
    found.push(
      ...unpicked.map((tool) => ({
        id: tool.id,
        available: false,
        reason: pickConnection(tool),
      })),
    );
    return { tools: found };
  }
  /**
   * The threads of the project's repository folders whose title names one
   * of the item's keys, from each tool that lists its threads. A tool lists
   * a folder at most once every `THREAD_LISTING_INTERVAL_MS`, so opening
   * items reads the last listing. Threads linked to any handoff, and those
   * dismissed for this item, aren't offered. Refuses an item whose handoffs
   * are all in another project (`checkItemProject`).
   */
  async findThreads(
    projectId: string,
    workItemId: string,
    keys: readonly string[],
  ): Promise<{ offers: HandoffThreadOffer[]; listed: number; failed: number }> {
    await this.checkItemProject(workItemId, projectId);
    if (!keys.some(Boolean) || !this.options.plugins.listThreads)
      return { offers: [], listed: 0, failed: 0 };
    const folders = await this.options.storage.listRepositoryFolders(projectId);
    if (!folders.length) return { offers: [], listed: 0, failed: 0 };
    const threads: ListedHandoffThread[] = [];
    let listed = 0;
    let failed = 0;
    for (const plugin of await this.options.plugins.listPlugins()) {
      for (const tool of plugin.capabilities.handoff?.tools ?? []) {
        if (!tool.listsThreads) continue;
        if (await this.options.unavailableReason?.(plugin.id, tool.id))
          continue;
        let connection: HandoffConnection | undefined;
        if (tool.connection === "required") {
          const connectionId = await this.pickedConnection(plugin.id, tool.id);
          if (!connectionId) continue;
          connection = await this.options
            .connection?.(plugin.id, connectionId)
            .catch(() => undefined);
          if (!connection) continue;
        }
        // One folder at a time: a plugin runs few commands at once.
        for (const folder of folders) {
          const listing = await this.listing(
            plugin.id,
            tool.id,
            folder.id,
            projectId,
            connection,
          );
          if (listing.fresh) {
            listed++;
            if (listing.failed) failed++;
          }
          threads.push(...listing.threads);
        }
      }
    }
    return {
      offers: selectThreadOffers({
        keys,
        workItemId,
        threads,
        handoffs: await this.options.storage.listHandoffs(),
        dismissals: await this.options.storage.listHandoffThreadDismissals(),
      }),
      listed,
      failed,
    };
  }
  /** The tool's listing of one folder: the last one while recent, else a new one. */
  private async listing(
    pluginId: string,
    toolId: string,
    folderId: string,
    projectId: string,
    connection: HandoffConnection | undefined,
  ): Promise<ThreadListing & { fresh: boolean }> {
    const key = listingKey(pluginId, toolId, folderId, connection?.id);
    const cached = this.listings.get(key);
    if (cached instanceof Promise) return { ...(await cached), fresh: false };
    const now = this.now();
    if (cached && now - cached.at < THREAD_LISTING_INTERVAL_MS)
      return { ...cached, fresh: false };
    const pending = this.options.plugins.listThreads!(
      pluginId,
      {
        tool: toolId,
        folder: { id: folderId },
        since: now - THREAD_LISTING_WINDOW_MS,
        limit: THREAD_LISTING_LIMIT,
      },
      projectId,
      ...(connection ? [connection] : []),
    ).then(
      (result): ThreadListing => ({
        at: now,
        failed: false,
        threads: result.threads.map((thread) => ({
          ...thread,
          pluginId,
          toolId,
          folderId,
          ...(connection ? { connectionId: connection.id } : {}),
        })),
      }),
      // The plugin operation's event holds why; the item page offers none.
      (): ThreadListing => ({ at: now, failed: true, threads: [] }),
    );
    this.listings.set(key, pending);
    const listing = await pending;
    this.listings.set(key, listing);
    return { ...listing, fresh: true };
  }
  /**
   * Links a listed thread to an item, as a handoff whose state is unknown
   * until it is refreshed, right away. The thread comes from the tool's
   * last listing of that folder, so the window names only a thread a tool
   * listed, and only while the tool can still list threads and the listing
   * is at most `THREAD_LINK_MAX_AGE_MS` old, and never into a project other
   * than the item's handoffs' (`checkItemProject`).
   */
  async adopt(input: HandoffAdoptRoute): Promise<Handoff> {
    await this.checkItemProject(input.workItemId, input.projectId);
    const folder = (
      await this.options.storage.listRepositoryFolders(input.projectId)
    ).find((f) => f.id === input.folderId);
    if (!folder)
      throw new HandoffRefused(
        "This repository folder is no longer available.",
      );
    const tool = (await this.options.plugins.listPlugins())
      .find((p) => p.id === input.pluginId)
      ?.capabilities.handoff?.tools.find((t) => t.id === input.toolId);
    if (!tool?.listsThreads)
      throw new HandoffRefused("This handoff tool is not available.");
    const unavailable = await this.options.unavailableReason?.(
      input.pluginId,
      input.toolId,
      "linking its threads",
    );
    if (unavailable) throw new HandoffRefused(unavailable);
    const cached = this.listings.get(
      listingKey(
        input.pluginId,
        input.toolId,
        input.folderId,
        input.connectionId,
      ),
    );
    const listing = cached instanceof Promise ? undefined : cached;
    const thread = listing?.threads.find((t) => t.threadId === input.threadId);
    if (!listing || !thread)
      throw new HandoffRefused(
        "This thread is no longer listed. Open the item again to look for it.",
      );
    if (this.now() - listing.at > THREAD_LINK_MAX_AGE_MS)
      throw new HandoffRefused(
        "The threads were found too long ago. Open the item again to look for them.",
      );
    const linked = (await this.options.storage.listHandoffs()).some((h) =>
      sameThread(h, thread),
    );
    if (linked)
      throw new HandoffRefused("This thread is already linked to an item.");
    const record = adoptHandoff(
      {
        id: randomUUID(),
        workItemId: input.workItemId,
        projectId: input.projectId,
      },
      thread,
      this.now(),
    );
    await this.options.storage.addHandoff(record);
    await this.publish();
    await this.refresh(record.id);
    return (
      (await this.options.storage.listHandoffs()).find(
        (h) => h.id === record.id,
      ) ?? record
    );
  }
  /**
   * Items live only in the window, so the API takes an item's project from
   * the window. What it can check is the item's own handoffs: when the
   * item has some and none is in `projectId`, the window named the item
   * with another project's, and its keys would be matched against that
   * project's threads. An item moved to another project after its handoffs
   * started finds threads there once one handoff is there.
   */
  private async checkItemProject(workItemId: string, projectId: string) {
    const projects = new Set(
      (await this.options.storage.listHandoffs())
        .filter((handoff) => handoff.workItemId === workItemId)
        .map((handoff) => handoff.projectId),
    );
    if (projects.size && !projects.has(projectId))
      throw new HandoffRefused("This item's threads are in another project.");
  }
  /** "Not this one": the thread is offered to that item no more. */
  async dismissThread(dismissal: HandoffThreadDismissal) {
    await this.options.storage.dismissHandoffThread(dismissal);
  }
  async remove(id: string) {
    await this.options.storage.removeHandoff(id);
    this.options.onRemove?.(id);
    await this.publish();
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.refresh(undefined, true);
    } finally {
      this.ticking = false;
    }
  }
  async refresh(id?: string, automatic = false) {
    return this.refreshRecords(
      (h) => id === undefined || h.id === id,
      automatic,
    );
  }
  /**
   * Refreshes one handoff because its tool's hook posted (#726): at once,
   * whatever the cadence, as a system job.
   */
  async refreshFromHook(id: string) {
    return this.refreshRecords((h) => h.id === id, false, "system");
  }
  /**
   * Refreshes the handoffs that ran through one connection, as when it was
   * deleted: they pause as unknown, with why.
   */
  async refreshConnection(pluginId: string, connectionId: string) {
    return this.refreshRecords(
      (h) => h.pluginId === pluginId && h.connectionId === connectionId,
      false,
    );
  }
  // Only one batch owns plugin state at a time. Manual work queues behind the
  // current batch, before the tick can enqueue its next batch.
  private async runBatch<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.refreshing;
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.refreshing = turn;
    await previous?.catch(() => undefined);
    try {
      return await run();
    } finally {
      release();
      if (this.refreshing === turn) this.refreshing = undefined;
    }
  }
  private async refreshRecords(
    selected: (record: Handoff) => boolean,
    automatic: boolean,
    trigger: "system" | "user" = automatic ? "system" : "user",
  ) {
    const now = this.now();
    const records = (await this.options.storage.listHandoffs()).filter(
      (h) =>
        selected(h) &&
        (!automatic ||
          (shouldRefresh(h, now) &&
            now - h.checkedAt >= (this.visible ? 30_000 : 120_000))),
    );
    const groups = new Map<string, Handoff[]>();
    for (const record of records) {
      // A session id is only meaningful on its own server, so each
      // connection reads its own handoffs.
      const key = JSON.stringify([
        record.pluginId,
        record.toolId,
        record.projectId,
        record.connectionId ?? null,
      ]);
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }
    const batches = [...groups.values()].flatMap((group) => {
      const batches: Handoff[][] = [];
      const size = this.options.refreshBatchSize ?? REFRESH_BATCH_SIZE;
      for (let i = 0; i < group.length; i += size)
        batches.push(group.slice(i, i + size));
      return batches;
    });
    const failures: Array<{
      pluginId: string;
      toolId: string;
      projectId: string;
      connectionId?: string;
      reason: string;
    }> = [];
    let succeeded = 0;
    for (const pending of batches) {
      await this.runBatch(async () => {
        const ids = new Set(pending.map((h) => h.id));
        const batch = (await this.options.storage.listHandoffs()).filter((h) =>
          ids.has(h.id),
        );
        if (!batch.length) return;
        const now = this.now();
        const first = batch[0]!;
        const openUnit = () => {
          const unit = this.options.events?.start("handoff.refresh", {
            kind: "job",
            trigger,
          });
          unit?.set({
            plugin: { id: first.pluginId },
            handoff: { tool: first.toolId, count: batch.length },
          });
          return unit;
        };
        let unit: ReturnType<typeof openUnit>;
        const failure = (reason: string) => ({
          pluginId: first.pluginId,
          toolId: first.toolId,
          projectId: first.projectId,
          ...(first.connectionId ? { connectionId: first.connectionId } : {}),
          reason,
        });
        try {
          const plugins = await this.options.plugins.listPlugins();
          const plugin = plugins.find((p) => p.id === first.pluginId);
          const tool = plugin?.capabilities.handoff?.tools.find(
            (t) => t.id === first.toolId,
          );
          let connection: HandoffConnection | undefined;
          const reason = !plugin
            ? "The handoff plugin is unavailable."
            : !tool
              ? "The handoff tool was removed."
              : ((await this.options.unavailableReason?.(
                  first.pluginId,
                  first.toolId,
                )) ??
                (tool.connection !== "required"
                  ? undefined
                  : !first.connectionId
                    ? HANDOFF_NEEDS_CONNECTION
                    : (connection = await this.options.connection?.(
                          first.pluginId,
                          first.connectionId,
                        ))
                      ? undefined
                      : DELETED_CONNECTION));
          if (
            automatic &&
            reason &&
            batch.every((h) => h.paused?.reason === reason)
          )
            return;
          unit = openUnit();
          if (reason) {
            const updates = batch
              .filter((h) => h.paused?.reason !== reason)
              .map((h) => ({
                id: h.id,
                state: "unknown" as const,
                native: h.native,
                paused: { reason, since: h.paused?.since ?? now },
              }));
            if (updates.length) {
              await this.options.storage.updateHandoffs(updates, now);
              await this.publish();
            }
            failures.push(failure(reason));
            unit?.refuse("refresh_failed");
            return;
          }
          const updates = await this.options.plugins.readHandoffStates(
            first.pluginId,
            {
              tool: first.toolId,
              handoffs: batch.map(({ id, threadId, folderId, native }) => ({
                id,
                threadId,
                folderId,
                native,
              })),
            },
            first.projectId,
            ...(connection ? [connection] : []),
          );
          await this.options.storage.updateHandoffs(updates, now);
          succeeded++;
          await this.publish();
        } catch (error) {
          // A transport failure is not a native state change. Retry at the normal cadence.
          await this.options.storage.updateHandoffs(
            batch.map((h) => ({
              id: h.id,
              state: h.state,
              native: h.native,
              paused: h.paused,
            })),
            now,
          );
          await this.publish();
          unit?.refuse("refresh_failed");
          failures.push(
            failure(
              error instanceof Error
                ? error.message
                : "The tool refused the refresh.",
            ),
          );
        } finally {
          unit?.end();
        }
      });
    }
    return { succeeded, failures };
  }
}

/** A listing is one tool's, in one folder, through one connection or none. */
function listingKey(
  pluginId: string,
  toolId: string,
  folderId: string,
  connectionId: string | undefined,
) {
  return JSON.stringify([pluginId, toolId, folderId, connectionId ?? null]);
}
