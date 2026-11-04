import { describe, expect, it } from "vitest";
import { parseRange } from "../refs.ts";
import {
  TODAY,
  entry,
  listed,
  projects,
  running,
} from "../test-support/log-week.ts";
import {
  formatDelimited,
  formatLogByTask,
  formatLogSummary,
  formatLogTable,
  logView,
  type LogView,
} from "./log.ts";
import { painter } from "./style.ts";

function view(range: string): LogView {
  const parsed = parseRange(range, TODAY);
  return logView({
    range: parsed,
    today: TODAY,
    listed: listed(parsed.from, parsed.to),
    projects,
  });
}

/** Escape codes written as \e, so a golden file holds no invisible text. */
function visible(text: string): string {
  return text.replaceAll("\x1b", "\\e");
}

const VIEWS = {
  day: () => view("today"),
  week: () => view("week"),
  summary: () => view("mon..wed"),
  "by-task": () => view("week"),
};
const PRINTS = {
  day: formatLogTable,
  week: formatLogTable,
  summary: formatLogSummary,
  "by-task": formatLogByTask,
};

describe("ajour log, as the mockups print it", () => {
  for (const name of Object.keys(VIEWS) as (keyof typeof VIEWS)[]) {
    for (const columns of [80, 120]) {
      for (const color of [false, true]) {
        const file = `golden/log-${name}-${columns}${color ? "-color" : ""}.txt`;
        it(`prints ${file}`, async () => {
          const text = PRINTS[name](VIEWS[name](), {
            paint: painter(color),
            columns,
          });
          await expect(visible(text)).toMatchFileSnapshot(file);
        });
      }
    }
  }

  it("fits every line to the terminal, cutting the note first", () => {
    for (const columns of [40, 60, 80]) {
      const text = formatLogTable(view("week"), {
        paint: painter(false),
        columns,
      });
      for (const line of text.trimEnd().split("\n")) {
        expect([...line].length).toBeLessThan(columns);
      }
    }
  });
});

describe("ajour log, the details", () => {
  const plain = { paint: painter(false) };

  it("counts a running entry once: the saved part it continues is left out", () => {
    const continued = logView({
      range: parseRange("today", TODAY),
      today: TODAY,
      listed: {
        entries: [
          {
            ...entry(TODAY, "3f9a2c1", "export", 60, "Fix export rounding"),
            state: "running",
          },
          entry(TODAY, "b7e1d04", "review", 30, "PR #512"),
        ],
        running,
        targets: [{ date: TODAY, hours: 8 }],
      },
      projects,
    });

    expect(
      continued.rows.map((row) => [row.id.slice(0, 7), row.minutes]),
    ).toEqual([
      ["3f9a2c1", 84],
      ["b7e1d04", 30],
    ]);
    expect(formatLogTable(continued, plain)).toContain("1:54 of 8:00");
  });

  it("says a day without entries has none, with its target", () => {
    const empty = logView({
      range: parseRange("2026-11-05", TODAY),
      today: TODAY,
      listed: {
        entries: [],
        running: null,
        targets: [{ date: "2026-11-05", hours: 8 }],
      },
    });

    expect(formatLogTable(empty, plain)).toBe(
      "Thursday 5 November 2026  0:00 of 8:00  ▯▯▯▯▯▯▯▯▯▯\n" +
        "──────────────────────────────────────────────────\n" +
        "No entries.\n",
    );
  });

  it("names both months, and both years, when a range spans them", () => {
    const yearEnd = logView({
      range: parseRange("2026-W53", TODAY),
      today: TODAY,
      listed: { entries: [], running: null },
    });

    expect(formatLogTable(yearEnd, plain).split("\n")[0]).toBe(
      "Week 53 · Mon 28 Dec 2026 – Sun 3 Jan 2027  0:00",
    );
    const days = formatLogTable(yearEnd, plain)
      .split("\n")
      .slice(2, -1)
      .map((line) => line.replace(/ +—$/, ""));
    // Saturday and Sunday have no target and no time.
    expect(days).toEqual([
      "Mon 28 Dec",
      "Tue 29 Dec",
      "Wed 30 Dec",
      "Thu 31 Dec",
      "Fri 1 Jan",
    ]);
  });

  it("shows Saturday with time, and Sunday not without", () => {
    const weekend = logView({
      range: parseRange("week", TODAY),
      today: TODAY,
      listed: {
        entries: [entry("2026-11-07", "aa11bb2", "review", 60, "Hotfix")],
        running: null,
        targets: listed("2026-11-02", "2026-11-08").targets,
      },
    });

    const text = formatLogSummary(weekend, plain);
    expect(text).toMatch(/^Sat 7 /m);
    expect(text).not.toMatch(/^Sun 8 /m);
  });

  it("is on pace, or ahead, against the targets up to today", () => {
    const week = (minutes: number) =>
      formatLogTable(
        logView({
          range: parseRange("week", TODAY),
          today: TODAY,
          listed: {
            entries: [entry("2026-11-02", "aa11bb2", "review", minutes, "")],
            running: null,
            targets: listed("2026-11-02", "2026-11-08").targets,
          },
        }),
        plain,
      ).split("\n")[0];

    expect(week(24 * 60)).toMatch(/24:00 of 40:00  on pace$/);
    expect(week(24 * 60 + 30)).toMatch(/24:30 of 40:00  0:30 ahead$/);
  });

  it("prints TSV that cut reads, and CSV with its quotes", () => {
    const week = view("week");

    const tsv = formatDelimited(week, "tsv");
    expect(tsv.split("\n").slice(0, 3)).toEqual([
      "date\tstate\thours\tproject\ttask\tnote\tid",
      "2026-11-02\tcommitted\t3.00\tAJR\t07 Export\tFix export rounding\t2a9e1f0",
      "2026-11-02\tcommitted\t1.50\tAJR\t09 Admin\tExpenses\t5c17e08",
    ]);
    expect(tsv).toContain(
      "2026-11-04\trunning\t1.40\tAJR\t07 Export\tFix export rounding\t3f9a2c1\n",
    );
    expect(tsv).not.toContain("\x1b");

    const csv = formatDelimited(week, "csv");
    expect(csv).toContain(
      '2026-11-04,saved,2.00,AJR,04 Review,"PR #512, #514",b7e1d04\n',
    );
  });

  it("keeps a note's tabs, line breaks and quotes from breaking a line", () => {
    const noted = logView({
      range: parseRange("today", TODAY),
      today: TODAY,
      listed: {
        entries: [
          entry(TODAY, "aa11bb2", "review", 60, 'one\ttwo\nthree "four"'),
        ],
        running: null,
      },
    });

    expect(formatDelimited(noted, "tsv").split("\n")[1]).toBe(
      '2026-11-04\tsaved\t1.00\tAJR\t04 Review\tone two three "four"\taa11bb2',
    );
    expect(formatDelimited(noted, "csv").split("\r").length).toBe(1);
    expect(formatDelimited(noted, "csv")).toContain(
      '"one\ttwo\nthree ""four"""',
    );
  });
});
