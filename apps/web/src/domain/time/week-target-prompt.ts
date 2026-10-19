import type { LocalAppState, UserPreferences } from "@/domain/local-state";
import { getLocalWeekDates } from "@/domain/time/local-date";
import { summarizeWeek } from "@/domain/time/timesheet-submission";

/**
 * When Ajour asks to commit a week: the first write that brings the week's
 * saved total from below its capacity target to the target or above. Live
 * running time is not saved, so it never counts; stopping the entry saves it,
 * and that write can. Ajour asks once per week, whatever the answer, and
 * remembers the week in `commitPromptedWeeks`.
 *
 * Locked weeks do not exist yet (commit week slice 2). When they do, a locked
 * week must not ask either.
 */

/** What the rule reads. The full `LocalAppState` fits. */
export type WeekTargetState = Pick<
  LocalAppState,
  "timesheetEntries" | "commitPromptedWeeks"
> & {
  userPreferences: Pick<UserPreferences, "weeklyCapacityTargets">;
};

/** A week whose saved total just reached its target. */
export interface WeekTargetReached {
  /** The week's Monday, "YYYY-MM-DD". */
  weekOf: string;
  /** Monday to Sunday. */
  weekDates: string[];
  totalMs: number;
  targetMs: number;
}

/**
 * The Mondays of the weeks a write changed, in order: each week where an entry
 * was added or deleted, or changed its day or hours. A moved entry touches its
 * old week and its new one. Other edits, such as a note, touch nothing, and so
 * does a change of the targets alone.
 */
export function listTouchedWeeks(
  before: Pick<WeekTargetState, "timesheetEntries">,
  after: Pick<WeekTargetState, "timesheetEntries">,
): string[] {
  if (before.timesheetEntries === after.timesheetEntries) return [];
  const weeks = new Set<string>();
  const touch = (localDate: string) => {
    const monday = getLocalWeekDates(localDate)[0];
    if (monday) weeks.add(monday);
  };
  const previous = new Map(
    before.timesheetEntries.map((entry) => [entry._id, entry]),
  );
  for (const entry of after.timesheetEntries) {
    const old = previous.get(entry._id);
    previous.delete(entry._id);
    if (
      old &&
      old.localDate === entry.localDate &&
      old.durationMs === entry.durationMs
    ) {
      continue;
    }
    touch(entry.localDate);
    if (old) touch(old.localDate);
  }
  // What is left was deleted.
  for (const entry of previous.values()) touch(entry.localDate);
  return [...weeks].sort();
}

/**
 * The first of `touchedWeeks` whose saved total went from below its target to
 * the target or above, or null. The week needs a target above 0 and must not
 * have asked before. Both totals use the targets after the write.
 */
export function findWeekReachingTarget({
  before,
  after,
  touchedWeeks,
}: {
  before: WeekTargetState;
  after: WeekTargetState;
  touchedWeeks: readonly string[];
}): WeekTargetReached | null {
  const prompted = new Set(after.commitPromptedWeeks);
  const capacityTargets = after.userPreferences.weeklyCapacityTargets;
  const summarize = (state: WeekTargetState, weekDates: string[]) => {
    const days = new Set(weekDates);
    return summarizeWeek({
      capacityTargets,
      weekDates,
      weekEntries: state.timesheetEntries.filter((entry) =>
        days.has(entry.localDate),
      ),
    });
  };

  for (const weekOf of [...touchedWeeks].sort()) {
    if (prompted.has(weekOf)) continue;
    const weekDates = getLocalWeekDates(weekOf);
    if (weekDates[0] !== weekOf) continue;
    const now = summarize(after, weekDates);
    if (now.targetMs <= 0 || now.isUnderTarget) continue;
    if (!summarize(before, weekDates).isUnderTarget) continue;
    return {
      weekOf,
      weekDates,
      totalMs: now.totalMs,
      targetMs: now.targetMs,
    };
  }
  return null;
}

/** Remembers that Ajour asked about the week of `weekOf`. Asking twice changes nothing. */
export function markCommitPrompted<T extends WeekTargetState>(
  state: T,
  weekOf: string,
): T {
  if (state.commitPromptedWeeks.includes(weekOf)) return state;
  return {
    ...state,
    commitPromptedWeeks: [...state.commitPromptedWeeks, weekOf],
  };
}

/** Reads the stored list: strings only, each once. Anything else reads as empty. */
export function normalizeCommitPromptedWeeks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string"),
    ),
  ];
}
