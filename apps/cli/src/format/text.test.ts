import { describe, expect, it } from "vitest";
import {
  displayWidth,
  formatClock,
  formatClockSeconds,
  padEnd,
  padStart,
  truncate,
} from "./text.ts";

describe("displayWidth", () => {
  it("counts what the terminal shows, not code units or escape codes", () => {
    expect(displayWidth("Fix export")).toBe(10);
    expect(displayWidth("● 1:24")).toBe(6);
    expect(displayWidth("Réunion")).toBe(7);
    expect(displayWidth("Réunion")).toBe(7);
    expect(displayWidth("\x1b[1;34mWeek\x1b[0m")).toBe(4);
  });
});

describe("truncate", () => {
  it("keeps text that fits", () => {
    expect(truncate("Weekly sync", 11)).toBe("Weekly sync");
  });

  it("cuts long text and ends it with an ellipsis, inside the width", () => {
    expect(truncate("Rate limiter retries", 10)).toBe("Rate limi…");
    expect(displayWidth(truncate("Rate limiter retries", 10))).toBe(10);
  });

  it("never splits an accented letter", () => {
    expect(truncate("Réunion d'equipe", 4)).toBe("Réu…");
  });

  it("gives nothing for no room, and the ellipsis alone for one column", () => {
    expect(truncate("Weekly sync", 0)).toBe("");
    expect(truncate("Weekly sync", 1)).toBe("…");
  });
});

describe("padding", () => {
  it("pads by display width", () => {
    expect(padEnd("Réunion", 9)).toBe("Réunion  ");
    expect(padStart("1:24", 6)).toBe("  1:24");
    expect(padEnd("\x1b[90mid\x1b[0m", 4)).toBe("\x1b[90mid\x1b[0m  ");
  });

  it("leaves text wider than the column as it is", () => {
    expect(padEnd("Fix export rounding", 5)).toBe("Fix export rounding");
  });
});

describe("durations", () => {
  it("shows minutes as h:mm", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(84)).toBe("1:24");
    expect(formatClock(600)).toBe("10:00");
  });

  it("shows seconds as h:mm:ss", () => {
    expect(formatClockSeconds(5047)).toBe("1:24:07");
    expect(formatClockSeconds(59)).toBe("0:00:59");
  });
});
