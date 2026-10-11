const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

function getRoundedDurationParts(durationMs: number) {
  const totalMinutes = Math.max(0, Math.round(durationMs / MS_PER_MINUTE));
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

export function formatClockDuration(durationMs: number): string {
  const { hours, minutes } = getRoundedDurationParts(durationMs);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Formats a duration as decimal hours with two places, such as "5.00" or
 * "1.25", for pasting into timesheet tools that expect decimals. Rounds to the
 * minute first so the value matches the clock time shown on screen.
 */
export function formatDecimalHours(durationMs: number): string {
  const { hours, minutes } = getRoundedDurationParts(durationMs);
  return (hours + minutes / 60).toFixed(2);
}

export function formatDurationHoursInput(durationMs: number): string {
  const { hours, minutes } = getRoundedDurationParts(durationMs);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const clockMatch = trimmed.match(/^(\d+)\s*:\s*(\d{1,2})$/);
  if (clockMatch) {
    const hours = Number(clockMatch[1]);
    const minutes = Number(clockMatch[2]);
    const durationMs = (hours * 60 + minutes) * MS_PER_MINUTE;
    if (!Number.isFinite(durationMs) || minutes >= 60) {
      return null;
    }

    return durationMs;
  }

  const normalizedDecimal = trimmed.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalizedDecimal)) {
    return null;
  }
  const hours = Number(normalizedDecimal);
  if (!Number.isFinite(hours) || hours < 0) {
    return null;
  }

  const durationMs = Math.round(hours * MS_PER_HOUR);
  return Number.isFinite(durationMs) ? durationMs : null;
}

export function formatLocalDateFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeHoursInput(value: string): string {
  const parsed = parseHoursInput(value);
  return parsed === null ? value.trim() : formatDurationHoursInput(parsed);
}
