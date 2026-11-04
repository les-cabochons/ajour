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
    expect(displayWidth("Re\u0301union")).toBe(7);
    expect(displayWidth("\x1b[1;34mWeek\x1b[0m")).toBe(4);
  });
});

describe("terminal cells", () => {
  it("counts wide characters and emoji as two columns", () => {
    expect(displayWidth("日本語")).toBe(6);
    expect(displayWidth("회의")).toBe(4);
    expect(displayWidth("🚀 Launch")).toBe(9);
    expect(displayWidth("❤\uFE0F")).toBe(2);
    expect(displayWidth("👩\u200D💻")).toBe(2);
    expect(displayWidth("● ○ · …")).toBe(7);
  });

  it("cuts wide text without going past the width", () => {
    expect(truncate("日本語テキスト", 7)).toBe("日本語…");
    expect(truncate("日本語テキスト", 6)).toBe("日本…");
    expect(truncate("🚀🚀🚀🚀", 5)).toBe("🚀🚀…");
    expect(
      displayWidth(truncate("Ship 🚀 now and 🎉 later", 9)),
    ).toBeLessThanOrEqual(9);
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
    expect(truncate("Re\u0301union d'equipe", 4)).toBe("Re\u0301u…");
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
