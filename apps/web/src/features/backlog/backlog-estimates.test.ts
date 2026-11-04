import { describe, expect, it } from "vitest";
import { formatHours } from "./backlog-estimates";

describe("formatHours", () => {
  it("writes an estimate as hours and minutes, never as a decimal", () => {
    expect(formatHours(8)).toBe("8h");
    expect(formatHours(1.5)).toBe("1h30");
    expect(formatHours(0.75)).toBe("45m");
    expect(formatHours(0)).toBe("0h");
  });

  it("shows a dash without an estimate", () => {
    expect(formatHours(undefined)).toBe("–");
  });
});
