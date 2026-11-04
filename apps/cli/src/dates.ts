/**
 * Calendar arithmetic on YYYY-MM-DD dates, as Ajour dates its entries. Days
 * count in UTC, so a change to or from summer time never skips or repeats
 * one. Weeks run Monday to Sunday, numbered as ISO 8601 does.
 */

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a YYYY-MM-DD date. */
export function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY_MS;
}

export function fromDayNumber(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** 0 for Monday to 6 for Sunday. */
export function weekdayIndex(date: string): number {
  return (new Date(dayNumber(date) * DAY_MS).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/** Whether year, month and day name a real date. */
export function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export interface IsoWeek {
  year: number;
  week: number;
}

/** The ISO week a date falls in: the week holding its Thursday. */
export function isoWeekOf(date: string): IsoWeek {
  const thursday = addDays(mondayOf(date), 3);
  const year = Number(thursday.slice(0, 4));
  const firstThursday = addDays(mondayOf(`${year}-01-04`), 3);
  return {
    year,
    week: (dayNumber(thursday) - dayNumber(firstThursday)) / 7 + 1,
  };
}

/** 53 when the year starts on a Thursday, or on a Wednesday in a leap year. */
export function isoWeeksIn(year: number): number {
  return isoWeekOf(`${year}-12-28`).week;
}

/** The Monday of an ISO week. Week 1 holds 4 January. */
export function isoWeekMonday(year: number, week: number): string {
  return addDays(mondayOf(`${year}-01-04`), (week - 1) * 7);
}

/** Each date from `from` to `to`, both included. */
export function datesBetween(from: string, to: string): string[] {
  const first = dayNumber(from);
  return Array.from({ length: dayNumber(to) - first + 1 }, (_, index) =>
    fromDayNumber(first + index),
  );
}
