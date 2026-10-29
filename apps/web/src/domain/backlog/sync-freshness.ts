import type { PluginConnectionSummary } from "@ajour/shared";

/** A successful check is evidence of freshness; a failed attempt never is. */
export function syncAge(at: number | undefined, now: number) {
  if (!at) return "unknown";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (!minutes) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

export function connectionSyncWarning(
  connection: PluginConnectionSummary,
  enabled: boolean,
  lastSuccessAt: number | undefined,
  failedAt: number | undefined,
  now: number,
  automaticFailure = false,
) {
  if (!enabled || connection.paused) return "Sync paused";
  if (failedAt && failedAt > (lastSuccessAt ?? 0))
    return automaticFailure ? "Auto sync failed" : "Sync failed";
  if (!connection.autoSync) return "Scheduled sync off";
  // The scheduler checks every 30 seconds. Let that polling window pass
  // before calling an automatic sync overdue.
  if (
    !lastSuccessAt ||
    now - lastSuccessAt > connection.autoSyncIntervalMinutes * 60_000 + 30_000
  )
    return "Sync overdue";
  return undefined;
}
