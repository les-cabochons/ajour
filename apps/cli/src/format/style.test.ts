import { describe, expect, it } from "vitest";
import { painter, shouldColor } from "./style.ts";

describe("shouldColor", () => {
  const tty = { isTTY: true, env: {} };
  const pipe = { isTTY: false, env: {} };

  it.each([
    ["auto on a terminal", "auto", tty, true],
    ["auto in a pipe", "auto", pipe, false],
    ["always in a pipe", "always", pipe, true],
    ["never on a terminal", "never", tty, false],
    [
      "NO_COLOR on a terminal",
      "auto",
      { isTTY: true, env: { NO_COLOR: "1" } },
      false,
    ],
    ["an empty NO_COLOR", "auto", { isTTY: true, env: { NO_COLOR: "" } }, true],
    [
      "CLICOLOR_FORCE in a pipe",
      "auto",
      { isTTY: false, env: { CLICOLOR_FORCE: "1" } },
      true,
    ],
    [
      "CLICOLOR_FORCE=0 in a pipe",
      "auto",
      { isTTY: false, env: { CLICOLOR_FORCE: "0" } },
      false,
    ],
    [
      "NO_COLOR wins over CLICOLOR_FORCE",
      "auto",
      { isTTY: false, env: { NO_COLOR: "1", CLICOLOR_FORCE: "1" } },
      false,
    ],
    ["a dumb terminal", "auto", { isTTY: true, env: { TERM: "dumb" } }, false],
    [
      "always beats NO_COLOR",
      "always",
      { isTTY: false, env: { NO_COLOR: "1" } },
      true,
    ],
  ] as const)("%s", (_name, mode, stream, expected) => {
    expect(shouldColor(mode, stream)).toBe(expected);
  });
});

describe("painter", () => {
  it("wraps text in escape codes only when color is on", () => {
    expect(painter(false).accent("Week 45")).toBe("Week 45");
    expect(painter(true).accent("Week 45")).toBe("\x1b[1;34mWeek 45\x1b[0m");
    expect(painter(true).muted("3f9a2c1")).toBe("\x1b[90m3f9a2c1\x1b[0m");
  });

  it("leaves an empty string empty", () => {
    expect(painter(true).bold("")).toBe("");
  });
});
