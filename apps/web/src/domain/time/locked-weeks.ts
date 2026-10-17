import type { LocalAppState, LocalLockedWeek } from "@/domain/local-state";
import { recordsEqual } from "@/domain/local-state-undo";
import {
  formatShortLocalDate,
  getWeekDates,
  getWeekOf,
  isValidLocalDate,
} from "@/domain/time/local-date";
import { listWeekChanges } from "@/domain/time/timesheet-commit";

/**
 * Submitted weeks. Submitting a week locks it: its entries are read-only
 * everywhere, for agents too, until the user reopens it. One rule decides
 * whether a day is locked, `isDateLocked`. See
 * docs/superpowers/specs/2026-10-15-commit-week-design.md.
 */

type LockState = Pick<LocalAppState, "lockedWeeks">;

/**
 * The refusal of every write to a submitted week, for the UI and agents.
 * `weekOf` is its Monday, shown as "Oct 5", with the year when it is not
 * `currentYear`.
 */
export function lockedWeekMessage(
  weekOf: string,
  currentYear = new Date().getFullYear(),
) {
  return `The week of ${formatShortLocalDate(weekOf, currentYear)} is submitted. Reopen it to change it.`;
}

/** The submitted week that holds `localDate`, or undefined. An invalid date is in none. */
export function getLockedWeek(
  state: LockState,
  localDate: string,
): LocalLockedWeek | undefined {
  if (!isValidLocalDate(localDate)) return undefined;
  const weekOf = getWeekOf(localDate);
  return state.lockedWeeks.find((week) => week.weekOf === weekOf);
}

/** The one rule: a day is locked when its week is submitted. */
export function isDateLocked(state: LockState, localDate: string) {
  return getLockedWeek(state, localDate) !== undefined;
}

/** Why entries on `localDate` cannot change, or undefined when they can. */
export function getDateLockReason(
  state: LockState,
  localDate: string,
): string | undefined {
  const week = getLockedWeek(state, localDate);
  return week ? lockedWeekMessage(week.weekOf) : undefined;
}

/**
 * Reads stored submitted weeks. Drops malformed ones, moves a date that is not
 * a Monday to its Monday, keeps the first record of a week, and sorts them.
 */
export function normalizeLockedWeeks(value: unknown): LocalLockedWeek[] {
  if (!Array.isArray(value)) return [];
  const byWeek = new Map<string, LocalLockedWeek>();
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { weekOf, lockedAt } = item as Record<string, unknown>;
    if (
      typeof weekOf !== "string" ||
      !isValidLocalDate(weekOf) ||
      typeof lockedAt !== "number" ||
      !Number.isFinite(lockedAt)
    ) {
      continue;
    }
    const monday = getWeekOf(weekOf);
    if (!byWeek.has(monday)) byWeek.set(monday, { weekOf: monday, lockedAt });
  }
  return [...byWeek.values()].sort((left, right) =>
    left.weekOf.localeCompare(right.weekOf),
  );
}

/** A write Ajour refused because it changes a submitted week. */
export class LockedWeekError extends Error {
  readonly weekOf: string;

  constructor(weekOf: string) {
    super(lockedWeekMessage(weekOf));
    this.name = "LockedWeekError";
    this.weekOf = weekOf;
  }
}

/** The part of the state the write check reads. */
export type LockCheckState = Pick<
  LocalAppState,
  "lockedWeeks" | "timesheetEntries" | "timesheetTombstones" | "timers"
>;

/**
 * The submitted week a write changes, or undefined when it changes none. A
 * week counts when it is submitted before and after the write, so Submit,
 * Reopen and their Undo pass. The write changes it when it adds, changes or
 * removes an entry on one of its days (the entry's day before or after the
 * write), a tombstone whose committed day is in it, or a running entry on one
 * of its days. Records compare by value, so a write that rebuilds an equal
 * record passes.
 */
export function findLockedWeekWrite(
  before: LockCheckState,
  after: LockCheckState,
): string | undefined {
  const lockedAfter = new Set(after.lockedWeeks.map((week) => week.weekOf));
  const locked = new Set(
    before.lockedWeeks
      .map((week) => week.weekOf)
      .filter((weekOf) => lockedAfter.has(weekOf)),
  );
  if (locked.size === 0) return undefined;

  const lockedWeekOf = (localDate: string) => {
    if (!isValidLocalDate(localDate)) return undefined;
    const weekOf = getWeekOf(localDate);
    return locked.has(weekOf) ? weekOf : undefined;
  };
  return (
    findChangedDay(
      before.timesheetEntries,
      after.timesheetEntries,
      (entry) => entry._id,
      (entry) => entry.localDate,
      lockedWeekOf,
    ) ??
    findChangedDay(
      before.timesheetTombstones,
      after.timesheetTombstones,
      (tombstone) => tombstone.entryId,
      (tombstone) => tombstone.commit.localDate,
      lockedWeekOf,
    ) ??
    findChangedDay(
      before.timers,
      after.timers,
      (timer) => timer._id,
      (timer) => timer.localDate,
      lockedWeekOf,
    )
  );
}

