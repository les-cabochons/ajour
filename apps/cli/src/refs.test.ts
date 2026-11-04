import { describe, expect, it } from "vitest";
import type {
  AgentRunningTimer,
  AgentTimeEntry,
} from "../../../packages/shared/agent-tools.ts";
import { EXIT } from "./errors.ts";
import {
  parseDay,
  parseDuration,
  parseEntryRef,
  parseRange,
  pickFoundEntry,
  resolveProject,
  resolveTask,
  type ProjectRef,
} from "./refs.ts";

const projects: ProjectRef[] = [
  {
    projectId: "p-acme",
    name: "Acme Platform",
    code: "ACME",
    tasks: [
      { taskId: "t-meet", name: "03 Meetings" },
      { taskId: "t-backend", name: "05 Backend", pinnedSlot: 1 },
      { taskId: "t-review-acme", name: "08 Code review" },
    ],
  },
  {
    projectId: "p-ajr",
    name: "Ajour Desktop",
    code: "AJR",
    tasks: [
      { taskId: "t-review", name: "04 Review" },
      { taskId: "t-export", name: "07 Export", pinnedSlot: 10 },
    ],
  },
  {
    projectId: "p-reunion",
    name: "Réunions",
    tasks: [{ taskId: "t-weekly", name: "Hebdo équipe" }],
  },
];

function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error as { exitCode: number; message: string };
  }
  throw new Error("Expected a failure.");
}

describe("resolveTask", () => {
  it.each([
    ["a task alone, by part of its name", "export", "t-export"],
    ["project code and task", "ajr/review", "t-review"],
    ["the project's name", "acme platform/backend", "t-backend"],
    ["a project prefix", "aj/exp", "t-export"],
    [
      "case, accents and spaces ignored",
      "  REUNIONS / hebdo   EQUIPE ",
      "t-weekly",
    ],
    ["pinned key 1", "1", "t-backend"],
    ["pinned key 0, the tenth", "0", "t-export"],
  ])("finds %s", (_name, query, taskId) => {
    expect(resolveTask(query, projects).taskId).toBe(taskId);
  });

  it("matches PROJECT by its full name as well as its display name", () => {
    const named: ProjectRef[] = [
      {
        projectId: "p-client",
        name: "Client A",
        fullName: "Acme Corporation",
        code: "ACME",
        tasks: [{ taskId: "t-build", name: "Build" }],
      },
      {
        projectId: "p-other",
        name: "Other",
        fullName: "Globex",
        tasks: [{ taskId: "t-build-2", name: "Build" }],
      },
    ];
    expect(resolveTask("Acme Corporation/Build", named).taskId).toBe("t-build");
    expect(resolveTask("client a/build", named).taskId).toBe("t-build");
    expect(resolveTask("acme corp/build", named).taskId).toBe("t-build");
    expect(resolveTask("glob/build", named).taskId).toBe("t-build-2");
    // An exact code wins over a full name that only starts with it.
    expect(
      resolveTask("acme/build", [
        ...named,
        {
          projectId: "p-acme-labs",
          name: "Labs",
          fullName: "Acme Labs",
          tasks: [{ taskId: "t-build-3", name: "Build" }],
        },
      ]).taskId,
    ).toBe("t-build");
  });

  it("prefers a prefix match over a match inside the name", () => {
    const withPrefix: ProjectRef[] = [
      {
        projectId: "p",
        name: "P",
        tasks: [
          { taskId: "inside", name: "Code review" },
          { taskId: "prefix", name: "Review notes" },
        ],
      },
    ];
    expect(resolveTask("review", withPrefix).taskId).toBe("prefix");
  });

  it("names the candidates when several tasks match, with exit 4", () => {
    const error = failure(() => resolveTask("review", projects));
    expect(error.exitCode).toBe(EXIT.reference);
    expect(error.message).toBe(
      '"review" matches 2 tasks:\n' +
        "  ACME/08 Code review\n" +
        "  AJR/04 Review\n" +
        'Say which, such as: ajour start "AJR/04 Review"',
    );
  });

  it("says when nothing matches, with exit 4", () => {
    const error = failure(() => resolveTask("deploy", projects));
    expect(error.exitCode).toBe(EXIT.reference);
    expect(error.message).toBe('No active task matches "deploy".');
    expect(failure(() => resolveTask("5", projects)).message).toBe(
      "No task is pinned to 5.",
    );
  });
});

