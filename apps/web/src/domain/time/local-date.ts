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
