import type {
  UserPreferences,
  WeeklyCapacityTargets,
} from "@/domain/local-state";

/**
 * Whether the week's logged time keeps pace with its capacity targets. The
 * agent asks the user before entering a week that is not on pace, so the
 * arithmetic lives here, in tested code, not in a prompt.
 */

export type WeekPaceStatus = "on-pace" | "under" | "over";

export const DEFAULT_PACE_TOLERANCE_PERCENT = 20;

const HOUR = 3_600_000;
const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly (keyof WeeklyCapacityTargets)[];

export function getPaceTolerancePercent(preferences: UserPreferences) {
  return preferences.paceTolerancePercent ?? DEFAULT_PACE_TOLERANCE_PERCENT;
}

const toHours = (ms: number) => Math.round((ms / HOUR) * 100) / 100;

/**
 * `weekDates` runs Monday to Sunday. Days up to and including `today` count
 * as past, and only days with a target count as workdays, so the expected
 * hours are the targets of the past days. Over the week's target is always
 * `over`. A week with no target at all is always `on-pace`: there is nothing
 * to check it against. Otherwise more than `tolerancePercent` away from the expected
 * hours is `over` or `under`.
 */
export function computeWeekPace({
  weekDates,
  today,
  capacityTargets,
  loggedMs,
  tolerancePercent,
}: {
  weekDates: string[];
  today: string;
  capacityTargets: WeeklyCapacityTargets;
  loggedMs: number;
  tolerancePercent: number;
}): {
  loggedHours: number;
  targetHours: number;
  expectedHours: number;
  status: WeekPaceStatus;
} {
  let targetMs = 0;
  let expectedMs = 0;
  weekDates.forEach((date, index) => {
    const dayTarget = capacityTargets[DAY_KEYS[index]!];
    targetMs += dayTarget;
    if (date <= today) expectedMs += dayTarget;
  });
  const tolerance = (expectedMs * tolerancePercent) / 100;
  const status: WeekPaceStatus =
    targetMs === 0
      ? "on-pace"
      : loggedMs > targetMs
        ? "over"
        : loggedMs > expectedMs + tolerance
          ? "over"
          : loggedMs < expectedMs - tolerance
            ? "under"
            : "on-pace";
  return {
    loggedHours: toHours(loggedMs),
    targetHours: toHours(targetMs),
    expectedHours: toHours(expectedMs),
    status,
  };
}
