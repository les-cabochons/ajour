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
  onChange(records: Handoff[]): void;
  events?: ApiEvents;
  now?: () => number;
}

export class HandoffRefused extends Error {}

/** Local handoffs and refresh scheduling. The host owns project scope. */
export class Handoffs {
  private readonly options: Options;
  private readonly now: () => number;
  private visible = true;
  private refreshing?: Promise<void>;
  constructor(options: Options) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  async publish() {
    this.options.onChange(await this.options.storage.listHandoffs());
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
    await this.refresh(undefined, true);
  }
  async refresh(id?: string, automatic = false): Promise<void> {
    // Serialize with manual refresh too, so an older answer cannot overwrite a newer one.
    while (this.refreshing) {
      await this.refreshing.catch(() => undefined);
      if (automatic) return;
    }
    const task = this.refreshRecords(id, automatic);
    this.refreshing = task;
    try {
      await task;
    } finally {
      if (this.refreshing === task) this.refreshing = undefined;
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
    for (const batch of batches) {
      const first = batch[0]!;
      const unit = this.options.events?.start("handoff.refresh", {
        kind: "job",
        trigger: automatic ? "system" : "user",
      });
      unit?.set({
        plugin: { id: first.pluginId },
        handoff: { tool: first.toolId, count: batch.length },
      });
      try {
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
        await this.publish();
      } catch (error) {
        // A transport failure is not a native state change. Retry at the normal cadence.
        await this.options.storage.updateHandoffs(
          batch.map((h) => ({ id: h.id, state: h.state, native: h.native })),
          now,
        );
        await this.publish();
        unit?.refuse("refresh_failed");
        if (!automatic) throw error;
      } finally {
        unit?.end();
      }
    }
  }
}
