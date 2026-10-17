import { describe, expect, it } from "vitest";
import {
  computeWeekPace,
  needsPaceConfirmation,
} from "@/domain/time/week-pace";
import type { WeeklyCapacityTargets } from "@/domain/local-state";

const HOUR = 3_600_000;
const WEEK = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
];
const TARGETS: WeeklyCapacityTargets = {
  monday: 7.5 * HOUR,
  tuesday: 7.5 * HOUR,
  wednesday: 7.5 * HOUR,
  thursday: 7.5 * HOUR,
  friday: 7.5 * HOUR,
  saturday: 0,
  sunday: 0,
};
const pace = (today: string, loggedHours: number, tolerancePercent = 20) =>
  computeWeekPace({
    weekDates: WEEK,
    today,
    capacityTargets: TARGETS,
    loggedMs: loggedHours * HOUR,
    tolerancePercent,
  });

describe("computeWeekPace", () => {
  it("is on pace at the end of a full week on target", () => {
    expect(pace("2026-10-16", 37.5)).toEqual({
      loggedHours: 37.5,
      targetHours: 37.5,
      expectedHours: 37.5,
      status: "on-pace",
    });
  });

  it("counts today as past, so Wednesday expects three days", () => {
    expect(pace("2026-10-14", 22.5).expectedHours).toBe(22.5);
  });

  it("stays quiet for a front-loaded week within the tolerance", () => {
    // Wednesday expects 22.5 h; 26 h is 15.6% ahead.
    expect(pace("2026-10-14", 26).status).toBe("on-pace");
  });

  it("is over when ahead of pace past the tolerance", () => {
    expect(pace("2026-10-14", 28).status).toBe("over");
  });

  it("is over above the week's target whatever the tolerance", () => {
    expect(pace("2026-10-16", 38, 50).status).toBe("over");
  });

  it("is under when behind pace past the tolerance", () => {
    expect(pace("2026-10-16", 28).status).toBe("under");
  });

  it("expects the whole week on the weekend", () => {
    expect(pace("2026-10-18", 37.5).expectedHours).toBe(37.5);
  });

  it("is on pace for a week with no targets", () => {
    const result = computeWeekPace({
      weekDates: WEEK,
      today: "2026-10-14",
      capacityTargets: {
        ...TARGETS,
        monday: 0,
        tuesday: 0,
        wednesday: 0,
        thursday: 0,
        friday: 0,
      },
      loggedMs: 0,
      tolerancePercent: 20,
    });
    expect(result).toMatchObject({
      targetHours: 0,
      expectedHours: 0,
      status: "on-pace",
    });
  });

  it("is on pace with logged time and no targets", () => {
    expect(
      computeWeekPace({
        weekDates: WEEK,
        today: "2026-10-14",
        capacityTargets: {
          monday: 0,
          tuesday: 0,
          wednesday: 0,
          thursday: 0,
          friday: 0,
          saturday: 0,
          sunday: 0,
        },
        loggedMs: 12 * HOUR,
        tolerancePercent: 20,
      }),
    ).toMatchObject({ targetHours: 0, loggedHours: 12, status: "on-pace" });
  });

  it("expects nothing before the week starts", () => {
    expect(pace("2026-10-11", 0)).toMatchObject({
      expectedHours: 0,
      status: "on-pace",
    });
  });
});

describe("needsPaceConfirmation", () => {
  it.each([
    ["over", true, true],
    ["over", false, true],
    ["under", true, true],
    ["under", false, false],
    ["on-pace", true, false],
  ] as const)(
    "asks for a week %s with the under-target warning %s: %s",
    (status, warn, asks) => {
      expect(needsPaceConfirmation(status, warn)).toBe(asks);
    },
  );
});
