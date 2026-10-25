import { useEffect, useRef } from "react";
import {
  isCapabilityActive,
  syncsPullRequestsAutomatically,
} from "@ajour/shared";
import { showErrorToast } from "@/components/ui/toast";
import {
  asPoll,
  getPluginsOverview,
  syncBacklogConnection,
  syncCodeHostConnection,
} from "@/lib/app-api";
import { syncTeamConnection } from "@/lib/team-sync";

const AUTO_SYNC_POLL_INTERVAL_MS = 30_000;

/**
 * Syncs connections with automatic sync on when they are due. A failure shows
 * one error toast. A due connection retries on every poll, so the same failure
 * again shows nothing new until the connection syncs or fails differently.
 * The tick emits no event of its own; each sync it starts is one job.
 */
export function BacklogAutoSyncScheduler() {
  const loopStateRef = useRef({
    cancelled: false,
    running: false,
    timeoutId: undefined as number | undefined,
    /** The last failure shown per connection, by `pluginId:connectionId`. */
    shownFailures: new Map<string, string>(),
  });

  useEffect(() => {
    const loopState = loopStateRef.current;
    loopState.cancelled = false;

    const scheduleNext = (delayMs = AUTO_SYNC_POLL_INTERVAL_MS) => {
      if (loopState.cancelled) {
        return;
      }

      loopState.timeoutId = window.setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (loopState.cancelled || loopState.running) {
        scheduleNext();
        return;
      }

      loopState.running = true;
      try {
        // The tick itself is no unit of work: only the syncs it starts emit.
        const overview = await asPoll(() => getPluginsOverview());
        const now = Date.now();
        // Each capability has its own automatic sync: auto sync imports work
        // items straight to the backlog, pull requests have their own, and a
        // team's projects always sync.
        const autoCapabilities = (
          group: (typeof overview.connectionGroups)[number],
          connection: (typeof group.connections)[number],
        ) =>
          overview.pluginsEnabled === false
            ? []
            : [
                ...(connection.autoSync &&
                isCapabilityActive(group, "connector")
                  ? (["connector"] as const)
                  : []),
                ...(syncsPullRequestsAutomatically(connection) &&
                isCapabilityActive(group, "codeHost")
                  ? (["codeHost"] as const)
                  : []),
                // A team always syncs on the interval: there is no review to skip.
                ...(isCapabilityActive(group, "team")
                  ? (["team"] as const)
                  : []),
              ];
        const dueConnections = overview.connectionGroups.flatMap((group) =>
          group.connections
            .filter(
              (connection) =>
                // A connection paused for its secret (a rejected token, a
                // removed one) waits for the user: syncing it only fails.
                !connection.paused &&
                (!connection.lastSyncAt ||
                  now - connection.lastSyncAt >=
                    connection.autoSyncIntervalMinutes * 60_000),
            )
            .map((connection) => ({
              pluginId: group.plugin.id,
              connection,
              capabilities: autoCapabilities(group, connection),
            }))
            .filter((due) => due.capabilities.length > 0),
        );

        for (const dueConnection of dueConnections) {
          if (loopState.cancelled) {
            break;
          }

          const operations = dueConnection.capabilities.map((capability) => ({
            capability,
            run: () =>
              capability === "connector"
                ? syncBacklogConnection(
                    dueConnection.pluginId,
                    dueConnection.connection.id,
                    { trigger: "auto" },
                  )
                : capability === "codeHost"
                  ? syncCodeHostConnection(
                      dueConnection.pluginId,
                      dueConnection.connection.id,
                      { trigger: "schedule" },
                    )
                  : syncTeamConnection(
                      dueConnection.pluginId,
                      dueConnection.connection.id,
                      { trigger: "schedule" },
                    ),
          }));
          for (const operation of operations) {
            if (loopState.cancelled) break;
            const failureKey = `${dueConnection.pluginId}:${dueConnection.connection.id}:${operation.capability}`;
            try {
              await operation.run();
              loopState.shownFailures.delete(failureKey);
            } catch (error) {
              // The sync's own event records the failure.
              const message =
                error instanceof Error ? error.message : "Unknown error";
              if (loopState.shownFailures.get(failureKey) !== message) {
                loopState.shownFailures.set(failureKey, message);
                showErrorToast({
                  title: `${dueConnection.connection.label} sync failed`,
                  description: message,
                });
              }
            }
          }
        }
      } catch {
        // The overview could not be read: the next tick tries again. Its
        // call is a poll, so it records nothing.
      } finally {
        loopState.running = false;
        scheduleNext();
      }
    };

    void tick();

    return () => {
      loopState.cancelled = true;
      if (loopState.timeoutId !== undefined) {
        window.clearTimeout(loopState.timeoutId);
      }
    };
  }, []);

  return null;
}