describe("parseDuration", () => {
  it.each([
    ["1:30", 90],
    ["0:05", 5],
    ["1.5", 90],
    ["1,5", 90],
    [".25", 15],
    ["1h30", 90],
    ["1h", 60],
    ["2h05", 125],
    ["90m", 90],
    ["45min", 45],
    ["24:00", 1440],
  ])("reads %s as %i minutes", (text, minutes) => {
    expect(parseDuration(text, { allowZero: false })).toBe(minutes);
  });

  it.each(["", "abc", "1:75", "-1", "25h", "24:01", "0"])(
    "refuses %j with exit 2",
    (text) => {
      const error = failure(() => parseDuration(text, { allowZero: false }));
      expect(error.exitCode).toBe(EXIT.usage);
    },
  );

  it("allows zero where the running entry counts from it", () => {
    expect(parseDuration("0", { allowZero: true })).toBe(0);
    expect(parseDuration("0:00", { allowZero: true })).toBe(0);
  });
});

describe("ENTRY", () => {
  const entry = (
    shortId: string,
    savedAt: string,
    extra: Partial<AgentTimeEntry> = {},
  ): AgentTimeEntry => ({
    entryId: `timesheet_${shortId}`,
    shortId,
    date: "2026-11-03",
    state: "saved",
    minutes: 45,
    taskName: "04 Review",
    projectCode: "AJR",
    savedAt,
    ...extra,
  });
  const running: AgentRunningTimer = {
    timerId: "timer_1",
    shortId: "3f9a2c1e00",
    date: "2026-11-04",
    countedMinutes: 91,
    taskName: "07 Export",
  };

  it.each([
    ["running", { kind: "running" }],
    ["last", { kind: "last" }],
    ["3F9A", { kind: "prefix", prefix: "3f9a" }],
    ["b7e1d04", { kind: "prefix", prefix: "b7e1d04" }],
  ])("reads %s", (text, ref) => {
    expect(parseEntryRef(text)).toEqual(ref);
  });

  it.each(["3f9", "xyz1", "", "3f9a-2c1"])("refuses %j with exit 2", (text) => {
    expect(failure(() => parseEntryRef(text)).exitCode).toBe(EXIT.usage);
  });

  it("picks the one entry a prefix finds, or the running entry", () => {
    const found = entry("b7e1d04f", "2026-11-03T16:00:00.000Z");
    expect(
      pickFoundEntry("b7e1", { entries: [found], running: null }, "2026-11-04"),
    ).toEqual({ kind: "entry", entry: found });
    // A continued entry is listed as running, and is the running entry.
    expect(
      pickFoundEntry(
        "3f9a",
        {
          entries: [
            entry("3f9a2c1e00", "2026-11-04T09:00:00.000Z", {
              state: "running",
            }),
          ],
          running,
        },
        "2026-11-04",
      ),
    ).toEqual({ kind: "running", running });
  });

  it("refuses a prefix that finds nothing, or several, with the candidate rows", () => {
    const none = failure(() =>
      pickFoundEntry("dead", { entries: [], running: null }, "2026-11-04"),
    );
    expect(none).toMatchObject({
      exitCode: EXIT.reference,
      message: 'No entry has an id starting with "dead".',
    });

    const several = failure(() =>
      pickFoundEntry(
        "3f9a",
        {
          entries: [entry("3f9a2c1aaa", "2026-11-03T16:00:00.000Z")],
          running,
        },
        "2026-11-04",
      ),
    );
    expect(several).toMatchObject({ exitCode: EXIT.reference });
    expect(several.message).toBe(
      '"3f9a" matches 2 entries:\n' +
        "     0:45  AJR  04 Review  3f9a2c1a  Tue 3 Nov\n" +
        "  ●  1:31  —    07 Export  3f9a2c1e\n" +
        "Say which with more of its id.",
    );
  });
});

describe("DAY", () => {
  // Wednesday 4 November 2026.
  const today = "2026-11-04";

  it.each([
    ["today", "2026-11-04"],
    ["yesterday", "2026-11-03"],
    ["wed", "2026-11-04"],
    ["mon", "2026-11-02"],
    ["Thu", "2026-10-29"],
    ["sunday", "2026-11-01"],
    ["2026-02-28", "2026-02-28"],
    ["11-03", "2026-11-03"],
    ["01-15", "2026-01-15"],
    ["2024-02-29", "2024-02-29"],
  ])("reads %j as %s", (text, date) => {
    expect(parseDay(text, today)).toBe(date);
  });

  it("finds yesterday across a year end", () => {
    expect(parseDay("yesterday", "2027-01-01")).toBe("2026-12-31");
    expect(parseDay("thu", "2027-01-01")).toBe("2026-12-31");
  });

  it.each([
    "",
    "tomorrow",
    "2026-02-30",
    "2025-02-29",
    "13-01",
    "2026-1-5",
    "week",
  ])("refuses %j with exit 2", (text) => {
    expect(() => parseDay(text, today)).toThrow(
      expect.objectContaining({ exitCode: EXIT.usage }),
    );
  });
});

