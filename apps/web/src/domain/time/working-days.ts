import type { WeeklyCapacityTargets } from "@/domain/local-state";

/**
 * Non-working days: the weekdays whose Time capacity in Settings › General is
 * zero, Saturday and Sunday by default. Ajour keeps their time out of the
 * commit. One rule decides it, `isNonWorkingDay`.
 */

/** Monday first, as `getWeekDates` lists a week. */
const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly (keyof WeeklyCapacityTargets)[];

/** 0 for Monday to 6 for Sunday. Computed on the date alone, like `getWeekOf`. */
function weekdayIndex(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  return (new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() + 6) % 7;
}

/**
 * The one rule: `localDate` falls on a weekday with no capacity. When no
 * weekday has any capacity, Ajour has no working days to go by, so no day is
 * a non-working day. Pass a valid date.
 */
export function isNonWorkingDay(
  capacityTargets: WeeklyCapacityTargets,
  localDate: string,
) {
  if (WEEKDAYS.every((weekday) => capacityTargets[weekday] <= 0)) return false;
  return capacityTargets[WEEKDAYS[weekdayIndex(localDate)]!] <= 0;
}
