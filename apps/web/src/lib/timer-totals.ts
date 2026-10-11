import type { LocalTimer, LocalTimesheetEntry } from "@/domain/local-state";

type TimerIdentity = Pick<LocalTimer, "entryId" | "localDate">;

type TimerDurationSource = Pick<
  LocalTimer,
  "accumulatedDurationMs" | "startedAt"
>;

type TimesheetEntryIdentity = Pick<LocalTimesheetEntry, "_id" | "localDate">;

export function getTimerDurationsMs(
  timer: TimerDurationSource | null,
  now: number,
) {
  if (!timer) {
    return {
      elapsedDurationMs: 0,
      runningDurationMs: 0,
    };
  }

  const elapsedDurationMs = Math.max(0, now - timer.startedAt);

  return {
    elapsedDurationMs,
    runningDurationMs: timer.accumulatedDurationMs + elapsedDurationMs,
  };
}

export function getTimerContributionMs(values: {
  timer: TimerIdentity | null;
  timesheetEntries: TimesheetEntryIdentity[];
  elapsedDurationMs: number;
  runningDurationMs: number;
}) {
  const { timer, timesheetEntries, elapsedDurationMs, runningDurationMs } =
    values;

  if (!timer) {
    return 0;
  }

  const hasLinkedTimerEntry =
    Boolean(timer.entryId) &&
    timesheetEntries.some(
      (entry) =>
        entry._id === timer.entryId && entry.localDate === timer.localDate,
    );

  return hasLinkedTimerEntry ? elapsedDurationMs : runningDurationMs;
}
