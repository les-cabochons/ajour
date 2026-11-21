import { isCapabilityActive, type PluginsOverview } from "@ajour/shared";
import {
  asPoll,
  getPluginsOverview,
  syncBacklogConnection,
} from "@/lib/app-api";
import {
  getBacklogSyncSnapshot,
  nextBacklogSyncChange,
  type BacklogSyncStatus,
} from "@/lib/backlog-sync-status";

export interface BacklogRefreshSource {
  pluginId: string;
  connectionId: string;
  sourceId: string;
  syncedAt?: number;
}

/**
 * The connections a refresh syncs: those of active backlog plugins, not
 * paused, limited to the item's connection for an item refresh.
 */
function refreshTargets(
  overview: PluginsOverview,
  source: BacklogRefreshSource | undefined,
) {
  return overview.connectionGroups.flatMap((group) =>
    group.plugin.capabilities.connector &&
    overview.pluginsEnabled !== false &&
    isCapabilityActive(group, "connector") &&
    (!source || source.pluginId === group.plugin.id)
      ? group.connections
          .filter((c) => !c.paused && (!source || c.id === source.connectionId))
          .map((connection) => ({ pluginId: group.plugin.id, connection }))
      : [],
  );
}

/** Pulls source values for the refresh control and each Backlog visit. */
export async function refreshBacklog({
  source,
  trigger = "manual",
}: {
  source?: BacklogRefreshSource;
  trigger?: "auto" | "manual";
} = {}) {
  try {
    // Reading the overview is also the retry when the local API was offline.
    const targets = refreshTargets(
      await asPoll(() => getPluginsOverview()),
      source,
    );
    // Match the scheduler's sequential admission so several connections
    // cannot exhaust their plugin's operation quota.
    for (const row of targets) {
      const running = () =>
        getBacklogSyncSnapshot().filter(
          (s) =>
            s.pluginId === row.pluginId &&
            s.connectionId === row.connection.id &&
            s.running > 0,
        );
      // A running sync of the whole connection, or of this same item, serves
      // the refresh. An upload of one item's estimates brings back no item,
      // so it serves none.
      const serves = (s: BacklogSyncStatus) =>
        s.trigger !== "source_write" &&
        (s.sourceId === undefined || s.sourceId === source?.sourceId);
      // A running sync that sends some of the same items: the refresh waits
      // for its answer, so it never sends a change a second time.
      const overlaps = (s: BacklogSyncStatus) =>
        !source || s.sourceId === undefined || s.sourceId === source.sourceId;
      // Another entry point can also start this connection meanwhile. The
      // sync it waited for may have paused the connection, as a rejected
      // token does, or its plugin may have turned off: it reads the
      // overview again before it sends.
      let stillTarget = true;
      while (
        stillTarget &&
        !running().some(serves) &&
        running().some(overlaps)
      ) {
        await nextBacklogSyncChange();
        if (!running().some(overlaps)) {
          stillTarget = refreshTargets(
            await asPoll(() => getPluginsOverview()),
            source,
          ).some(
            (target) =>
              target.pluginId === row.pluginId &&
              target.connection.id === row.connection.id,
          );
        }
      }
      if (!stillTarget || running().some(serves)) continue;
      try {
        await syncBacklogConnection(row.pluginId, row.connection.id, {
          refresh: true,
          trigger,
          ...(source ? { sourceId: source.sourceId } : {}),
        });
      } catch {
        // Keep refreshing the other connections. Each failure stays visible.
      }
    }
  } catch {
    /* The shared availability state keeps the failure visible. */
  }
}
