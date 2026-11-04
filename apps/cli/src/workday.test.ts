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

describe("spreadsheet fields", () => {
  for (const [comments, expected] of [
    ["First\nSecond | Third", '"First\nSecond | Third"'],
    ["First\tSecond", '"First\tSecond"'],
    ['Say "hello"', '"Say ""hello"""'],
    ["Normal note", "Normal note"],
  ] as const) {
    for (const tty of [false, true]) {
      it(`preserves ${JSON.stringify(comments)} in ${tty ? "TTY" : "pipe"}`, () => {
        const input = {
          ...week,
          sections: [
            {
              lines: [
                {
                  projectName: "Acme",
                  taskName: "Build",
                  hours: 1.235,
                  comments,
                  entryIds: [],
                },
              ],
            },
          ],
        };
        const output = formatWorkday(
          input,
          { from: "2026-11-02", to: "2026-11-08" },
          tty,
          painter(false),
        );
        const row = `Acme\tBuild\t1,24\t${expected}\n`;
        if (tty) expect(output).toContain(row);
        else expect(output).toBe(row);
      });
    }
  }
  it("quotes project and task fields without distorting following TTY rows", () => {
    const input = {
      ...week,
      sections: [
        {
          lines: [
            {
              projectName: "Acme\tPlatform",
              taskName: "Backend\r\nOps",
              hours: 1,
              comments: "A",
              entryIds: [],
            },
            {
              projectName: "Acme",
              taskName: "Build",
              hours: 2,
              comments: "B",
              entryIds: [],
            },
          ],
        },
      ],
    };
    const range = { from: "2026-11-02", to: "2026-11-08" };
    expect(formatWorkday(input, range, false, painter(false))).toBe(
      '"Acme\tPlatform"\t"Backend\r\nOps"\t1,00\tA\nAcme\tBuild\t2,00\tB\n',
    );
    expect(formatWorkday(input, range, true, painter(false))).toContain(
      '"Acme\tPlatform"\t"Backend\r\nOps"\t1,00\tA\n  Acme\tBuild\t2,00\tB\n',
    );
  });
});
