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

// Decimal hours, with a point or a comma and an optional leading zero: "1.5", ",5".
const DECIMAL = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`;
const HOUR_UNIT = String.raw`h(?:ours?|rs?)?`;
const MINUTE_UNIT = String.raw`m(?:in(?:ute)?s?)?`;
/** "1:30", "1:5" and ":45": hours are optional, minutes stay under 60. */
const CLOCK_PATTERN = /^(\d*):(\d{1,2})$/;
/** "1.5", "1,5", ".5". A bare number is hours. */
const DECIMAL_PATTERN = new RegExp(`^${DECIMAL}$`);
/** "2h", "0.5h", "1h30", "1h 30m", "1h30min". */
const HOURS_MINUTES_PATTERN = new RegExp(
  `^${DECIMAL}${HOUR_UNIT}(?:(\\d{1,2})(?:${MINUTE_UNIT})?)?$`,
);
/** "90m", "45min". */
const MINUTES_PATTERN = new RegExp(`^(\\d+)${MINUTE_UNIT}$`);

function readDecimal(text: string) {
  return Number(text.replace(",", "."));
}

function toDurationMs(hours: number, minutes: number) {
  const durationMs = Math.round(hours * MS_PER_HOUR + minutes * MS_PER_MINUTE);
  return Number.isFinite(durationMs) ? durationMs : null;
}

/**
 * Reads a typed duration in any form the app shows or people commonly type,
 * or returns null. A bare number is hours. Spaces and letter case don't matter.
 *
 * - Clock: "1:30", ":45" (0:45).
 * - Decimal hours: "1.5", "1,5", ".5" and ",5" (0:30).
 * - Units: "2h", "0.5h", "1h30", "1h 30m", "1h30m", "90m", "45min".
 *
 * Scientific notation, signs and other number syntaxes are refused. This only
 * reads the text: `readDurationInput` also applies a field's limit.
 */
export function parseHoursInput(value: string): number | null {
  const text = value.replace(/\s+/g, "").toLowerCase();
  if (!text) {
    return null;
  }

  const clock = CLOCK_PATTERN.exec(text);
  if (clock) {
    const minutes = Number(clock[2]);
    return minutes < 60 ? toDurationMs(Number(clock[1] || 0), minutes) : null;
  }

  const decimal = DECIMAL_PATTERN.exec(text);
  if (decimal) {
    return toDurationMs(readDecimal(decimal[1]!), 0);
  }

  const hoursMinutes = HOURS_MINUTES_PATTERN.exec(text);
  if (hoursMinutes) {
    const hoursText = hoursMinutes[1]!;
    const minutesText = hoursMinutes[2];
    if (minutesText === undefined) {
      return toDurationMs(readDecimal(hoursText), 0);
    }
    // "1.5h30" mixes two ways of writing a part of an hour.
    const minutes = Number(minutesText);
    if (!/^\d+$/.test(hoursText) || minutes >= 60) {
      return null;
    }
    return toDurationMs(Number(hoursText), minutes);
  }

  const minutes = MINUTES_PATTERN.exec(text);
  if (minutes) {
    return toDurationMs(0, Number(minutes[1]));
  }

  return null;
}

/** The most a typed duration may be in one field, and what to say past it. */
export interface DurationLimit {
  maxMs: number;
  error: string;
}

/** What every duration field says when it can't read the text. */
export const DURATION_FORMAT_ERROR = "Enter hours, such as 1:30, 1.5 or 1h30";

/** One time entry lasts a day at most. */
export const ENTRY_DURATION_LIMIT: DurationLimit = {
  maxMs: 24 * MS_PER_HOUR,
  error: "An entry can be at most 24:00",
};

/** A day's capacity target. */
export const DAY_CAPACITY_LIMIT: DurationLimit = {
  maxMs: 24 * MS_PER_HOUR,
  error: "A day can hold at most 24:00",
};

/** Task budgets, their adjustments and backlog estimates. */
export const PLANNED_HOURS_LIMIT: DurationLimit = {
  maxMs: 100_000 * MS_PER_HOUR,
  error: "Enter at most 100,000 hours",
};

export type DurationInputResult =
  { ok: true; durationMs: number } | { ok: false; error: string };

/**
 * Reads a typed duration and checks it against the field's limit. `signed`
 * accepts a leading "+" or "-", as a task's budget adjustment does; the limit
 * then applies to the size either way.
 */
export function readDurationInput(
  value: string,
  limit: DurationLimit,
  { signed = false }: { signed?: boolean } = {},
): DurationInputResult {
  let text = value.trim();
  let sign = 1;
  if (signed && /^[+-]/.test(text)) {
    sign = text.startsWith("-") ? -1 : 1;
    text = text.slice(1);
  }
  const durationMs = parseHoursInput(text);
  if (durationMs === null) {
    return { ok: false, error: DURATION_FORMAT_ERROR };
  }
  if (durationMs > limit.maxMs) {
    return { ok: false, error: limit.error };
  }
  // No negative zero.
  return { ok: true, durationMs: durationMs === 0 ? 0 : durationMs * sign };
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
