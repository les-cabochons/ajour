import { describe, expect, it } from "vitest";
import {
  getDateLockReason,
  getLockedWeek,
  isDateLocked,
  lockedWeekMessage,
  normalizeLockedWeeks,
} from "@/domain/time/locked-weeks";

const submitted = { lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 50 }] };

describe("isDateLocked", () => {
  it("locks every day from Monday to Sunday of a submitted week", () => {
    for (const day of ["2026-10-05", "2026-10-08", "2026-10-11"]) {
      expect(isDateLocked(submitted, day)).toBe(true);
    }
    expect(isDateLocked(submitted, "2026-10-04")).toBe(false);
    expect(isDateLocked(submitted, "2026-10-12")).toBe(false);
  });

  it("reads a half-typed or impossible date as not locked", () => {
    expect(isDateLocked(submitted, "2026-10-0")).toBe(false);
    expect(isDateLocked(submitted, "2026-02-30")).toBe(false);
  });

  it("names the week and the way out", () => {
    expect(lockedWeekMessage("2026-10-05")).toBe(
      "The week of 2026-10-05 is submitted. Reopen it to change it.",
    );
    expect(getDateLockReason(submitted, "2026-10-11")).toBe(
      "The week of 2026-10-05 is submitted. Reopen it to change it.",
    );
    expect(getDateLockReason(submitted, "2026-10-12")).toBeUndefined();
    expect(getLockedWeek(submitted, "2026-10-09")).toEqual({
      weekOf: "2026-10-05",
      lockedAt: 50,
    });
  });
});

describe("normalizeLockedWeeks", () => {
  it("keeps valid weeks on their Monday, once each, in week order", () => {
    expect(
      normalizeLockedWeeks([
        { weekOf: "2026-10-14", lockedAt: 7 },
        { weekOf: "2026-10-05", lockedAt: 5 },
        { weekOf: "2026-10-12", lockedAt: 9 },
        { weekOf: "2026-02-30", lockedAt: 1 },
        { weekOf: "2026-10-19" },
        "2026-10-26",
        null,
      ]),
    ).toEqual([
      { weekOf: "2026-10-05", lockedAt: 5 },
      { weekOf: "2026-10-12", lockedAt: 7 },
    ]);
  });

  it("reads anything but a list as no submitted week", () => {
    expect(normalizeLockedWeeks(undefined)).toEqual([]);
    expect(normalizeLockedWeeks({})).toEqual([]);
  });
});
