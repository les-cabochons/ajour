import { describe, expect, it } from "vitest";
import { getWeekOf } from "@/domain/time/local-date";

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
