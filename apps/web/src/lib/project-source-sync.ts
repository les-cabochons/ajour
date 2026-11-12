import { isCapabilityActive } from "@ajour/shared";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import type {
  ProjectSourceSyncCounts,
  SourceWaitingQuestion,
} from "@/domain/projects/source-sync";
import {
  connectionGeneration,
  getPluginsOverview,
  syncProjectSource,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { exclusively } from "@/lib/window-lock";
import { wideEvents } from "@/lib/wide-events";

/*
 * Runs a project source sync (#505): reads the connection's snapshot from
 * the local API and applies it to the projects. The rules live in
 * domain/projects/source-sync.ts. The scheduler runs it every 15 minutes,
 * and Sync now in Settings runs it at once. A failure applies nothing, so
 * the last snapshot stays, and the connection keeps the error.
 */

/** How often the scheduler syncs a project source connection. */
export const PROJECT_SOURCE_SYNC_INTERVAL_MS = 15 * 60_000;

/**
 * How long after a sync the user asked for, opening a project of the same
 * connection syncs nothing (#686), so moving between projects doesn't read
 * the source each time.
 */
export const PROJECT_PAGE_SYNC_INTERVAL_MS = 5 * 60_000;

/** When each connection last started a sync the user asked for, in this window. */
const lastUserSyncAt = new Map<string, number>();

export type ProjectSourceSyncOutcome =
  /** The source had nothing new since the last sync. */
  | { kind: "unchanged" }
  | {
      kind: "applied";
      /** What the source calls itself, such as in "From <label>". */
      label: string;
      counts: ProjectSourceSyncCounts;
      /** Projects whose Not known yet tasks the user may now match. */
      waitingQuestions: SourceWaitingQuestion[];
    }
  /** The connection changed, went or was turned off while the sync ran. */
  | { kind: "discarded" };

const runningSyncs = new Map<string, Promise<ProjectSourceSyncOutcome>>();

/**
 * The connection, when the local API has it with Managed projects on, read
 * from a fresh overview.
 */
async function activeConnection(pluginId: string, connectionId: string) {
  const overview = await getPluginsOverview();
  if (overview.pluginsEnabled === false) return undefined;
  const group = overview.connectionGroups.find(
    (entry) => entry.plugin.id === pluginId,
  );
  if (!group || !isCapabilityActive(group, "projectSource")) return undefined;
  return group.connections.find((entry) => entry.id === connectionId);
}

/**
 * Syncs one project source connection, as one `project_source.sync` job: its
 * local API calls and the store command that applies the answer count on
 * it. A manual and a scheduled call share one run, and other windows wait
 * for it.
 *
 * The local API keeps the cursor, and moves it before the web applies the
 * answer. So the web asks for the whole snapshot when it holds nothing from
 * the connection, or when its last applied sync is older than the
 * connection's last sync: an answer it discarded, or whose apply threw,
 * would otherwise leave it behind for good. Another capability's sync of
 * the same connection also moves that time, and costs one whole read.
 */
export function syncProjectSourceConnection(
  pluginId: string,
  connectionId: string,
  options: { trigger?: "user" | "schedule" } = {},
): Promise<ProjectSourceSyncOutcome> {
  const key = JSON.stringify([pluginId, connectionId]);
  const running = runningSyncs.get(key);
  if (running) return running;
  const trigger = options.trigger ?? "user";
  if (trigger === "user") lastUserSyncAt.set(key, Date.now());

  const run = async (
    job: Unit<AjourCatalog, "project_source.sync">,
  ): Promise<ProjectSourceSyncOutcome> => {
    const generation = connectionGeneration(pluginId, connectionId);
    job.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
    const summary = await job.enter(() =>
      activeConnection(pluginId, connectionId),
    );
    if (!summary) {
      job.refuse("connection_not_found");
      throw new Error(
        "This project source connection is gone, or Managed projects is off.",
      );
    }
    const record = localStore.snapshot().projectSources?.[connectionId];
    const fresh =
      !record ||
      (summary.lastSyncAt !== undefined &&
        record.syncedAt < summary.lastSyncAt);
    job.set({
      project_source_sync: {
        trigger: trigger === "schedule" ? "auto" : "manual",
        fresh,
      },
    });
    const answer = await job.enter(() =>
      syncProjectSource(pluginId, connectionId, {
        trigger: trigger === "schedule" ? "auto" : "manual",
        fresh,
      }),
    );
    // The time the next sync compares with the connection's last sync.
    const syncedAt = answer.connection.lastSyncAt ?? Date.now();
    // The answer may be for another account: the connection was saved again
    // or removed in this window while the snapshot was on its way, or it was
    // removed, or Managed projects turned off, in any window. A save in
    // another window after the local API answered goes unnoticed; the API
    // refuses one made while the plugin ran.
    const discard = (reason: "connection_changed" | "connection_gone") => {
      job.set({ project_source_sync: { discarded: reason } }).end("noop");
      return { kind: "discarded" } as const;
    };
    if (connectionGeneration(pluginId, connectionId) !== generation) {
      return discard("connection_changed");
    }
    if ("unchanged" in answer) {
      job.set({ project_source_sync: { unchanged: true } });
      job.enter(() =>
        localStore.confirmProjectSourceUnchanged(
          { pluginId, connectionId },
          syncedAt,
        ),
      );
      return { kind: "unchanged" };
    }
    if (!(await job.enter(() => activeConnection(pluginId, connectionId)))) {
      return discard("connection_gone");
    }
    const result = job.enter(() =>
      localStore.applyProjectSourceSync(
        { pluginId, connectionId },
        answer.snapshot,
        syncedAt,
      ),
    );
    const { waitingQuestions, ...counts } = result;
    job.set({
      project_source_sync: {
        unchanged: false,
        linked_count: counts.linked,
        created_count: counts.created,
        updated_count: counts.updated,
        archived_count: counts.archived,
        restored_count: counts.restored,
        held_count: counts.held,
        unchanged_count: counts.unchanged,
        waiting_question_count: waitingQuestions.length,
      },
    });
    return {
      kind: "applied",
      label: answer.snapshot.source.label,
      counts,
      waitingQuestions,
    };
  };

  // The job opens now, so the time other windows hold the lock counts too.
  const promise = wideEvents
    .run(
      "project_source.sync",
      { kind: "job", trigger, detached: true },
      (job) => exclusively(`ajour-project-source-sync:${key}`, () => run(job)),
    )
    .finally(() => {
      if (runningSyncs.get(key) === promise) runningSyncs.delete(key);
    });

  runningSyncs.set(key, promise);
  return promise;
}

/**
 * Syncs the connection of a managed project the user opens (#686), as a sync
 * the user asked for, so a plugin that answers from a cache reads the source.
 * Answers undefined, and syncs nothing, when the user asked for one in the
 * last PROJECT_PAGE_SYNC_INTERVAL_MS.
 */
export function syncOpenedProjectSource(
  pluginId: string,
  connectionId: string,
): Promise<ProjectSourceSyncOutcome> | undefined {
  const last = lastUserSyncAt.get(JSON.stringify([pluginId, connectionId]));
  if (last !== undefined && Date.now() - last < PROJECT_PAGE_SYNC_INTERVAL_MS) {
    return undefined;
  }
  return syncProjectSourceConnection(pluginId, connectionId, {
    trigger: "user",
  });
}

/** One line for a sync's result, such as "Example planner · 2 added · 1 held for review". */
export function describeProjectSourceSync(
  connectionLabel: string,
  outcome: ProjectSourceSyncOutcome,
) {
  if (outcome.kind === "unchanged") {
    return `${connectionLabel} · up to date`;
  }
  if (outcome.kind === "discarded") {
    return `${connectionLabel} changed while syncing. Sync again.`;
  }
  const { counts } = outcome;
  const parts = [
    counts.linked ? `${counts.linked} linked` : undefined,
    counts.created ? `${counts.created} added` : undefined,
    counts.updated ? `${counts.updated} updated` : undefined,
    counts.archived ? `${counts.archived} archived` : undefined,
    counts.restored ? `${counts.restored} restored` : undefined,
    counts.held ? `${counts.held} held for review` : undefined,
  ].filter(Boolean);
  return [connectionLabel, ...(parts.length ? parts : ["up to date"])].join(
    " · ",
  );
}
