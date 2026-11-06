import { describe, expect, it } from "vitest";
import {
  formatChangedClockDurations,
  formatCompactDuration,
  DAY_CAPACITY_LIMIT,
  DURATION_FORMAT_ERROR,
  ENTRY_DURATION_LIMIT,
  formatDecimalHours,
  parseHoursInput,
  PLANNED_HOURS_LIMIT,
  readDurationInput,
  toDecimalHours,
} from "@/domain/time/duration";

describe("parseHoursInput", () => {
  it("reads a decimal without a leading zero", () => {
    expect(parseHoursInput(".5")).toBe(parseHoursInput("0.5"));
    expect(parseHoursInput(",25")).toBe(15 * 60_000);
  });

  it("rejects a lone decimal separator", () => {
    expect(parseHoursInput(".")).toBeNull();
    expect(parseHoursInput(",")).toBeNull();
  });

  it("rejects values that overflow milliseconds", () => {
    expect(parseHoursInput("1e308")).toBeNull();
    expect(parseHoursInput(`${"9".repeat(400)}:00`)).toBeNull();
  });

  it("rejects non-decimal numeric syntaxes", () => {
    expect(parseHoursInput("0x10")).toBeNull();
    expect(parseHoursInput("1e3")).toBeNull();
  });
});

describe("parseHoursInput formats", () => {
  const minutes = (count: number) => count * 60_000;

  it.each([
    ["8", 480],
    ["1:30", 90],
    ["1.5", 90],
    ["1,5", 90],
    [".5", 30],
    [",5", 30],
    [":45", 45],
    ["1h30", 90],
    ["1h 30m", 90],
    ["1h30m", 90],
    ["1H30MIN", 90],
    ["2h", 120],
    ["0.5h", 30],
    ["2,5h", 150],
    ["90m", 90],
    ["45min", 45],
    ["45 min", 45],
    ["1h05", 65],
    ["0", 0],
    [" 1 : 30 ", 90],
  ])("reads %j as %i minutes", (text, expected) => {
    expect(parseHoursInput(text)).toBe(minutes(expected));
  });

  it.each([
    "",
    "abc",
    "1:60",
    "1h60",
    "1.5h30",
    "h",
    "m",
    "1:",
    "-1",
    "+1",
    "1e2",
    "Infinity",
    "1..5",
    "1.5.5",
    "1h30h",
  ])("refuses %j", (text) => {
    expect(parseHoursInput(text)).toBeNull();
  });
});

describe("readDurationInput", () => {
  const hour = 3_600_000;

  it("accepts a duration up to the limit", () => {
    expect(readDurationInput("24:00", ENTRY_DURATION_LIMIT)).toEqual({
      ok: true,
      durationMs: 24 * hour,
    });
  });

  it("refuses a duration past the limit with the limit's message", () => {
    expect(readDurationInput("24:01", ENTRY_DURATION_LIMIT)).toEqual({
      ok: false,
      error: "An entry can be at most 24:00",
    });
    expect(readDurationInput("90", ENTRY_DURATION_LIMIT)).toEqual({
      ok: false,
      error: "An entry can be at most 24:00",
    });
    expect(
      readDurationInput("99999999999999999999", ENTRY_DURATION_LIMIT),
    ).toEqual({ ok: false, error: "An entry can be at most 24:00" });
    expect(readDurationInput("25", DAY_CAPACITY_LIMIT)).toEqual({
      ok: false,
      error: "A day can hold at most 24:00",
    });
    expect(readDurationInput("100001", PLANNED_HOURS_LIMIT)).toEqual({
      ok: false,
      error: "Enter at most 100,000 hours",
    });
  });

  it("says how to write hours when it can't read them", () => {
    expect(readDurationInput("abc", ENTRY_DURATION_LIMIT)).toEqual({
      ok: false,
      error: DURATION_FORMAT_ERROR,
    });
    expect(readDurationInput("1e2", PLANNED_HOURS_LIMIT)).toEqual({
      ok: false,
      error: DURATION_FORMAT_ERROR,
    });
  });

  it("reads a sign only when the field takes one", () => {
    expect(
      readDurationInput("-1h30", PLANNED_HOURS_LIMIT, { signed: true }),
    ).toEqual({ ok: true, durationMs: -1.5 * hour });
    expect(
      readDurationInput("+2", PLANNED_HOURS_LIMIT, { signed: true }),
    ).toEqual({ ok: true, durationMs: 2 * hour });
    expect(
      readDurationInput("-0", PLANNED_HOURS_LIMIT, { signed: true }),
    ).toEqual({ ok: true, durationMs: 0 });
    expect(readDurationInput("-2", PLANNED_HOURS_LIMIT).ok).toBe(false);
    expect(
      readDurationInput("-200000", PLANNED_HOURS_LIMIT, { signed: true }),
    ).toEqual({ ok: false, error: "Enter at most 100,000 hours" });
  });
});

describe("formatDecimalHours", () => {
  it("formats minutes as two-place decimal hours", () => {
    expect(formatDecimalHours(5 * 60 * 60_000)).toBe("5,00");
    expect(formatDecimalHours(75 * 60_000)).toBe("1,25");
    expect(formatDecimalHours(20 * 60_000)).toBe("0,33");
  });
});

describe("toDecimalHours", () => {
  it("is the number formatDecimalHours writes, rounded to the minute first", () => {
    expect(toDecimalHours(5 * 60 * 60_000)).toBe(5);
    expect(toDecimalHours(20 * 60_000)).toBe(0.33);
    // 30 minutes 29 seconds is 0:30 on screen, so 0.5, not 0.51.
    expect(toDecimalHours(30 * 60_000 + 29_000)).toBe(0.5);
  });
});

describe("formatCompactDuration", () => {
  it("drops the zero part and pads minutes after hours", () => {
    expect(formatCompactDuration(4 * 60 * 60_000)).toBe("4h");
    expect(formatCompactDuration(270 * 60_000)).toBe("4h30");
    expect(formatCompactDuration(245 * 60_000)).toBe("4h05");
    expect(formatCompactDuration(45 * 60_000)).toBe("45m");
    expect(formatCompactDuration(0)).toBe("0m");
  });
});

describe("formatChangedClockDurations", () => {
  it("shows h:mm when the two sides differ by minutes", () => {
    expect(formatChangedClockDurations(3_600_000, 5_400_000)).toEqual({
      before: "1:00",
      after: "1:30",
    });
  });

  it("shows seconds when a change of under a minute rounds to the same h:mm", () => {
    expect(formatChangedClockDurations(3_600_000, 3_620_000)).toEqual({
      before: "1:00:00",
      after: "1:00:20",
    });
  });

  it("keeps h:mm when the durations are equal", () => {
    expect(formatChangedClockDurations(3_600_000, 3_600_000)).toEqual({
      before: "1:00",
      after: "1:00",
    });
  });
});
