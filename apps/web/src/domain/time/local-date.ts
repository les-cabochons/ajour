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
