const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `value` is a real calendar day as "YYYY-MM-DD". The shape alone
 * lets "2026-02-30" through; the round trip through a date does not.
 */
export function isValidLocalDate(value: string) {
  const match = value.match(ISO_DATE_PATTERN);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The Monday-to-Sunday week that holds `localDate`, as seven "YYYY-MM-DD"
 * days. Empty for a value that is not a real day. Calendar math in UTC, so the
 * result does not depend on the time zone.
 */
export function getLocalWeekDates(localDate: string): string[] {
  if (!isValidLocalDate(localDate)) return [];
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const monday = new Date(Date.UTC(year, month - 1, day));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return formatUtcDate(date);
  });
}

/**
 * The Monday of the week that holds `localDate`, `YYYY-MM-DD`. Weeks run
 * Monday to Sunday. The arithmetic is in UTC on the date alone, so the time
 * zone and daylight saving time never move a day to another week. Pass a
 * valid date (see `isValidLocalDate`).
 */
export function getWeekOf(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  // getUTCDay counts from Sunday, 0. Monday starts the week.
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** The seven days of the week that holds `localDate`, Monday first. */
export function getWeekDates(localDate: string): string[] {
  const monday = new Date(`${getWeekOf(localDate)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A day in the app's short form, such as "Oct 5", with the year when it is
 * not `currentYear`, such as "Dec 29, 2025". Pass a valid date.
 */
export function formatShortLocalDate(localDate: string, currentYear: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const monthDay = `${SHORT_MONTHS[month! - 1]} ${day}`;
  return year === currentYear ? monthDay : `${monthDay}, ${year}`;
}
