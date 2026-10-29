import { useSyncExternalStore } from "react";
import { isCapabilityActive } from "@ajour/shared";
import { RiRefreshLine, RiErrorWarningLine } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  connectionSyncWarning,
  syncAge,
} from "@/domain/backlog/sync-freshness";
import {
  getCachedPluginsOverview,
  subscribePluginsOverview,
  syncBacklogConnection,
  getPluginsOverview,
  asPoll,
} from "@/lib/app-api";
import {
  getBacklogSyncSnapshot,
  subscribeBacklogSync,
  getBacklogSyncAvailability,
} from "@/lib/backlog-sync-status";
import { useNow } from "@/lib/use-now";

export interface BacklogRefreshSource {
  pluginId: string;
  connectionId: string;
  sourceId: string;
  syncedAt?: number;
}

/** One isolated readout, shared by the backlog, item page and peek. */
export function BacklogRefresh({
  source,
  hasSyncedItems = false,
}: {
  source?: BacklogRefreshSource;
  hasSyncedItems?: boolean;
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
  const refresh = async () => {
    if (disabled) return;
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
                (c) =>
                  !c.paused &&
                  !getBacklogSyncSnapshot().some(
                    (s) =>
                      s.pluginId === group.plugin.id &&
                      s.connectionId === c.id &&
                      s.running > 0,
                  ) &&
                  (!source || c.id === source.connectionId),
              )
              .map((connection) => ({ pluginId: group.plugin.id, connection }))
          : [],
      );
      // Match the scheduler's sequential admission so several connections
      // cannot exhaust their plugin's operation quota.
      for (const row of targets) {
        try {
          await syncBacklogConnection(row.pluginId, row.connection.id, {
            refresh: true,
            ...(source ? { sourceId: source.sourceId } : {}),
          });
        } catch {
          // Keep refreshing the other connections. Each failure stays visible.
        }
      }
    } catch {
      /* The shared availability state keeps the failure visible. */
    }
  };
  return (
    <div className="backlog-refresh" aria-busy={running}>
      {warning && !running ? (
        <RiErrorWarningLine className="backlog-refresh-warning" aria-hidden />
      ) : null}
      <span role="status" aria-live="polite">
        {running
          ? "Syncing…"
          : warning
            ? `${warning} · ${age.toLowerCase()}`
            : age}
      </span>
      <TooltipButton
        label={`${label}\n${detail}`}
        aria-label={label}
        render={<Button variant="ghost" size="icon-xs" disabled={disabled} />}
        tooltipClassName="whitespace-pre-line"
        aria-description={detail}
        onClick={() => void refresh()}
      >
        <RiRefreshLine
          className={running ? "backlog-refresh-spin" : undefined}
          aria-hidden
        />
      </TooltipButton>
    </div>
  );
}
