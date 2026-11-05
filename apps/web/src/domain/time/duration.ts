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

/** "h:mm:ss", rounded to the second. */
function formatClockDurationWithSeconds(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Formats the two sides of a changed duration. They show as "h:mm". When two
 * different durations round to the same "h:mm", both show seconds, so a change
 * of a few seconds is still visible.
 */
export function formatChangedClockDurations(
  beforeMs: number,
  afterMs: number,
): { before: string; after: string } {
  const before = formatClockDuration(beforeMs);
  const after = formatClockDuration(afterMs);
  if (before === after && beforeMs !== afterMs) {
    return {
      before: formatClockDurationWithSeconds(beforeMs),
      after: formatClockDurationWithSeconds(afterMs),
    };
  }
  return { before, after };
}

/**
 * Formats a duration in short form for tight spaces: "4h", "4h30", "4h05" or
 * "45m". Rounds to the minute like `formatClockDuration`.
 */
export function formatCompactDuration(durationMs: number): string {
  const { hours, minutes } = getRoundedDurationParts(durationMs);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

/**
 * A duration as decimal hours with two places, such as 1.25, rounded to the
 * minute first so the value matches the clock time shown on screen. The
 * number `formatDecimalHours` writes, for agent tools.
 */
export function toDecimalHours(durationMs: number): number {
  const { hours, minutes } = getRoundedDurationParts(durationMs);
  return Number((hours + minutes / 60).toFixed(2));
}

/**
 * Formats a duration as decimal hours with two places and a decimal comma,
 * such as "5,00" or "1,25", for pasting into Workday, which reads a comma.
 * Agent tools send `toDecimalHours`, the number, not this text.
 */
export function formatDecimalHours(durationMs: number): string {
  return toDecimalHours(durationMs).toFixed(2).replace(".", ",");
}

/**
 * Hours as the fields show and take them: "0:45", "8:00", "120:00", as every
 * list reads them, with no padded hour (forms council round 9).
 */
export function formatDurationHoursInput(durationMs: number): string {
  const { hours, minutes } = getRoundedDurationParts(durationMs);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
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

  // The leading zero is optional, so ".5" reads like "0.5".
  const normalizedDecimal = trimmed.replace(",", ".");
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalizedDecimal)) {
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
