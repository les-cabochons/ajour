import {
  refreshBacklog,
  type BacklogRefreshSource,
} from "./backlog-refresh-workflow";
import { useSyncExternalStore } from "react";
import { isCapabilityActive } from "@ajour/shared";
import { RiRefreshLine, RiErrorWarningLine } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  connectionSyncWarning,
  syncAge,
} from "@/domain/backlog/sync-freshness";
import {
  getCachedPluginsOverview,
  subscribePluginsOverview,
} from "@/lib/app-api";
import {
  getBacklogSyncSnapshot,
  subscribeBacklogSync,
  getBacklogSyncAvailability,
} from "@/lib/backlog-sync-status";
import { useNow } from "@/lib/use-now";

/** One isolated readout, shared by the backlog, item page and peek. */
/** Short, whole labels for the narrow view's one toolbar row. */
const COMPACT_WARNINGS: Record<string, string> = {
  "Connection unavailable": "No connection",
  "Scheduled sync off": "Sync off",
};

// A paused sync stays a warning: a rejected token pauses it too.
const CALM_SYNC_STATES = new Set([
  "Connection unavailable",
  "Scheduled sync off",
]);

export function BacklogRefresh({
  source,
  hasSyncedItems = false,
  compact = false,
}: {
  source?: BacklogRefreshSource;
  hasSyncedItems?: boolean;
  /** The narrow view: a warning shows alone; the tooltip keeps the age. */
  compact?: boolean;
}) {
  const overview = useSyncExternalStore(
    subscribePluginsOverview,
    getCachedPluginsOverview,
    getCachedPluginsOverview,
  );
  const syncs = useSyncExternalStore(
    subscribeBacklogSync,
    getBacklogSyncSnapshot,
    getBacklogSyncSnapshot,
  );
  const now = useNow();
  const apiError = getBacklogSyncAvailability();
  const connections = (overview?.connectionGroups ?? []).flatMap((group) =>
    group.plugin.capabilities.connector &&
    (!source || group.plugin.id === source.pluginId)
      ? group.connections
          .filter((c) => !source || c.id === source.connectionId)
          .map((connection) => ({
            connection,
            pluginId: group.plugin.id,
            enabled:
              overview?.pluginsEnabled !== false &&
              isCapabilityActive(group, "connector"),
          }))
      : [],
  );
  if (!connections.length && !source && !hasSyncedItems) return null;
  const rows = connections.map((row) => {
    const statuses = syncs.filter(
      (s) =>
        s.pluginId === row.pluginId &&
        s.connectionId === row.connection.id &&
        (!source ? !s.sourceId : !s.sourceId || s.sourceId === source.sourceId),
    );
    const lastSuccessAt =
      Math.max(
        (source ? source.syncedAt : row.connection.backlogLastSyncAt) ?? 0,
        ...statuses
          .filter((s) => !source || s.sourceId === source.sourceId)
          .map((s) => s.lastSuccessAt ?? 0),
      ) || undefined;
    const failedAt =
      Math.max(
        row.connection.backlogLastErrorAt ?? 0,
        ...statuses.map((s) => s.failedAt ?? 0),
      ) || undefined;
    const warning = connectionSyncWarning(
      row.connection,
      row.enabled,
      lastSuccessAt,
      failedAt,
      now,
      (statuses.find((s) => s.failedAt !== undefined && s.failedAt === failedAt)
        ?.trigger ?? row.connection.backlogLastErrorTrigger) === "auto",
    );
    return {
      ...row,
      lastSuccessAt,
      warning,
      running: syncs.some(
        (s) =>
          s.pluginId === row.pluginId &&
          s.connectionId === row.connection.id &&
          s.running > 0,
      ),
      error:
        statuses.find((s) => s.failedAt === failedAt)?.error ??
        row.connection.backlogLastError ??
        row.connection.paused?.message,
    };
  });
  const running = rows.some((row) => row.running);
  const warning = apiError
    ? "Sync unavailable"
    : !rows.length
      ? "Connection unavailable"
      : rows.find((row) => row.warning)?.warning;
  const lastSuccessAt =
    rows.length && rows.every((row) => row.lastSuccessAt)
      ? Math.min(...rows.map((row) => row.lastSuccessAt!))
      : undefined;
  // A condition the user set up or chose, no connection or scheduled sync
  // off, is quiet status. A failed, paused or overdue sync is a warning.
  const alarming = warning !== undefined && !CALM_SYNC_STATES.has(warning);
  const age = `Last sync ${syncAge(lastSuccessAt, now)}`;
  const label = source ? "Refresh item" : "Refresh backlog";
  const detail = [
    source
      ? "Fetch only this item from its source."
      : "Fetch all backlog connections, including items outside the current filters.",
    "Pending local edits are not uploaded.",
    ...rows.map(
      (row) =>
        `${row.connection.label}: ${row.warning ? row.warning + ". " : ""}Last sync ${syncAge(row.lastSuccessAt, now)}${row.lastSuccessAt ? " (" + new Date(row.lastSuccessAt).toLocaleString() + ")" : ""}.${row.error ? " " + row.error : ""}`,
    ),
    apiError ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  const disabled =
    running ||
    (!apiError && !rows.some((row) => row.enabled && !row.connection.paused));

  const statusText = running
    ? "Syncing…"
    : warning
      ? `${warning} · ${age.toLowerCase()}`
      : age;
  return (
    <div className="backlog-refresh" aria-busy={running}>
      {alarming && !running ? (
        <RiErrorWarningLine className="backlog-refresh-warning" aria-hidden />
      ) : null}
      {compact ? (
        // The narrow view: a short, whole label, and a tap shows the full
        // explanation even while Refresh is disabled (council round 12).
        <Popover>
          <PopoverTrigger
            className="backlog-refresh-compact"
            aria-label={`Sync status: ${statusText}`}
          >
            <span role="status" aria-live="polite">
              {running
                ? "Syncing…"
                : (warning && COMPACT_WARNINGS[warning]) || warning || age}
            </span>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 text-xs whitespace-pre-line"
          >
            {`${statusText}
${detail}`}
          </PopoverContent>
        </Popover>
      ) : (
        <span role="status" aria-live="polite">
          {statusText}
        </span>
      )}
      <TooltipButton
        label={`${label}\n${detail}`}
        aria-label={label}
        render={<Button variant="ghost" size="icon-xs" disabled={disabled} />}
        tooltipClassName="whitespace-pre-line"
        aria-description={detail}
        onClick={() => {
          if (!disabled) void refreshBacklog({ source });
        }}
      >
        <RiRefreshLine
          className={running ? "backlog-refresh-spin" : undefined}
          aria-hidden
        />
      </TooltipButton>
    </div>
  );
}
