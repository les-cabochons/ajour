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
  HandoffFolderSettings,
  HandoffStartRefusal,
  HandoffStartRoute,
  StartHandoffRequest,
  StartHandoffResult,
  ReadHandoffStatesRequest,
  ReadHandoffStatesResult,
  ListThreadsRequest,
  ListThreadsResult,
  CloseThreadRequest,
  CloseThreadResult,
  HandoffCloseKind,
} from "../../../packages/shared/handoffs.ts";
import {
  sameThread,
  selectThreadOffers,
  type HandoffAdoptRoute,
  type HandoffThreadDismissal,
  type HandoffThreadOffer,
  type ListedHandoffThread,
  type ThreadIdentity,
} from "../../../packages/shared/handoff-threads.ts";
import type { AppApiStorage } from "./storage.ts";
import type { ApiEvents } from "./events.ts";
import { adoptHandoff, shouldRefresh, startHandoff } from "./handoff-state.ts";
import { createHookToken } from "./handoff-hooks.ts";
import { PluginOperationFailure } from "./plugin-operation-lifetime.ts";

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
  /** The tool's own settings, as its manifest declares them. */
  settings?: readonly {
    id: string;
    label: string;
    type: string;
    helpText?: string;
  }[];
  connection?: "required" | "none";
  listsThreads?: boolean;
  /** False for a tool that can only start a thread; true when absent. */
  followsState?: boolean;
  /** How the tool closes a thread (#850). Absent, it can't. */
  closesThreads?: HandoffCloseKind;
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
    /**
     * Never called for a tool with `followsState: false`, so a plugin whose
     * tools all have it may leave the export out.
     */
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
    /** Never called for a tool without `closesThreads`. */
    closeThread?(
      pluginId: string,
      request: CloseThreadRequest,
      projectId: string,
      connection?: HandoffConnection,
    ): Promise<CloseThreadResult>;
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

export class HandoffRefused extends Error {
  /** What the window can do about it beside the reason (#819). */
  readonly refusal?: Omit<HandoffStartRefusal, "error">;
  constructor(message: string, refusal?: Omit<HandoffStartRefusal, "error">) {
    super(message);
    if (refusal && Object.keys(refusal).length) this.refusal = refusal;
  }
}
export class HandoffTemplateRefused extends HandoffRefused {}
/** A start or link with a tool switched off (#760): `tool_off`. */
export class HandoffToolOff extends HandoffRefused {}

/** The settings among `settings` that the tool declares. */
function declaredSettings(
  settings: HandoffFolderSettings,
  declared: ReadonlySet<string>,
): HandoffFolderSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => declared.has(key)),
  );
}

/**
 * What the window can do about a refused start, from the plugin's hint
 * (#819). A branch that exists counts only when the start asked for one. A
 * setting counts only when it is one of the tool's text settings: the
 * window asks for it with its label, and a value the start sent is the one
 * refused.
 */
function startRefusal(
  error: unknown,
  tool: HandoffTool,
  request: StartHandoffRequest,
): Omit<HandoffStartRefusal, "error"> | undefined {
  const hint =
    error instanceof PluginOperationFailure ? error.handoffRefusal : undefined;
  if (!hint) return undefined;
  if ("branchExists" in hint)
    return request.branch ? { branchExists: true } : undefined;
  const field = tool.settings?.find(
    (candidate) => candidate.id === hint.setting && candidate.type === "text",
  );
  if (!field) return undefined;
  const value = request.settings[field.id];
  return {
    setting: {
      id: field.id,
      label: field.label,
      ...(field.helpText ? { helpText: field.helpText } : {}),
      ...(typeof value === "string" && value.length <= 500 ? { value } : {}),
    },
  };
}

/** Why a tool that uses a connection has none to run with. */
const pickConnection = (tool: HandoffTool) =>
  `Pick a connection for ${tool.label ?? tool.id} in its settings on the plugin's page.`;
const DELETED_CONNECTION =
  "The connection this handoff ran through was deleted.";
/**
 * Why a tool that is off can't do something new: only the plugin's page
 * turns it on (#760). Its handoffs keep refreshing and opening.
 */
