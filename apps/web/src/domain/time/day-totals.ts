import type { LocalTimesheetEntry } from "@/domain/local-state";

/**
 * Saved time on each of `dates`, in that order, with zero for an empty day.
 * A running entry is added on top by its caller, through
 * `getTimerContributionMs`, so a clock tick never recounts saved entries.
 */
export function sumSavedDurationsByDate(
  timesheetEntries: readonly Pick<
    LocalTimesheetEntry,
    "localDate" | "durationMs"
  >[],
  dates: readonly string[],
): Map<string, number> {
  const totals = new Map(dates.map((date) => [date, 0]));
  for (const entry of timesheetEntries) {
    const total = totals.get(entry.localDate);
    if (total !== undefined)
      totals.set(entry.localDate, total + entry.durationMs);
  }
  return totals;
}
