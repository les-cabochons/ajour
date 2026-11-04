import { describe, expect, it } from "vitest";
import {
  bridgeToolResultSchema,
  dataToolOutputSchemas,
  isoDateSchema,
  readToolInputSchemas,
  writeToolInputSchemas,
} from "../agent-tools";

describe("agent tool contracts", () => {
  it("accepts a successful and a refused bridge result", () => {
    expect(
      bridgeToolResultSchema.parse({
        requestId: "r1",
        ok: true,
        output: { projects: [] },
      }),
    ).toMatchObject({ ok: true });
    expect(
      bridgeToolResultSchema.parse({
        requestId: "r2",
        ok: false,
        error: "Stop the running entry first",
      }),
    ).toMatchObject({ ok: false, error: "Stop the running entry first" });
  });

  it("marks a result that failed unexpectedly apart from a refusal", () => {
    const refusal = bridgeToolResultSchema.parse({
      requestId: "r1",
      ok: false,
      error: "Stop the running entry first",
    });
    const failure = bridgeToolResultSchema.parse({
      requestId: "r2",
      ok: false,
      error: "Boom",
      failed: true,
    });
    expect(refusal).not.toHaveProperty("failed");
    expect(failure).toMatchObject({ ok: false, failed: true });
  });

  it("fills list_work_items defaults so an empty call returns the sidebar", () => {
    expect(readToolInputSchemas.list_work_items.parse({})).toEqual({
      filter: "sidebar",
      limit: 50,
    });
  });

  it("rejects text that is not a real calendar date", () => {
    expect(isoDateSchema.safeParse("14/10/2026").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-13-45").success).toBe(false);
    expect(isoDateSchema.safeParse("2028-02-29").success).toBe(true);
    expect(isoDateSchema.safeParse("2026-10-14").success).toBe(true);
  });

  it("reads only the checked changes unless asked otherwise", () => {
    expect(
      readToolInputSchemas.get_week_changes.parse({ weekOf: "2026-10-14" }),
    ).toEqual({ weekOf: "2026-10-14", onlyChecked: true });
  });

  it("reads a week's status and submits a week, each by any of its days", () => {
    expect(
      readToolInputSchemas.get_week_status.parse({ weekOf: "2026-10-18" }),
    ).toEqual({ weekOf: "2026-10-18" });
    expect(
      writeToolInputSchemas.submit_week.safeParse({
        weekOf: "next week",
        version: "v:0a1b2c3d",
      }).success,
    ).toBe(false);
    // submit_week takes the version get_week_status returned.
    expect(
      writeToolInputSchemas.submit_week.safeParse({ weekOf: "2026-10-12" })
        .success,
    ).toBe(false);
    expect(
      writeToolInputSchemas.submit_week.parse({
        weekOf: "2026-10-12",
        version: "v:0a1b2c3d",
      }),
    ).toEqual({ weekOf: "2026-10-12", version: "v:0a1b2c3d" });
    expect(
      dataToolOutputSchemas.submit_week.parse({
        weekOf: "2026-10-12",
        locked: true,
        undoToken: "undo_1",
      }),
    ).toEqual({ weekOf: "2026-10-12", locked: true, undoToken: "undo_1" });
    expect(
      dataToolOutputSchemas.get_week_status.parse({
        weekOf: "2026-10-12",
        version: "v:0a1b2c3d",
        locked: false,
        uncommittedChanges: 0,
        committedHoursByDay: [{ date: "2026-10-12", hours: 7.5 }],
        committedEntries: [
          {
            entryId: "e1",
            externalId: "ajour:00000000",
            committed: { date: "2026-10-12", hours: 7.5 },
          },
        ],
        pace: {
          loggedHours: 7.5,
          targetHours: 40,
          expectedHours: 8,
          status: "on-pace",
        },
      }).committedEntries,
    ).toHaveLength(1);
  });

  it("needs at least one change, each with its version, to mark as committed", () => {
    const parse = (input: unknown) =>
      writeToolInputSchemas.mark_entries_committed.safeParse(input).success;

    expect(parse({ changes: [] })).toBe(false);
    expect(parse({ changes: [{ entryId: "e1" }] })).toBe(false);
    expect(parse({ entryIds: ["e1"] })).toBe(false);
    expect(parse({ changes: [{ entryId: "e1", version: "v:0a1b2c3d" }] })).toBe(
      true,
    );
  });

  it("deletes 1 to 500 entries, and gives every write its Undo token", () => {
    const parse = (entryIds: unknown) =>
      writeToolInputSchemas.delete_entries.safeParse({ entryIds }).success;

    expect(parse([])).toBe(false);
    expect(parse(["e1"])).toBe(true);
    expect(parse(Array.from({ length: 500 }, (_, index) => `e${index}`))).toBe(
      true,
    );
    expect(parse(Array.from({ length: 501 }, (_, index) => `e${index}`))).toBe(
      false,
    );
    expect(writeToolInputSchemas.discard_timer.parse({})).toEqual({});
    expect(
      writeToolInputSchemas.undo.safeParse({ undoToken: "" }).success,
    ).toBe(false);
    for (const tool of Object.keys(writeToolInputSchemas)) {
      const shape = (
        dataToolOutputSchemas as Record<
          string,
          { shape: Record<string, unknown> }
        >
      )[tool]!.shape;
      expect(shape, tool).toHaveProperty("undoToken");
    }
    expect(
      dataToolOutputSchemas.delete_entries.safeParse({ deleted: 2 }).success,
    ).toBe(false);
    expect(
      dataToolOutputSchemas.undo.parse({
        undone: "Deleted 2 entries",
        undoToken: null,
      }),
    ).toEqual({ undone: "Deleted 2 entries", undoToken: null });
  });

  it("reads a week's lines grouped by day and task unless asked otherwise", () => {
    expect(
      readToolInputSchemas.get_week_lines.parse({ weekOf: "2026-10-14" }),
    ).toEqual({ weekOf: "2026-10-14", groupBy: "day-task" });
    expect(
      readToolInputSchemas.get_week_lines.safeParse({
        weekOf: "2026-10-14",
        groupBy: "week",
      }).success,
    ).toBe(false);
  });

  it("gives a week's lines in hours, with the time kept out of them beside them", () => {
    const output = {
      weekOf: "2026-10-12",
      groupBy: "task",
      locked: true,
      sections: [
        {
          lines: [
            {
              projectId: "p1",
              projectName: "Acme Corporation",
              projectCode: "ACME-1",
              taskId: "t1",
              taskName: "07 Run",
              hours: 1.5,
              comments: "Specs | Review",
              entryIds: ["e1", "e2"],
            },
            { hours: 0.25, comments: "", entryIds: ["e3"] },
          ],
        },
      ],
      notSent: {
        hours: 1.5,
        items: [
          {
            projectId: "p1",
            projectName: "Acme Corporation",
            projectCode: "ACME-1",
            taskId: "t3",
            taskName: "Team lunch",
            hours: 1,
          },
          { projectId: "p2", projectName: "Home", hours: 0.5 },
        ],
      },
      waiting: {
        hours: 3,
        tasks: [
          {
            projectId: "p1",
            taskId: "t2",
            taskName: "Temp migration",
            hours: 3,
          },
        ],
      },
      running: {
        timerId: "t",
        date: "2026-10-14",
        unsavedMinutes: 15,
        entryId: "e4",
      },
    };
    expect(dataToolOutputSchemas.get_week_lines.parse(output)).toEqual(output);
    expect(
      dataToolOutputSchemas.get_week_lines.safeParse({
        ...output,
        sections: [{ lines: [{ hours: "1,50", comments: "", entryIds: [] }] }],
      }).success,
    ).toBe(false);
    expect(
      dataToolOutputSchemas.get_week_lines.safeParse({
        ...output,
        running: { timerId: "t", date: "2026-10-14", countedMinutes: 75 },
      }).success,
    ).toBe(false);
  });

  it("accepts a deleted change with committed values only", () => {
    expect(
      dataToolOutputSchemas.get_week_changes.parse({
        changes: [
          {
            change: "deleted",
            entryId: "e1",
            externalId: "ajour:00000000",
            version: "v:00000000",
            checked: true,
            committed: { date: "2026-10-13", hours: 1 },
          },
        ],
      }).changes,
    ).toHaveLength(1);
  });
});

describe("reads for the terminal", () => {
  it("finds entries by 4 to 32 lowercase hex characters only", () => {
    const parse = (idPrefix: unknown) =>
      readToolInputSchemas.find_entries.safeParse({ idPrefix }).success;

    expect(parse("3f2")).toBe(false);
    expect(parse("3f2a")).toBe(true);
    expect(parse("3f2a9c1e7b4d4e8a9c0b1d2e3f4a5b6c")).toBe(true);
    expect(parse("3f2a9c1e7b4d4e8a9c0b1d2e3f4a5b6c0")).toBe(false);
    expect(parse("3F2A")).toBe(false);
    expect(parse("3f2-")).toBe(false);
  });

  it("checks day targets, short ids, pinned slots and commit-as names", () => {
    expect(
      dataToolOutputSchemas.list_time_entries.parse({
        entries: [
          {
            entryId: "timesheet_1",
            shortId: "timesheet_1",
            date: "2026-10-13",
            state: "saved",
            minutes: 60,
          },
        ],
        running: null,
        targets: [{ date: "2026-10-13", hours: 8 }],
      }).targets,
    ).toEqual([{ date: "2026-10-13", hours: 8 }]);
    expect(
      dataToolOutputSchemas.list_time_entries.safeParse({
        entries: [],
        running: null,
        targets: [{ date: "2026-10-13" }],
      }).success,
    ).toBe(false);

    const project = (task: Record<string, unknown>) => ({
      projects: [
        {
          projectId: "p1",
          name: "Acme",
          fullName: "Acme Corporation",
          displayName: "Acme",
          localOnly: false,
          tasks: [{ taskId: "t1", name: "Build", ...task }],
        },
      ],
    });
    const parse = (task: Record<string, unknown>) =>
      dataToolOutputSchemas.list_projects.safeParse(project(task)).success;
    expect(parse({ pinnedSlot: 10, commitsAs: { kind: "own" } })).toBe(true);
    expect(parse({ commitsAs: { kind: "task", name: "07 Run" } })).toBe(true);
    expect(parse({ commitsAs: { kind: "not-known-yet" } })).toBe(true);
    expect(parse({ commitsAs: { kind: "local-only" } })).toBe(true);
    expect(parse({ pinnedSlot: 0 })).toBe(false);
    expect(parse({ pinnedSlot: 11 })).toBe(false);
    expect(parse({ commitsAs: { kind: "waiting" } })).toBe(false);

    expect(
      dataToolOutputSchemas.find_entries.parse({ entries: [], running: null }),
    ).toEqual({ entries: [], running: null });
  });
});