const toolIsOff = (tool: HandoffTool, action: string) =>
  `${tool.label ?? tool.id} is off. Turn it on in the plugin's Handoff tools to ${action}.`;
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
  /**
   * When each thread was closed in its tool (#850), by `closedThreadKey`, so
   * a listing taken before the close, cached or under way, never offers it
   * again. Kept as long as Link accepts a listing.
   */
  private readonly closedThreads = new Map<string, number>();
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
    if (!(await this.enabledTools(input.pluginId)).has(tool.id))
      throw new HandoffToolOff(toolIsOff(tool, "hand off to it"));
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
    // given the URL; only a start that succeeds keeps them. A tool that
    // doesn't follow state gets none: a hook only makes Ajour read state.
    const id = randomUUID();
    const follows = tool.followsState !== false;
    const hook =
      this.options.hookUrl && follows ? createHookToken() : undefined;
    // The folder's remembered settings, then the route's own (#819). Only
    // settings the tool still declares count.
    const declared = new Set((tool.settings ?? []).map((field) => field.id));
    const named = declaredSettings(input.settings, declared);
    const settings = {
      ...declaredSettings(
        await this.options.storage.getHandoffFolderSettings(
          input.pluginId,
          tool.id,
          folder.id,
        ),
        declared,
      ),
      ...named,
    };
    const request = startHandoffRequestSchema.parse({
      tool: input.toolId,
      folder: { id: folder.id, name: folder.name },
      title,
      ...(branch ? { branch } : {}),
      prompt,
      item: { key: input.item.key, url: input.item.url },
      settings,
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
        startRefusal(error, tool, request),
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
      follows,
    );
    await this.options.storage.addHandoff(record, hook?.tokenHash);
    await this.options.storage
      .useRepositoryFolder(input.projectId, input.folderId)
      .catch(() => undefined);
    // The tool took the settings the route named, such as the base branch
    // the user gave when it refused another: later starts here use them.
    if (Object.keys(named).length)
      await this.options.storage
        .rememberHandoffFolderSettings(
          input.pluginId,
          tool.id,
          folder.id,
          named,
        )
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
  /** The ids of the plugin's tools the user turned on on this device. */
  private async enabledTools(pluginId: string): Promise<ReadonlySet<string>> {
    return new Set(await this.options.storage.getEnabledHandoffTools(pluginId));
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
   * Which of the plugin's tools that are on this computer has. A tool that
   * is off isn't detected or listed, and with none on the plugin isn't
   * asked. Tools without a connection are detected together, as before;
   * each connection the tools' settings picked is detected for its own
   * tools. A connection that fails marks only its tools missing, with why.
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
    const enabled = await this.enabledTools(pluginId);
    const tools = (plugin?.capabilities.handoff?.tools ?? []).filter((tool) =>
      enabled.has(tool.id),
    );
    if (!tools.length) return { tools: [] };
    const connected = tools.filter((tool) => tool.connection === "required");
    if (!connected.length) {
      const answer = await detectTools(pluginId, projectId);
      return {
        tools: answer.tools.filter((tool) => enabled.has(tool.id)),
      };
    }
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
   * of the item's keys, from each tool that is on and lists its threads.
   * Tools that run each other, such as T3 Code running Codex threads, may
   * each offer the same work: no tool's threads are filtered out. A tool lists
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
      const tools = plugin.capabilities.handoff?.tools ?? [];
      const enabled = tools.length
        ? await this.enabledTools(plugin.id)
        : new Set<string>();
      for (const tool of tools) {
        if (!tool.listsThreads || !enabled.has(tool.id)) continue;
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
        threads: result.threads
          .map((thread) => ({
            ...thread,
            pluginId,
            toolId,
            folderId,
            ...(connection ? { connectionId: connection.id } : {}),
          }))
          // A thread closed while the tool listed may still be in its answer.
          .filter((thread) => !this.closedSince(thread, now)),
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
    if (!(await this.enabledTools(input.pluginId)).has(tool.id))
      throw new HandoffToolOff(toolIsOff(tool, "link its threads"));
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
    const follows = tool.followsState !== false;
    const record = adoptHandoff(
      {
        id: randomUUID(),
        workItemId: input.workItemId,
        projectId: input.projectId,
      },
      thread,
      this.now(),
      follows,
    );
    await this.options.storage.addHandoff(record);
    await this.publish();
    if (follows) await this.refresh(record.id);
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
  /**
   * A thread closed in its tool leaves the listings taken before the close,
   * so the item page offers it no more and Link refuses it: those listings
   * are kept for minutes. A listing under way drops it when it lands
   * (`closedSince`). A listing taken after the close shows what the tool
   * lists then.
   */
  private forgetListedThread(thread: ThreadIdentity) {
    const at = this.now();
    for (const [key, closedAt] of this.closedThreads)
      if (at - closedAt > THREAD_LINK_MAX_AGE_MS)
        this.closedThreads.delete(key);
    this.closedThreads.set(closedThreadKey(thread), at);
    for (const [key, cached] of this.listings)
      if (!(cached instanceof Promise))
        this.listings.set(key, {
          ...cached,
          threads: cached.threads.filter(
            (listed) => !sameThread(listed, thread),
          ),
        });
  }
  /** Whether the thread was closed in its tool at or after `since`. */
  private closedSince(thread: ThreadIdentity, since: number) {
    const closedAt = this.closedThreads.get(closedThreadKey(thread));
    return closedAt !== undefined && closedAt >= since;
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
  /**
   * Closes a handoff's thread in its tool, then forgets the handoff as
   * `remove` does (#850). Only a tool that declares `closesThreads` is
   * asked; the plugin stops the thread's work first when it runs. Any
   * refusal, Ajour's or the tool's, keeps the handoff. It runs as a batch,
   * so no refresh reads the thread while the tool closes it.
   */
  async close(id: string): Promise<{
    pluginId: string;
    toolId: string;
    closesThreads: HandoffCloseKind;
  }> {
    return this.runBatch(async () => {
      const record = (await this.options.storage.listHandoffs()).find(
        (h) => h.id === id,
      );
      if (!record) throw new HandoffRefused("This handoff no longer exists.");
      const plugin = (await this.options.plugins.listPlugins()).find(
        (p) => p.id === record.pluginId,
      );
      const tool = plugin?.capabilities.handoff?.tools.find(
        (t) => t.id === record.toolId,
      );
      if (!plugin)
        throw new HandoffRefused("The handoff plugin is unavailable.");
      if (!tool) throw new HandoffRefused("The handoff tool was removed.");
      if (!tool.closesThreads || !this.options.plugins.closeThread)
        throw new HandoffRefused(
          `${tool.label ?? tool.id} can't close its threads. Remove it from the item instead.`,
        );
      const unavailable = await this.options.unavailableReason?.(
        record.pluginId,
        record.toolId,
        "closing its thread",
      );
      if (unavailable) throw new HandoffRefused(unavailable);
      let connection: HandoffConnection | undefined;
      if (tool.connection === "required") {
        if (!record.connectionId)
          throw new HandoffRefused(HANDOFF_NEEDS_CONNECTION);
        connection = await this.options.connection?.(
          record.pluginId,
          record.connectionId,
        );
        if (!connection) throw new HandoffRefused(DELETED_CONNECTION);
      }
      const { threadId, folderId, native } = record;
      try {
        await this.options.plugins.closeThread(
          record.pluginId,
          { tool: record.toolId, handoff: { id, threadId, folderId, native } },
          record.projectId,
          ...(connection ? [connection] : []),
        );
      } catch (error) {
        throw new HandoffRefused(
          error instanceof Error
            ? error.message
            : "The tool refused to close the thread.",
        );
      }
      this.forgetListedThread(record);
      await this.remove(id);
      return {
        pluginId: record.pluginId,
        toolId: record.toolId,
        closesThreads: tool.closesThreads,
      };
    });
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
  /**
   * Why the user can't refresh this handoff, if so: its tool doesn't report
   * state now, whatever the record's state, so the card offers no Refresh.
   */
  async refreshRefusal(id: string): Promise<string | undefined> {
    const record = (await this.options.storage.listHandoffs()).find(
      (h) => h.id === id,
    );
    if (!record) return undefined;
    const tool = (await this.options.plugins.listPlugins())
      .find((p) => p.id === record.pluginId)
      ?.capabilities.handoff?.tools.find((t) => t.id === record.toolId);
    if (tool?.followsState !== false) return undefined;
    return `${tool.label ?? record.toolId} doesn't report progress here; open it there to follow it.`;
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
    // Started handoffs are checked too: their tool may follow state again,
    // and they pause like any other when the plugin or tool goes.
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
          if (!reason && tool?.followsState === false) {
            // The tool doesn't follow state now, whatever it did when these
            // started: nothing is read, and they show Started from now on.
            // One already Started has nothing to do.
            const updates = batch
              .filter((h) => h.state !== "started" || h.paused)
              .map((h) => ({
                id: h.id,
                state: "started" as const,
                native: h.native,
                paused: undefined,
              }));
            if (!updates.length) return;
            unit = openUnit();
            await this.options.storage.updateHandoffs(updates, now, this.now());
            await this.publish();
            return;
          }
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
              await this.options.storage.updateHandoffs(
                updates,
                now,
                this.now(),
              );
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
          // A started handoff whose tool follows state again shows Unknown
          // until the tool answers for it.
          const answered = new Set(updates.map((update) => update.id));
          await this.options.storage.updateHandoffs(
            [
              ...updates,
              ...batch
                .filter((h) => h.state === "started" && !answered.has(h.id))
                .map((h) => ({
                  id: h.id,
                  state: "unknown" as const,
                  native: h.native,
                  paused: h.paused,
                })),
            ],
            now,
            this.now(),
          );
          succeeded++;
          await this.publish();
        } catch (error) {
          // A transport failure is not a native state change. Retry at the normal cadence.
          await this.options.storage.updateHandoffs(
            batch.map((h) => ({
              id: h.id,
              // A started handoff was asked because its tool follows state
              // again: Unknown until the tool answers.
              state: h.state === "started" ? ("unknown" as const) : h.state,
              native: h.native,
              paused: h.paused,
            })),
            now,
            this.now(),
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

/** One thread's key in `closedThreads`, as `sameThread` tells threads apart. */
function closedThreadKey(thread: ThreadIdentity) {
  return JSON.stringify([
    thread.pluginId,
    thread.toolId,
    thread.connectionId ?? null,
    thread.threadId,
  ]);
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
