import { useSyncExternalStore } from "react";
import { AppPanel } from "@/components/app-surface";
import { Value } from "@/components/ui/value";
import { describeTimeSyncHoldReason } from "@/domain/projects/time-sync";
import { formatClockDuration } from "@/domain/time/duration";
import { formatShortLocalDate } from "@/domain/time/local-date";
import { usePluginsOverview } from "@/features/backlog/plugins-overview";
import { localStore } from "@/lib/local-store";

/*
 * Time entries a time sync holds (#694): entries of the other system that
 * Ajour doesn't take, such as one on a project the connection doesn't
 * manage. Read-only: each round lists them again, so one leaves the list
 * once it changes there or Ajour can take it. Turning Time entries off
 * drops them.
 */

function useTimeSyncs() {
  const timeSyncs = useSyncExternalStore(
    localStore.subscribe,
    () => localStore.snapshot().timeSyncs,
    () => localStore.snapshot().timeSyncs,
  );
  const projectSources = useSyncExternalStore(
    localStore.subscribe,
    () => localStore.snapshot().projectSources,
    () => localStore.snapshot().projectSources,
  );
  return { timeSyncs: timeSyncs ?? {}, projectSources: projectSources ?? {} };
}

/** Sync review's group of held time entries, by connection. */
export function HeldTimeEntriesReview() {
  const { timeSyncs, projectSources } = useTimeSyncs();
  const overview = usePluginsOverview();
  const groups = Object.entries(timeSyncs).filter(
    ([, record]) => record.held.length > 0,
  );
  if (groups.length === 0) return null;
  const count = groups.reduce((sum, [, record]) => sum + record.held.length, 0);
  const currentYear = new Date().getFullYear();

  /** The connection's name, as its row in Settings shows it. */
  const labelOf = (connectionId: string, pluginId: string) =>
    overview?.connectionGroups
      .find((group) => group.plugin.id === pluginId)
      ?.connections.find((connection) => connection.id === connectionId)
      ?.label ??
    projectSources[connectionId]?.label ??
    "Connection";

  return (
    <AppPanel as="section" aria-label="Held time entries">
      <h3 className="settings-subsection-title">
        {count === 1 ? "1 time entry held" : `${count} time entries held`}
      </h3>
      <p className="text-xs text-muted-foreground">
        Logged in the other system on time Ajour doesn't take. They stay there,
        and leave this list once Ajour can take them.
      </p>
      {groups.map(([connectionId, record]) => {
        const label = labelOf(connectionId, record.pluginId);
        return (
          <section
            key={connectionId}
            aria-label={`Time entries held from ${label}`}
            className="flex flex-col gap-3 rounded-md p-2"
          >
            <span className="text-sm font-medium text-foreground">
              From {label}
            </span>
            {record.held.map((held) => (
              <div
                key={held.remoteId}
                data-held-time-entry={held.remoteId}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium break-words text-foreground">
                    {held.taskName}
                  </p>
                  <p className="text-xs break-words text-muted-foreground">
                    {formatShortLocalDate(held.localDate, currentYear)} ·{" "}
                    {held.projectRemoteId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {describeTimeSyncHoldReason(held.reason)}
                  </p>
                </div>
                <Value size="base" className="shrink-0">
                  {formatClockDuration(held.minutes * 60_000)}
                </Value>
              </div>
            ))}
          </section>
        );
      })}
    </AppPanel>
  );
}
