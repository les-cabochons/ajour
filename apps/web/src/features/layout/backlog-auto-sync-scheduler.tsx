import { getBacklogSyncSnapshot } from "@/lib/backlog-sync-status";
import { useEffect, useRef } from "react";
import {
  isCapabilityActive,
  syncsPullRequestsAutomatically,
} from "@ajour/shared";
import { connectionAccessAllows } from "@ajour/shared/connection-access";
import { showErrorToast } from "@/components/ui/toast";
import {
  asPoll,
  getPluginsOverview,
  syncBacklogConnection,
  syncCodeHostConnection,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { syncTeamConnection } from "@/lib/team-sync";
import {
  PROJECT_SOURCE_SYNC_INTERVAL_MS,
  syncProjectSourceConnection,
} from "@/lib/project-source-sync";
import { offerSourceWaitingQuestions } from "@/features/projects/source-waiting-tasks";

const AUTO_SYNC_POLL_INTERVAL_MS = 30_000;

type AutoSyncCapability = "connector" | "codeHost" | "team" | "projectSource";

/** Each capability as its switch names it on the plugin's settings page. */
const CAPABILITY_NAMES: Record<AutoSyncCapability, string> = {
  connector: "Backlog items",
  codeHost: "Pull requests",
  team: "Projects",
  projectSource: "Managed projects",
};

/**
 * A connection's failure toast text: the reason alone, or one line per
 * capability that failed, named, when several did.
 */
function describeFailures(failures: Map<AutoSyncCapability, string>) {
  if (failures.size === 1) return [...failures.values()][0];
  return Array.from(
    failures,
    ([capability, message]) => `${CAPABILITY_NAMES[capability]}: ${message}`,
  ).join("\n");
}

/**
 * Syncs connections with automatic sync on when they are due. Failures show
 * one error toast per connection: a later failure of that connection, of the
 * same or another capability, replaces the toast's text instead of stacking a
 * new toast. A due connection retries on every poll, so the same failure again
 * shows nothing new until the capability syncs or fails differently.
 * The tick emits no event of its own; each sync it starts is one job.
 */
export function BacklogAutoSyncScheduler() {
  const loopStateRef = useRef({
    cancelled: false,
    running: false,
    timeoutId: undefined as number | undefined,
    /**
     * The failures shown per connection, by `pluginId:connectionId`, with
     * the last reason of each capability that has not synced since.
     */
    shownFailures: new Map<string, Map<AutoSyncCapability, string>>(),
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
                // Pull requests also need the connection's own choice.
                ...(syncsPullRequestsAutomatically(connection) &&
                isCapabilityActive(group, "codeHost") &&
                connectionAccessAllows(group, connection, "syncPullRequests")
                  ? (["codeHost"] as const)
                  : []),
                // A team always syncs on the interval: there is no review to skip.
                ...(isCapabilityActive(group, "team")
                  ? (["team"] as const)
                  : []),
                // Managed projects follow their source every 15 minutes.
                ...(isCapabilityActive(group, "projectSource")
                  ? (["projectSource"] as const)
                  : []),
              ];
        const dueConnections = overview.connectionGroups.flatMap((group) =>
          group.connections
            .filter(
              (connection) =>
                // A connection paused for its secret (a rejected token, a
                // removed one) waits for the user: syncing it only fails.
                !connection.paused,
            )
            .map((connection) => ({
              pluginId: group.plugin.id,
              connection,
              capabilities: autoCapabilities(group, connection).filter(
                (capability) => {
                  // Managed projects keep their own clock: the shared last
                  // sync time moves with the connection's other syncs too.
                  const last =
                    capability === "connector"
                      ? connection.backlogLastSyncAt
                      : capability === "projectSource"
                        ? localStore.snapshot().projectSources?.[connection.id]
                            ?.syncedAt
                        : connection.lastSyncAt;
                  const interval =
                    capability === "projectSource"
                      ? PROJECT_SOURCE_SYNC_INTERVAL_MS
                      : connection.autoSyncIntervalMinutes * 60_000;
                  return (
                    (!last || now - last >= interval) &&
                    (capability !== "connector" ||
                      !getBacklogSyncSnapshot().some(
                        (s) =>
                          s.pluginId === group.plugin.id &&
                          s.connectionId === connection.id &&
                          s.running > 0,
                      ))
                  );
                },
              ),
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
                  : capability === "projectSource"
                    ? syncProjectSourceConnection(
                        dueConnection.pluginId,
                        dueConnection.connection.id,
                        { trigger: "schedule" },
                      ).then((outcome) => {
                        if (outcome.kind === "applied") {
                          offerSourceWaitingQuestions(
                            outcome.label,
                            outcome.waitingQuestions,
                          );
                        }
                      })
                    : syncTeamConnection(
                        dueConnection.pluginId,
                        dueConnection.connection.id,
                        { trigger: "schedule" },
                      ),
          }));
          for (const operation of operations) {
            if (loopState.cancelled) break;
            if (
              operation.capability === "connector" &&
              getBacklogSyncSnapshot().some(
                (s) =>
                  s.pluginId === dueConnection.pluginId &&
                  s.connectionId === dueConnection.connection.id &&
                  s.running > 0,
              )
            )
              continue;
            const connectionKey = `${dueConnection.pluginId}:${dueConnection.connection.id}`;
            try {
              await operation.run();
              loopState.shownFailures
                .get(connectionKey)
                ?.delete(operation.capability);
            } catch (error) {
              // The sync's own event records the failure.
              const message =
                error instanceof Error ? error.message : "Unknown error";
              const failures =
                loopState.shownFailures.get(connectionKey) ??
                new Map<AutoSyncCapability, string>();
              if (failures.get(operation.capability) !== message) {
                failures.set(operation.capability, message);
                loopState.shownFailures.set(connectionKey, failures);
                showErrorToast({
                  id: `sync-failed:${connectionKey}`,
                  title: `${dueConnection.connection.label} sync failed`,
                  description: describeFailures(failures),
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
