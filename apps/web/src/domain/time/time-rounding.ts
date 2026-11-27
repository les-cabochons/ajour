import type {
  LocalAppState,
  LocalLockedWeek,
  LocalTimesheetEntry,
  TimeRoundingMode,
  TimeRoundingRule,
  TimeRoundingSettings,
  UserPreferences,
} from "@/domain/local-state";
import { isDateLocked } from "@/domain/time/locked-weeks";

/**
 * Rounding: each entry's time rounds by a rule the user picks, and only the
 * rounded time is shown, committed and synced. The entry keeps its exact
 * time out of sight, so a rule change re-rounds from it. See GLOSSARY.md.
 */

const MINUTE_MS = 60_000;

export const TIME_ROUNDING_MODES: readonly TimeRoundingMode[] = [
  "off",
  "nearest",
  "up",
  "down",
];
export const TIME_ROUNDING_STEPS = [1, 5, 10, 15] as const;
export const TIME_ROUNDING_MINIMUMS = [0, 5, 10, 15, 30, 60] as const;

/** The nearest minute, no minimum: what lists showed before rounding. */
export const DEFAULT_TIME_ROUNDING: TimeRoundingSettings = {
  mode: "nearest",
  stepMinutes: 1,
  minimumMinutes: 0,
  roundTypedHours: true,
};

export interface TimeRoundingPreset {
  id: string;
  label: string;
  mode: TimeRoundingMode;
  stepMinutes: number;
}

/** The Rounding menu's named rules, in its order. Custom… follows them. */
export const TIME_ROUNDING_PRESETS: readonly TimeRoundingPreset[] = [
  { id: "off", label: "Exact, to the second", mode: "off", stepMinutes: 1 },
  { id: "nearest-1", label: "Nearest minute", mode: "nearest", stepMinutes: 1 },
  {
    id: "nearest-5",
    label: "Nearest 5 minutes",
    mode: "nearest",
    stepMinutes: 5,
  },
  {
    id: "nearest-15",
    label: "Nearest 15 minutes",
    mode: "nearest",
    stepMinutes: 15,
  },
  { id: "up-5", label: "Up to 5 minutes", mode: "up", stepMinutes: 5 },
  { id: "up-15", label: "Up to 15 minutes", mode: "up", stepMinutes: 15 },
  { id: "down-15", label: "Down to 15 minutes", mode: "down", stepMinutes: 15 },
];

/** The preset a rule's mode and step make, or undefined for a custom rule. */
export function findTimeRoundingPreset(
  rule: Pick<TimeRoundingRule, "mode" | "stepMinutes">,
): TimeRoundingPreset | undefined {
  return TIME_ROUNDING_PRESETS.find(
    (preset) =>
      preset.mode === rule.mode &&
      (rule.mode === "off" || preset.stepMinutes === rule.stepMinutes),
  );
}

/** "Up to 10 minutes", "Nearest minute", "Exact": a rule's mode and step in words. */
export function describeTimeRoundingStep(
  rule: Pick<TimeRoundingRule, "mode" | "stepMinutes">,
): string {
  if (rule.mode === "off") return "Exact";
  const one = rule.stepMinutes === 1;
  if (rule.mode === "nearest") {
    return one ? "Nearest minute" : `Nearest ${rule.stepMinutes} minutes`;
  }
  const direction = rule.mode === "up" ? "Up" : "Down";
  return one
    ? `${direction} to the minute`
    : `${direction} to ${rule.stepMinutes} minutes`;
}

