import { describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalProjectSourceBudget,
  LocalTimesheetEntry,
  LocalTimesheetEntryCommit,
} from "@/domain/local-state";
import {
  notCountedMs,
  reconciliation,
  remainingEstimate,
  sourceTaskConsumed,
} from "@/domain/projects/project-budget";

/*
 * The budget card's computed lines (#509, ADR 0016): Not counted yet, the
 * estimated Remaining and the reconciliation, from the entries, their
 * committed copies and the time the source's figures are from.
 */

const HOUR = 3_600_000;
const AS_OF = "2026-10-31T23:59:59.000Z";
const BEFORE = Date.parse("2026-10-30T12:00:00.000Z");
const AFTER = Date.parse("2026-11-01T09:00:00.000Z");

const project: Pick<LocalProject, "_id"> = { _id: "acme" };

let nextId = 1;
function entry(
  overrides: Partial<LocalTimesheetEntry> & {
    commit?: LocalTimesheetEntryCommit;
  },
): LocalTimesheetEntry {
  return {
    _id: `e${nextId++}`,
    localDate: "2026-10-28",
    projectId: "acme",
    taskId: "login",
    label: "",
    durationMs: 2 * HOUR,
    sourceBlockIds: [],
    committedAt: 1,
    ...overrides,
  };
}

/** The entry's committed copy, as the timesheet tool got it. */
function committed(
  at: number,
  overrides: Partial<LocalTimesheetEntryCommit> = {},
): LocalTimesheetEntryCommit {
  return {
    at,
    localDate: "2026-10-28",
    projectId: "acme",
    taskId: "login",
    durationMs: 2 * HOUR,
    ...overrides,
  };
}

describe("notCountedMs", () => {
  it("counts an entry that was never committed", () => {
    expect(notCountedMs(project, [entry({})], AS_OF)).toBe(2 * HOUR);
  });

  it("leaves out an entry committed before the source's time, unchanged", () => {
    expect(
      notCountedMs(project, [entry({ commit: committed(BEFORE) })], AS_OF),
    ).toBe(0);
  });

  it("counts an entry committed after the source's time", () => {
    expect(
      notCountedMs(project, [entry({ commit: committed(AFTER) })], AS_OF),
    ).toBe(2 * HOUR);
  });

  it("counts a commit of local time, which never reached the timesheet tool", () => {
    expect(
      notCountedMs(
        project,
        [entry({ commit: committed(BEFORE, { local: true }) })],
        AS_OF,
      ),
    ).toBe(2 * HOUR);
  });

  it("counts only the difference a stale entry makes: reported at 8 hours, now 9, adds 1", () => {
    const stale = entry({
      durationMs: 9 * HOUR,
      commit: committed(BEFORE, { durationMs: 8 * HOUR, stale: true }),
    });

    expect(notCountedMs(project, [stale], AS_OF)).toBe(1 * HOUR);
  });

  it("adds nothing for an entry moved to another task of the project", () => {
    const moved = entry({
      taskId: "export",
      commit: committed(BEFORE, { stale: true }),
    });

    expect(notCountedMs(project, [moved], AS_OF)).toBe(0);
  });

  it("subtracts the committed hours of an entry moved off the project", () => {
    const moved = entry({
      projectId: "globex",
      taskId: "follow-up",
      commit: committed(BEFORE, { durationMs: 3 * HOUR, stale: true }),
    });

    expect(notCountedMs(project, [moved, entry({})], AS_OF)).toBe(-1 * HOUR);
  });

  it("counts an entry moved onto the project in full", () => {
    const moved = entry({
      commit: committed(BEFORE, {
        projectId: "globex",
        taskId: "follow-up",
        stale: true,
      }),
    });

    expect(notCountedMs(project, [moved], AS_OF)).toBe(2 * HOUR);
  });

  it("ignores another project's entries", () => {
    expect(notCountedMs(project, [entry({ projectId: "globex" })], AS_OF)).toBe(
      0,
    );
  });

  it("counts from the first day of the budget's period, when it has one", () => {
    const entries = [
      entry({ localDate: "2025-12-31" }),
      entry({ localDate: "2026-01-01" }),
    ];

    expect(notCountedMs(project, entries, AS_OF, "2026-01-01")).toBe(2 * HOUR);
    expect(notCountedMs(project, entries, AS_OF)).toBe(4 * HOUR);
  });
});

describe("remainingEstimate", () => {
  function budget(
    overrides: Partial<LocalProjectSourceBudget>,
  ): LocalProjectSourceBudget {
    return { unit: "hours", consumed: 31.5, asOf: AS_OF, ...overrides };
  }

  it("is the source's remaining hours less Not counted yet", () => {
    expect(
      remainingEstimate(budget({ total: 40, remaining: 8.5 }), 2 * HOUR),
    ).toBe(6.5 * HOUR);
  });

  it("goes below zero once the hours not counted pass what remains", () => {
    expect(remainingEstimate(budget({ remaining: 1 }), 3 * HOUR)).toBe(
      -2 * HOUR,
    );
  });

  it("takes the total less the consumed hours when the source gives no remaining", () => {
    expect(remainingEstimate(budget({ total: 40 }), 0)).toBe(8.5 * HOUR);
  });

  it("has nothing to estimate without a total or a remaining", () => {
    expect(remainingEstimate(budget({}), 0)).toBeUndefined();
  });

  it("estimates nothing for a money budget, until money converts to hours", () => {
    expect(
      remainingEstimate(
        budget({ unit: "money", total: 20000, remaining: 800 }),
        2 * HOUR,
      ),
    ).toBeUndefined();
  });
});