/** Throws `LockedWeekError` when the write changes a submitted week. */
export function assertNoLockedWeekWrite(
  before: LockCheckState,
  after: LockCheckState,
) {
  const weekOf = findLockedWeekWrite(before, after);
  if (weekOf) throw new LockedWeekError(weekOf);
}

/**
 * The first locked week among the days of the records a write added, changed
 * or removed. A changed record counts its day before and after the write.
 */
function findChangedDay<T>(
  before: readonly T[],
  after: readonly T[],
  keyOf: (record: T) => string,
  dayOf: (record: T) => string,
  lockedWeekOf: (localDate: string) => string | undefined,
): string | undefined {
  if (before === after) return undefined;
  const beforeByKey = new Map(before.map((record) => [keyOf(record), record]));
  const afterKeys = new Set<string>();
  for (const record of after) {
    const key = keyOf(record);
    afterKeys.add(key);
    const previous = beforeByKey.get(key);
    if (previous === record || recordsEqual(previous, record)) continue;
    const weekOf =
      (previous ? lockedWeekOf(dayOf(previous)) : undefined) ??
      lockedWeekOf(dayOf(record));
    if (weekOf) return weekOf;
  }
  for (const record of before) {
    if (afterKeys.has(keyOf(record))) continue;
    const weekOf = lockedWeekOf(dayOf(record));
    if (weekOf) return weekOf;
  }
  return undefined;
}

/** Why a week cannot be submitted now. `message` is the agents' refusal; the Commit page words each kind its own way. */
export type SubmitWeekRefusal =
  | { kind: "already-submitted"; message: string }
  | { kind: "uncommitted-changes"; count: number; message: string }
  | { kind: "running-entry"; message: string };

export type SubmitWeekResult =
  { ok: true; weekOf: string } | ({ ok: false } & SubmitWeekRefusal);

/**
 * Why the week that holds `weekOf` cannot be submitted, or undefined when it
 * can: it is already submitted, a change is not committed, or the running
 * entry is on one of its days, in that order.
 */
export function getSubmitWeekRefusal(
  state: Pick<
    LocalAppState,
    "lockedWeeks" | "timesheetEntries" | "timesheetTombstones" | "timers"
  >,
  weekOf: string,
): SubmitWeekRefusal | undefined {
  const monday = getWeekOf(weekOf);
  if (state.lockedWeeks.some((week) => week.weekOf === monday)) {
    return {
      kind: "already-submitted",
      message: `The week of ${monday} is already submitted.`,
    };
  }

  const weekDates = getWeekDates(monday);
  const count = listWeekChanges({
    entries: state.timesheetEntries,
    tombstones: state.timesheetTombstones,
    weekDates,
  }).length;
  if (count > 0) {
    const changes =
      count === 1 ? "1 change that is" : `${count} changes that are`;
    return {
      kind: "uncommitted-changes",
      count,
      message: `Commit your changes first. The week of ${monday} has ${changes} not committed.`,
    };
  }

  const running = state.timers.find((timer) =>
    weekDates.includes(timer.localDate),
  );
  if (running) {
    return {
      kind: "running-entry",
      message: `Stop the running entry first. It is on ${running.localDate}, in the week of ${monday}.`,
    };
  }
  return undefined;
}

/**
 * Submits the week that holds `weekOf`: locks it. A week only locks with
 * every change committed, so it has no tombstone left to drop. Returns the
 * same state with the refusal when it cannot.
 */
export function submitWeek(
  state: LocalAppState,
  weekOf: string,
  now: () => number,
): { state: LocalAppState; result: SubmitWeekResult } {
  const refusal = getSubmitWeekRefusal(state, weekOf);
  if (refusal) return { state, result: { ok: false, ...refusal } };

  const monday = getWeekOf(weekOf);
  return {
    state: {
      ...state,
      lockedWeeks: [
        ...state.lockedWeeks,
        { weekOf: monday, lockedAt: now() },
      ].sort((left, right) => left.weekOf.localeCompare(right.weekOf)),
    },
    result: { ok: true, weekOf: monday },
  };
}

/**
 * Reopens the week that holds `weekOf`. Its entries keep their committed
 * copies, so later edits show as changes again. Returns the same state when
 * the week is not submitted.
 */
export function reopenWeek(
  state: LocalAppState,
  weekOf: string,
): LocalAppState {
  const monday = getWeekOf(weekOf);
  const lockedWeeks = state.lockedWeeks.filter(
    (week) => week.weekOf !== monday,
  );
  return lockedWeeks.length === state.lockedWeeks.length
    ? state
    : { ...state, lockedWeeks };
}
