import type {
  TimesheetChange,
  TimesheetCommitValues,
} from "@/domain/time/timesheet-commit";

/**
 * The 32-bit FNV-1a hash of `text`, as 8 lowercase hex characters. FNV-1a is
 * enough to tell a week's entries and changes apart, and Web Crypto's SHA-256
 * would need an await the read tools cannot make.
 */
function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The ID an agent writes at the end of an external timesheet entry's comment,
 * so later runs find the entry again: "ajour:" and the FNV-1a hash of the
 * Ajour entry ID. It depends on the ID only, so it never changes, whatever
 * the edit.
 */
export function externalEntryId(entryId: string): string {
  return `ajour:${fnv1aHex(entryId)}`;
}

/** The compared values as one tuple. Notes compare trimmed, as commits do. */
function versionTuple(values: TimesheetCommitValues) {
  return [
    values.localDate,
    values.projectId ?? null,
    values.taskId ?? null,
    (values.note ?? "").trim(),
    values.durationMs,
  ];
}

/**
 * The version of a change, as get_week_changes gives it: "v:" and the FNV-1a
 * hash of its kind, current values and committed values. mark_entries_committed
 * recomputes it and refuses a change whose version differs, so Ajour never
 * commits values the agent did not read. Fields a commit does not compare,
 * such as the copy's time, leave it unchanged.
 */
export function timesheetChangeVersion(change: TimesheetChange): string {
  const current = change.kind === "deleted" ? null : change.current;
  const committed = change.kind === "added" ? null : change.committed;
  return `v:${fnv1aHex(
    JSON.stringify([
      change.kind,
      current && versionTuple(current),
      committed && versionTuple(committed),
    ]),
  )}`;
}

/**
 * The version of a week's status, as get_week_status gives it: "v:" and the
 * FNV-1a hash of the week's Monday, its committed entries as the tool returns
 * them, their exact committed durations and daily totals in milliseconds, its
 * uncommitted change count and its lock. The tool rounds hours, so the exact
 * durations make a change of a few seconds change the version too.
 * submit_week recomputes it and refuses a different one, so Ajour never locks
 * a week the agent did not check. Pace is left out: it moves with the clock.
 */
export function weekStatusVersion(status: {
  weekOf: string;
  committedEntries: unknown[];
  committedDurationsMs: number[];
  committedMsByDay: number[];
  uncommittedChanges: number;
  locked: boolean;
}): string {
  return `v:${fnv1aHex(
    JSON.stringify([
      status.weekOf,
      status.committedEntries,
      status.committedDurationsMs,
      status.committedMsByDay,
      status.uncommittedChanges,
      status.locked,
    ]),
  )}`;
}