describe("reconciliation", () => {
  /** Login has 5:15 for the user at the source, Export none, Notes is local. */
  const managed: Pick<LocalProject, "_id" | "tasks"> = {
    _id: "acme",
    tasks: [
      {
        _id: "login",
        name: "Ticket #101 - Login",
        status: "active",
        createdAt: 1,
        source: { remoteId: "1001", assigned: true, myHours: 5.25 },
      },
      {
        _id: "export",
        name: "Ticket #102 - Export",
        status: "active",
        createdAt: 1,
        source: { remoteId: "1002", assigned: false },
      },
      { _id: "notes", name: "Notes", status: "active", createdAt: 1 },
    ],
  };
  const me = { hoursAvailable: true };

  it("finds nothing to show when what the user committed matches the source", () => {
    const entries = [
      entry({ commit: committed(BEFORE, { durationMs: 3 * HOUR }) }),
      entry({ commit: committed(BEFORE, { durationMs: 2.25 * HOUR }) }),
    ];

    expect(reconciliation(managed, entries, me, AS_OF)).toEqual({
      sourceMs: 5.25 * HOUR,
      committedMs: 5.25 * HOUR,
      differenceMs: 0,
      tasks: [],
    });
  });

  it("lists the task the source has less of, with the entries committed before its time", () => {
    const counted = entry({
      commit: committed(BEFORE, { durationMs: 3 * HOUR }),
    });
    const later = entry({ commit: committed(AFTER) });

    const result = reconciliation(managed, [counted, later], me, AS_OF);

    expect(result).toMatchObject({
      sourceMs: 5.25 * HOUR,
      committedMs: 3 * HOUR,
      differenceMs: 2.25 * HOUR,
    });
    expect(result!.tasks).toEqual([
      {
        taskId: "login",
        name: "Ticket #101 - Login",
        sourceMs: 5.25 * HOUR,
        committedMs: 3 * HOUR,
        entries: [counted],
      },
    ]);
  });

  it("compares each task on its committed copy, and leaves local commits out", () => {
    const entries = [
      entry({ commit: committed(BEFORE, { durationMs: 5.25 * HOUR }) }),
      // Now on Login, but the timesheet tool has it on Export.
      entry({ commit: committed(BEFORE, { taskId: "export", stale: true }) }),
      entry({
        taskId: "notes",
        commit: committed(BEFORE, { taskId: "notes", local: true }),
      }),
    ];

    expect(
      reconciliation(managed, entries, me, AS_OF)!.tasks.map((task) => [
        task.taskId,
        task.sourceMs,
        task.committedMs,
      ]),
    ).toEqual([["export", 0, 2 * HOUR]]);
  });

  it("counts from the first day the source's hours cover, when it says", () => {
    const entries = [
      entry({
        commit: committed(BEFORE, {
          localDate: "2026-09-30",
          durationMs: HOUR,
        }),
      }),
      entry({ commit: committed(BEFORE, { durationMs: 5.25 * HOUR }) }),
    ];

    expect(
      reconciliation(
        managed,
        entries,
        { hoursAvailable: true, hoursSince: "2026-10-01" },
        AS_OF,
      )!.tasks,
    ).toEqual([]);
    expect(reconciliation(managed, entries, me, AS_OF)!.differenceMs).toBe(
      HOUR,
    );
  });

  it("ignores a difference under a minute, which is the source's rounding", () => {
    const entries = [
      entry({
        commit: committed(BEFORE, { durationMs: 5.25 * HOUR + 20_000 }),
      }),
    ];

    expect(reconciliation(managed, entries, me, AS_OF)!.tasks).toEqual([]);
  });

  it("is unavailable when the source can't give the user's hours", () => {
    const entries = [entry({ commit: committed(BEFORE) })];

    expect(
      reconciliation(managed, entries, { hoursAvailable: false }, AS_OF),
    ).toBeNull();
    expect(reconciliation(managed, entries, undefined, AS_OF)).toBeNull();
  });
});

describe("sourceTaskConsumed", () => {
  it("reads a source task's hours for the user against its estimate", () => {
    expect(
      sourceTaskConsumed({
        budgetMs: 8 * HOUR,
        source: { remoteId: "1001", assigned: true, myHours: 5.25 },
      }),
    ).toEqual({ budgetMs: 8 * HOUR, consumedMs: 5.25 * HOUR });
  });

  it("has nothing to read when the source gives no hours for the user, or doesn't know the task", () => {
    expect(
      sourceTaskConsumed({
        budgetMs: 8 * HOUR,
        source: { remoteId: "1002", assigned: false },
      }),
    ).toBeUndefined();
    expect(sourceTaskConsumed({ budgetMs: 8 * HOUR })).toBeUndefined();
  });
});
