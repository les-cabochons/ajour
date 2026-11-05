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
import { exclusively } from "@/lib/team-sync";
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

/** Whether the local API still has the connection with Managed projects on. */
async function isConnectionActive(pluginId: string, connectionId: string) {
  const overview = await getPluginsOverview();
  if (overview.pluginsEnabled === false) return false;
  const group = overview.connectionGroups.find(
    (entry) => entry.plugin.id === pluginId,
  );
  return Boolean(
    group &&
    isCapabilityActive(group, "projectSource") &&
    group.connections.some((entry) => entry.id === connectionId),
  );
}

/**
 * Syncs one project source connection, as one `project_source.sync` job: its
 * local API call and the store command that applies the answer count on
 * it. A manual and a scheduled call share one run, and other windows wait
 * for it. When the web holds nothing from the connection yet, it asks for
 * the whole snapshot, so an "unchanged" answer can't leave it empty.
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

  const run = async (
    job: Unit<AjourCatalog, "project_source.sync">,
  ): Promise<ProjectSourceSyncOutcome> => {
    const generation = connectionGeneration(pluginId, connectionId);
    const fresh = !localStore.snapshot().projectSources?.[connectionId];
    job.set({
      plugin: { id: pluginId },
      connection: { id: connectionId },
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
    if ("unchanged" in answer) {
      job.set({ project_source_sync: { unchanged: true } });
      return { kind: "unchanged" };
    }
    // Saved again or removed while the snapshot was on its way, here or in
    // another window: the answer may be for another account.
    const discard = (reason: "connection_changed" | "connection_gone") => {
      job.set({ project_source_sync: { discarded: reason } }).end("noop");
      return { kind: "discarded" } as const;
    };
    if (connectionGeneration(pluginId, connectionId) !== generation) {
      return discard("connection_changed");
    }
    if (!(await job.enter(() => isConnectionActive(pluginId, connectionId)))) {
      return discard("connection_gone");
    }
    const result = job.enter(() =>
      localStore.applyProjectSourceSync(
        { pluginId, connectionId },
        answer.snapshot,
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
        refused_shared_count: counts.refusedShared,
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
    counts.refusedShared
      ? `${counts.refusedShared} skipped: shared with a team`
      : undefined,
  ].filter(Boolean);
  return [connectionLabel, ...(parts.length ? parts : ["up to date"])].join(
    " · ",
  );
}
