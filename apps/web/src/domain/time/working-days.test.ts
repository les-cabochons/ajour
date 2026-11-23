import { describe, expect, it } from "vitest";
import type { WeeklyCapacityTargets } from "@/domain/local-state";
import { isNonWorkingDay } from "@/domain/time/working-days";

const HOUR = 3_600_000;
const WEEKDAYS_ONLY: WeeklyCapacityTargets = {
  monday: 8 * HOUR,
  tuesday: 8 * HOUR,
  wednesday: 8 * HOUR,
  thursday: 8 * HOUR,
  friday: 8 * HOUR,
  saturday: 0,
  sunday: 0,
};
const NO_CAPACITY: WeeklyCapacityTargets = {
  monday: 0,
  tuesday: 0,
  wednesday: 0,
  thursday: 0,
  friday: 0,
  saturday: 0,
  sunday: 0,
};

describe("isNonWorkingDay", () => {
  it("is true on a weekday with no capacity and false on one with some", () => {
    // 2026-11-20 is a Friday, 2026-11-21 a Saturday, 2026-11-22 a Sunday.
    expect(isNonWorkingDay(WEEKDAYS_ONLY, "2026-11-20")).toBe(false);
    expect(isNonWorkingDay(WEEKDAYS_ONLY, "2026-11-21")).toBe(true);
    expect(isNonWorkingDay(WEEKDAYS_ONLY, "2026-11-22")).toBe(true);
    expect(isNonWorkingDay(WEEKDAYS_ONLY, "2026-11-23")).toBe(false);
  });

  it("follows the capacity, not the calendar", () => {
    const wednesdayOff = {
      ...WEEKDAYS_ONLY,
      wednesday: 0,
      saturday: 4 * HOUR,
    };
    expect(isNonWorkingDay(wednesdayOff, "2026-11-18")).toBe(true);
    expect(isNonWorkingDay(wednesdayOff, "2026-11-21")).toBe(false);
  });

  it("calls no day a non-working day when no weekday has capacity", () => {
    expect(isNonWorkingDay(NO_CAPACITY, "2026-11-21")).toBe(false);
    expect(isNonWorkingDay(NO_CAPACITY, "2026-11-20")).toBe(false);
  });
});
