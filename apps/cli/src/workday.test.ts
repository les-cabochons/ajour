import { describe, expect, it } from "vitest";
import { formatWorkday } from "./format/workday.ts";
import { painter } from "./format/style.ts";
import { week, grouped } from "./test-support/workday-week.ts";

describe("Workday mockup", () => {
  for (const by of ["day-task", "day", "task"] as const) {
    for (const tty of [true, false]) {
      it(`prints ${by} ${tty ? "terminal" : "pipe"}`, async () => {
        const output = formatWorkday(
          grouped(by),
          { from: "2026-11-02", to: "2026-11-08" },
          tty,
          painter(false),
        );
        await expect(output).toMatchFileSnapshot(
          `format/golden/workday-${by}-${tty ? "tty" : "pipe"}.txt`,
        );
        expect(output).not.toContain("\x1b");
        expect(output).toContain("\t");
        if (!tty)
          expect(output).not.toMatch(
            /Not sent|Waiting|Running|Admin|Temp migration/,
          );
      });
    }
  }
  it("colors the three explanations only on a terminal", () => {
    const range = { from: "2026-11-02", to: "2026-11-08" };
    const terminal = formatWorkday(week, range, true, painter(true));
    expect(terminal).toContain("\x1b[90mNot sent");
    expect(terminal).toContain("\x1b[33mWaiting");
    expect(terminal).toContain("\x1b[32mRunning");
    expect(formatWorkday(week, range, false, painter(true))).not.toContain(
      "\x1b",
    );
  });
});

it("keeps spreadsheet values on one line and formats supplied decimal hours", () => {
  const input = {
    ...week,
    sections: [
      {
        lines: [
          {
            projectName: "Acme\tPlatform",
            taskName: "Backend\nOps",
            hours: 1.235,
            comments: "A\r\nB",
            entryIds: [],
          },
        ],
      },
    ],
  };
  expect(
    formatWorkday(
      input,
      { from: "2026-11-02", to: "2026-11-08" },
      false,
      painter(true),
    ),
  ).toBe("Acme Platform\tBackend Ops\t1,24\tA B\n");
});
