import { getExactDuration } from "@/domain/time/time-rounding";
import type { LocalTimer, LocalTimesheetEntry } from "@/domain/local-state";

type TimerIdentity = Pick<LocalTimer, "entryId" | "localDate">;

type TimerDurationSource = Pick<
  LocalTimer,
  "accumulatedDurationMs" | "startedAt"
>;

type TimesheetEntryIdentity = Pick<
  LocalTimesheetEntry,
  "_id" | "localDate" | "durationMs" | "exactDurationMs"
>;

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

/**
 * How much the running entry adds to its day's total. When it resumed a saved entry
 * on the same day, that entry is already counted, so only the difference is added.
 * The difference also covers a counted time correction made since it resumed.
 */
export function getTimerContributionMs(values: {
  timer: TimerIdentity | null;
  timesheetEntries: TimesheetEntryIdentity[];
  runningDurationMs: number;
}) {
  const { timer, timesheetEntries, runningDurationMs } = values;

  if (!timer) {
    return 0;
  }

  const linkedEntry = timer.entryId
    ? timesheetEntries.find(
        (entry) =>
          entry._id === timer.entryId && entry.localDate === timer.localDate,
      )
    : undefined;

  // The running entry counts on from the exact time, and the saved entry's
  // rounded time is already in the day: only the time since counts here.
  return linkedEntry
    ? runningDurationMs - getExactDuration(linkedEntry)
    : runningDurationMs;
}
