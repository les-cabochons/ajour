import { isCapabilityActive } from "@ajour/shared";
import {
  asPoll,
  getPluginsOverview,
  syncBacklogConnection,
} from "@/lib/app-api";
import { getBacklogSyncSnapshot } from "@/lib/backlog-sync-status";

export interface BacklogRefreshSource {
  pluginId: string;
  connectionId: string;
  sourceId: string;
  syncedAt?: number;
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
    const current = await asPoll(() => getPluginsOverview());
    const targets = current.connectionGroups.flatMap((group) =>
      group.plugin.capabilities.connector &&
      current.pluginsEnabled !== false &&
      isCapabilityActive(group, "connector") &&
      (!source || source.pluginId === group.plugin.id)
        ? group.connections
            .filter(
              (c) => !c.paused && (!source || c.id === source.connectionId),
            )
            .map((connection) => ({ pluginId: group.plugin.id, connection }))
        : [],
    );
    // Match the scheduler's sequential admission so several connections
    // cannot exhaust their plugin's operation quota.
    for (const row of targets) {
      // Another entry point can start a queued connection while this one
      // waits for the preceding connection to finish.
      if (
        getBacklogSyncSnapshot().some(
          (s) =>
            s.pluginId === row.pluginId &&
            s.connectionId === row.connection.id &&
            s.running > 0,
        )
      )
        continue;
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
