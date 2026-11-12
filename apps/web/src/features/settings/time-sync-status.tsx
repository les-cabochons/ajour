import type { LocalTimeSync } from "@/domain/local-state";
import { describeTimeSyncStatus } from "@/domain/projects/time-sync";

/**
 * A connection row's time sync line (#692): what the last round sent, or
 * that it is up to date, why the last round failed, and each refusal's
 * message in the plugin's words. Nothing before the first round.
 */
export function TimeSyncStatusLine({
  timeSync,
}: {
  timeSync: LocalTimeSync | undefined;
}) {
  const status = describeTimeSyncStatus(timeSync);
  if (!status) return null;
  return (
    <>
      <p className="text-xs text-[var(--text-tertiary)]">{status.summary}</p>
      {status.error ? (
        <p className="text-sm break-words text-destructive">{status.error}</p>
      ) : null}
      {status.notes.map((note) => (
        <p key={note} className="text-sm break-words text-muted-foreground">
          {note}
        </p>
      ))}
    </>
  );
}
