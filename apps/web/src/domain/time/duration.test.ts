import { describe, expect, it } from "vitest";
import { formatDecimalHours, parseHoursInput } from "@/domain/time/duration";

describe("parseHoursInput", () => {
  it("rejects values that overflow milliseconds", () => {
    expect(parseHoursInput("1e308")).toBeNull();
    expect(parseHoursInput(`${"9".repeat(400)}:00`)).toBeNull();
  });

  it("rejects non-decimal numeric syntaxes", () => {
    expect(parseHoursInput("0x10")).toBeNull();
    expect(parseHoursInput("1e3")).toBeNull();
  });
});

describe("formatDecimalHours", () => {
  it("formats minutes as two-place decimal hours", () => {
    expect(formatDecimalHours(5 * 60 * 60_000)).toBe("5.00");
    expect(formatDecimalHours(75 * 60_000)).toBe("1.25");
    expect(formatDecimalHours(20 * 60_000)).toBe("0.33");
  });
});
