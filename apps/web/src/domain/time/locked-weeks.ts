import type { LocalAppState, LocalLockedWeek } from "@/domain/local-state";
import { getWeekOf, isValidLocalDate } from "@/domain/time/local-date";

/**
 * Submitted weeks. Submitting a week locks it: its entries are read-only
 * everywhere, for agents too, until the user reopens it. One rule decides
 * whether a day is locked, `isDateLocked`. See
 * docs/superpowers/specs/2026-10-15-commit-week-design.md.
 */

type LockState = Pick<LocalAppState, "lockedWeeks">;

/** The refusal of every write to a submitted week. `weekOf` is its Monday. */
export function lockedWeekMessage(weekOf: string) {
  return `The week of ${weekOf} is submitted. Reopen it to change it.`;
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