/** "30 min" or "1 h": a minimum as its menu shows it. */
export function formatTimeRoundingMinimum(minutes: number): string {
  if (minutes === 0) return "None";
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

/** A whole rule in words: "Up to 15 minutes, at least 30 min". */
export function describeTimeRounding(rule: TimeRoundingRule): string {
  const step = describeTimeRoundingStep(rule);
  return rule.minimumMinutes > 0
    ? `${step}, at least ${formatTimeRoundingMinimum(rule.minimumMinutes)}`
    : step;
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** A stored rule, with each unknown value back to the default's. */
export function normalizeTimeRoundingRule(value: unknown): TimeRoundingRule {
  const record = readRecord(value);
  return {
    mode: pick(record.mode, TIME_ROUNDING_MODES, DEFAULT_TIME_ROUNDING.mode),
    stepMinutes: pick<number>(
      record.stepMinutes,
      TIME_ROUNDING_STEPS,
      DEFAULT_TIME_ROUNDING.stepMinutes,
    ),
    minimumMinutes: pick<number>(
      record.minimumMinutes,
      TIME_ROUNDING_MINIMUMS,
      0,
    ),
  };
}

/** The user's stored rounding, with each unknown value back to the default's. */
export function normalizeTimeRounding(value: unknown): TimeRoundingSettings {
  const record = readRecord(value);
  return {
    ...normalizeTimeRoundingRule(value),
    roundTypedHours:
      typeof record.roundTypedHours === "boolean"
        ? record.roundTypedHours
        : DEFAULT_TIME_ROUNDING.roundTypedHours,
  };
}

export function getTimeRounding(
  preferences: Pick<UserPreferences, "timeRounding"> | undefined,
): TimeRoundingSettings {
  return preferences?.timeRounding ?? DEFAULT_TIME_ROUNDING;
}

/**
 * Rounds a time by a rule: the step first, then the minimum. A time of 0
 * stays 0, so the minimum never makes time out of nothing.
 */
export function roundEntryDuration(
  exactMs: number,
  rule: TimeRoundingRule,
): number {
  if (!(exactMs > 0)) return 0;
  const stepMs = rule.stepMinutes * MINUTE_MS;
  const stepped =
    rule.mode === "nearest"
      ? Math.round(exactMs / stepMs) * stepMs
      : rule.mode === "up"
        ? Math.ceil(exactMs / stepMs) * stepMs
        : rule.mode === "down"
          ? Math.floor(exactMs / stepMs) * stepMs
          : exactMs;
  return Math.max(stepped, rule.minimumMinutes * MINUTE_MS);
}

/** The time an entry was counted or typed with, before rounding. */
export function getExactDuration(
  entry: Pick<LocalTimesheetEntry, "durationMs" | "exactDurationMs">,
): number {
  return entry.exactDurationMs ?? entry.durationMs;
}

/** What rounding reads: the user's preferences. */
export type TimeRoundingState = {
  userPreferences?: Pick<UserPreferences, "timeRounding">;
};

/** The duration fields an entry stores for a time. */
export type EntryDurationFields = Pick<
  LocalTimesheetEntry,
  "durationMs" | "exactDurationMs" | "durationTyped"
>;

/**
 * The rule an entry's time rounds by.
 */
export function getEntryRoundingRule(
  state: TimeRoundingState,
): TimeRoundingRule {
  return getTimeRounding(state.userPreferences);
}

/**
 * The stored duration fields for an entry's exact time. `typed` is a time
 * typed or from outside Ajour's timer, which rounds only while Round typed
 * hours too is on.
 */
export function roundEntryTime(
  state: TimeRoundingState,
  exactMs: number,
  { typed = false }: { typed?: boolean } = {},
): EntryDurationFields {
  const settings = getTimeRounding(state.userPreferences);
  const durationMs =
    typed && !settings.roundTypedHours
      ? exactMs
      : roundEntryDuration(exactMs, getEntryRoundingRule(state));
  return {
    durationMs,
    ...(durationMs !== exactMs ? { exactDurationMs: exactMs } : {}),
    ...(typed ? { durationTyped: true as const } : {}),
  };
}

/**
 * An entry with its duration fields set for an exact time. Fields it held
 * before are dropped, so an exact time that needs none stores none.
 */
export function withEntryTime<Entry extends LocalTimesheetEntry>(
  entry: Entry,
  fields: EntryDurationFields,
): Entry {
  const { exactDurationMs: _exact, durationTyped: _typed, ...rest } = entry;
  return { ...rest, ...fields } as Entry;
}

/**
 * Re-rounds every entry outside a submitted week from its exact time, after
 * a rule changed. Committed entries whose time changes show as updated.
 * Backlog estimates stay as they are.
 */
export function reroundTimesheetEntries<
  State extends TimeRoundingState &
    Pick<LocalAppState, "timesheetEntries"> & {
      lockedWeeks: LocalLockedWeek[];
    },
>(state: State): State {
  let changed = false;
  const timesheetEntries = state.timesheetEntries.map((entry) => {
    if (isDateLocked(state, entry.localDate)) return entry;
    const fields = roundEntryTime(state, getExactDuration(entry), {
      typed: entry.durationTyped === true,
    });
    if (
      fields.durationMs === entry.durationMs &&
      fields.exactDurationMs === entry.exactDurationMs
    ) {
      return entry;
    }
    changed = true;
    return withEntryTime(entry, fields);
  });
  return changed ? { ...state, timesheetEntries } : state;
}