describe("RANGE", () => {
  const today = "2026-11-04";

  it.each([
    ["", { from: "2026-11-04", to: "2026-11-04" }],
    ["today", { from: "2026-11-04", to: "2026-11-04" }],
    ["yesterday", { from: "2026-11-03", to: "2026-11-03" }],
    ["mon..wed", { from: "2026-11-02", to: "2026-11-04" }],
    ["10-28..11-03", { from: "2026-10-28", to: "2026-11-03" }],
    ["2026-11-03..2026-11-03", { from: "2026-11-03", to: "2026-11-03" }],
    [
      "week",
      { from: "2026-11-02", to: "2026-11-08", week: { year: 2026, week: 45 } },
    ],
    [
      "last-week",
      { from: "2026-10-26", to: "2026-11-01", week: { year: 2026, week: 44 } },
    ],
    [
      "2026-W44",
      { from: "2026-10-26", to: "2026-11-01", week: { year: 2026, week: 44 } },
    ],
    [
      "2026-w01",
      { from: "2025-12-29", to: "2026-01-04", week: { year: 2026, week: 1 } },
    ],
  ])("reads %j", (text, range) => {
    expect(parseRange(text, today)).toEqual(range);
  });

  it.each([
    // 2026 starts on a Thursday, so it has 53 weeks; the last ends in 2027.
    ["2026-W53", "2026-12-28", "2027-01-03", 2026, 53],
    ["2027-W01", "2027-01-04", "2027-01-10", 2027, 1],
    // 2025's first week starts in 2024.
    ["2025-W01", "2024-12-30", "2025-01-05", 2025, 1],
    ["2020-W53", "2020-12-28", "2021-01-03", 2020, 53],
  ])(
    "reads the ISO week %s across a year end",
    (text, from, to, year, week) => {
      expect(parseRange(text, today)).toEqual({
        from,
        to,
        week: { year, week },
      });
    },
  );

  it("names a week by its ISO year when today is in the next calendar year", () => {
    expect(parseRange("week", "2027-01-01")).toEqual({
      from: "2026-12-28",
      to: "2027-01-03",
      week: { year: 2026, week: 53 },
    });
    expect(parseRange("last-week", "2026-01-05")).toEqual({
      from: "2025-12-29",
      to: "2026-01-04",
      week: { year: 2026, week: 1 },
    });
    expect(parseRange("week", "2026-11-08")).toMatchObject({
      from: "2026-11-02",
      to: "2026-11-08",
    });
  });

  it.each([
    ["2027-W53", /2027 has 52 weeks/],
    ["2026-W00", /isn't a range/],
    ["wed..mon", /comes after/],
    ["mon..", /isn't a range/],
    ["week..fri", /isn't a range/],
    ["2026-01-01..2026-03-31", /at most 62 days/],
    ["nope", /isn't a range/],
  ])("refuses %j with exit 2", (text, message) => {
    let thrown: unknown;
    try {
      parseRange(text, today);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ exitCode: EXIT.usage });
    expect((thrown as Error).message).toMatch(message);
  });

  it("takes 62 days, both ends included", () => {
    expect(parseRange("2026-01-01..2026-03-03", today)).toEqual({
      from: "2026-01-01",
      to: "2026-03-03",
    });
  });
});

describe("PROJECT", () => {
  it.each([
    ["acme", "p-acme"],
    ["AJR", "p-ajr"],
    ["ajour", "p-ajr"],
    ["reunion", "p-reunion"],
  ])("reads %j as %s", (query, projectId) => {
    expect(resolveProject(query, projects).projectId).toBe(projectId);
  });

  it("exits 4 with the candidates when several projects match", () => {
    expect(() => resolveProject("a", projects)).toThrow(
      expect.objectContaining({
        exitCode: EXIT.reference,
        message: expect.stringContaining("ACME"),
      }),
    );
  });

  it("exits 4 when no project matches", () => {
    expect(() => resolveProject("zzz", projects)).toThrow(
      expect.objectContaining({ exitCode: EXIT.reference }),
    );
  });
});
