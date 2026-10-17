import { describe, expect, it } from "vitest";
import {
  formatShortLocalDate,
  getWeekDates,
  getWeekOf,
} from "@/domain/time/local-date";

describe("getWeekOf", () => {
  it.each([
    ["2026-10-05", "2026-10-05"],
    ["2026-10-11", "2026-10-05"],
    ["2026-10-12", "2026-10-12"],
    // Daylight saving time ends on Sunday, November 1, 2026 in North America.
    ["2026-11-01", "2026-10-26"],
    ["2026-11-02", "2026-11-02"],
    // It starts on Sunday, March 8, 2026.
    ["2026-03-08", "2026-03-02"],
    ["2027-01-03", "2026-12-28"],
    ["2028-02-29", "2028-02-28"],
  ])("puts %s in the week of %s", (localDate, monday) => {
    expect(getWeekOf(localDate)).toBe(monday);
  });
});

describe("getWeekDates", () => {
  it("lists the seven days of the week, Monday first, across a time change", () => {
    expect(getWeekDates("2026-11-01")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });
});

describe("formatShortLocalDate", () => {
  it("shows the month and day, and the year only when it is not this year", () => {
    expect(formatShortLocalDate("2026-10-05", 2026)).toBe("Oct 5");
    expect(formatShortLocalDate("2026-01-31", 2026)).toBe("Jan 31");
    expect(formatShortLocalDate("2025-12-29", 2026)).toBe("Dec 29, 2025");
  });
});
