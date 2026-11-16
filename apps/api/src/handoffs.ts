import { randomUUID } from "node:crypto";
import type {
  Handoff,
  HandoffStartRoute,
  StartHandoffRequest,
  StartHandoffResult,
  ReadHandoffStatesRequest,
  ReadHandoffStatesResult,
} from "../../../packages/shared/handoffs.ts";
import type { AppApiStorage } from "./storage.ts";
import type { ApiEvents } from "./events.ts";
import { shouldRefresh, startHandoff } from "./handoff-state.ts";

interface Options {
  storage: AppApiStorage;
  plugins: {
    listPlugins(): Promise<
      Array<{
        id: string;
        capabilities: { handoff?: { tools: Array<{ id: string }> } };
      }>
    >;
    startHandoff(
      pluginId: string,
      request: StartHandoffRequest,
      projectId: string,
    ): Promise<StartHandoffResult>;
    readHandoffStates(
      pluginId: string,
      request: ReadHandoffStatesRequest,
      projectId: string,
    ): Promise<ReadHandoffStatesResult>;
  };
  unavailableReason?(
    pluginId: string,
    toolId: string,
  ): Promise<string | undefined>;
  onChange(records: Handoff[]): void;
  events?: ApiEvents;
  now?: () => number;
}

export class HandoffRefused extends Error {}

/** Local handoffs and refresh scheduling. The host owns project scope. */
export class Handoffs {
  private readonly options: Options;
  private readonly now: () => number;
  private visible = false;
  private ticking = false;
  private refreshing?: Promise<unknown>;
  private lastPublished?: string;
  constructor(options: Options) {
    this.options = options;
    this.now = options.now ?? Date.now;
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
    if (!plugin?.capabilities.handoff?.tools.some((t) => t.id === input.toolId))
      throw new HandoffRefused("This handoff tool is not available.");
    let result: StartHandoffResult;
    try {
      result = await this.options.plugins.startHandoff(
        input.pluginId,
        {
          tool: input.toolId,
          folder: { id: folder.id, name: folder.name },
          prompt: input.prompt,
          title: input.title,
          branch: input.branch,
          item: input.item,
          settings: input.settings,
        },
        input.projectId,
      );
    } catch (error) {
      throw new HandoffRefused(
        error instanceof Error
          ? error.message
          : "The tool refused the handoff.",
      );
    }
    const { pluginId, toolId, workItemId, projectId, folderId, title, branch } =
      input;
    const record = startHandoff(
      {
        id: randomUUID(),
        pluginId,
        toolId,
        workItemId,
        projectId,
        folderId,
        title,
        branch,
      },
      result,
      this.now(),
    );
    await this.options.storage.addHandoff(record);
    await this.options.storage
      .useRepositoryFolder(input.projectId, input.folderId)
      .catch(() => undefined);
    await this.publish();
    return record;
  }
  async remove(id: string) {
    await this.options.storage.removeHandoff(id);
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
    return this.refreshRecords(id, automatic);
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
  private async refreshRecords(id: string | undefined, automatic: boolean) {
    const now = this.now();
    const records = (await this.options.storage.listHandoffs()).filter(
      (h) =>
        (id === undefined || h.id === id) &&
        (!automatic ||
          (shouldRefresh(h, now) &&
            now - h.checkedAt >= (this.visible ? 30_000 : 120_000))),
    );
    const groups = new Map<string, Handoff[]>();
    for (const record of records) {
      const key = JSON.stringify([
        record.pluginId,
        record.toolId,
        record.projectId,
      ]);
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }
    const batches = [...groups.values()].flatMap((group) => {
      const batches: Handoff[][] = [];
      for (let i = 0; i < group.length; i += 1000)
        batches.push(group.slice(i, i + 1000));
      return batches;
    });
    const failures: Array<{
      pluginId: string;
      toolId: string;
      projectId: string;
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
            trigger: automatic ? "system" : "user",
          });
          unit?.set({
            plugin: { id: first.pluginId },
            handoff: { tool: first.toolId, count: batch.length },
          });
          return unit;
        };
        let unit: ReturnType<typeof openUnit>;
        try {
          const plugins = await this.options.plugins.listPlugins();
          const plugin = plugins.find((p) => p.id === first.pluginId);
          const reason = !plugin
            ? "The handoff plugin is unavailable."
            : !plugin.capabilities.handoff?.tools.some(
                  (t) => t.id === first.toolId,
                )
              ? "The handoff tool was removed."
              : await this.options.unavailableReason?.(
                  first.pluginId,
                  first.toolId,
                );
          if (
            automatic &&
            reason &&
            batch.every(
              (h) => h.state === "unknown" && h.native.label === reason,
            )
          )
            return;
          unit = openUnit();
          if (reason) {
            const updates = batch
              .filter((h) => h.state !== "unknown" || h.native.label !== reason)
              .map((h) => ({
                id: h.id,
                state: "unknown" as const,
                native: { label: reason },
              }));
            if (updates.length) {
              await this.options.storage.updateHandoffs(updates, now);
              await this.publish();
            }
            failures.push({
              pluginId: first.pluginId,
              toolId: first.toolId,
              projectId: first.projectId,
              reason,
            });
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
          );
          await this.options.storage.updateHandoffs(updates, now);
          succeeded++;
          await this.publish();
        } catch (error) {
          // A transport failure is not a native state change. Retry at the normal cadence.
          await this.options.storage.updateHandoffs(
            batch.map((h) => ({ id: h.id, state: h.state, native: h.native })),
            now,
          );
          await this.publish();
          unit?.refuse("refresh_failed");
          failures.push({
            pluginId: first.pluginId,
            toolId: first.toolId,
            projectId: first.projectId,
            reason:
              error instanceof Error
                ? error.message
                : "The tool refused the refresh.",
          });
        } finally {
          unit?.end();
        }
      });
    }
    return { succeeded, failures };
  }
}
