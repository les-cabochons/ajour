import { describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalTimesheetEntry,
  LocalTimesheetTombstone,
} from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  describeTimesheetCommitValues,
  getTimesheetEntryChange,
  isTimesheetEntryCommitted,
  listWeekChanges,
  normalizeTimesheetTombstones,
  toCommittedCopy,
} from "@/domain/time/timesheet-commit";

const HOUR = 3_600_000;
const WEEK = [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-10",
  "2026-10-11",
];
const NEXT_WEEK = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
];

function entry(
  overrides: Partial<LocalTimesheetEntry> & { _id: string },
): LocalTimesheetEntry {
  return {
    localDate: "2026-10-05",
    projectId: "project-1",
    taskId: "task-1",
    label: "Build",
    note: "API",
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt: 10,
    ...overrides,
  };
}

/** The entry with a copy of its own values, as right after a commit at 50. */
function committed(value: LocalTimesheetEntry): LocalTimesheetEntry {
  return { ...value, commit: toCommittedCopy(value, 50) };
}

function tombstone(
  entryId: string,
  localDate: string,
): LocalTimesheetTombstone {
  return {
    entryId,
    commit: {
      at: 50,
      localDate,
      projectId: "project-1",
      taskId: "task-1",
      note: "Gone",
      durationMs: HOUR,
    },
  };
}

describe("timesheet entry change", () => {
  it("is added until the entry has a committed copy", () => {
    expect(getTimesheetEntryChange(entry({ _id: "a" }))).toEqual({
      kind: "added",
      entryId: "a",
      current: {
        localDate: "2026-10-05",
        projectId: "project-1",
        taskId: "task-1",
        note: "API",
        durationMs: HOUR,
      },
    });
  });

  it("is none when the copy matches, so the entry is committed", () => {
    const value = committed(entry({ _id: "a" }));

    expect(getTimesheetEntryChange(value)).toBeUndefined();
    expect(isTimesheetEntryCommitted(value)).toBe(true);
    expect(isTimesheetEntryCommitted(entry({ _id: "b" }))).toBe(false);
  });

  it.each([
    ["localDate", { localDate: "2026-10-06" }],
    ["projectId", { projectId: "project-2" }],
    ["taskId", { taskId: "task-2" }],
    ["note", { note: "Login form" }],
    ["durationMs", { durationMs: 2 * HOUR }],
  ] as const)("is updated when %s changed", (field, edit) => {
    const value = { ...committed(entry({ _id: "a" })), ...edit };

    expect(getTimesheetEntryChange(value)).toMatchObject({
      kind: "updated",
      entryId: "a",
      changedFields: [field],
      committed: { durationMs: HOUR, note: "API" },
    });
  });

  it("ignores spaces around the note, the order and the label", () => {
    const value = {
      ...committed(entry({ _id: "a" })),
      note: "  API ",
      committedAt: 99,
      label: "Renamed",
    };

    expect(getTimesheetEntryChange(value)).toBeUndefined();
  });

  it("treats a blank note as no note", () => {
    const value = committed(entry({ _id: "a", note: undefined }));

    expect(getTimesheetEntryChange({ ...value, note: " " })).toBeUndefined();
  });

  it("is updated with no changed field while the copy is stale", () => {
    const value = committed(entry({ _id: "a" }));
    const stale = {
      ...value,
      commit: { ...value.commit!, stale: true as const },
    };

    expect(getTimesheetEntryChange(stale)).toMatchObject({
      kind: "updated",
      changedFields: [],
    });
    expect(isTimesheetEntryCommitted(stale)).toBe(false);
  });

  it("shows no change once an edit returns every value to the copy", () => {
    const value = committed(entry({ _id: "a" }));
    const edited = { ...value, durationMs: 2 * HOUR, note: "Other" };

    expect(getTimesheetEntryChange(edited)?.kind).toBe("updated");
    expect(
      getTimesheetEntryChange({ ...edited, durationMs: HOUR, note: "API" }),
    ).toBeUndefined();
  });
});

describe("week changes", () => {
  it("lists the week's changes by day, then added, updated and deleted", () => {
    const changes = listWeekChanges({
      entries: [
        {
          ...committed(entry({ _id: "tue-updated", localDate: "2026-10-06" })),
          durationMs: 2 * HOUR,
        },
        entry({ _id: "tue-added", localDate: "2026-10-06" }),
        committed(entry({ _id: "mon-same" })),
        entry({ _id: "mon-added" }),
        entry({ _id: "next-week", localDate: "2026-10-12" }),
      ],
      tombstones: [
        tombstone("tue-deleted", "2026-10-06"),
        tombstone("last-week", "2026-09-28"),
      ],
      weekDates: WEEK,
    });

    expect(changes.map((change) => [change.kind, change.entryId])).toEqual([
      ["added", "mon-added"],
      ["added", "tue-added"],
      ["updated", "tue-updated"],
      ["deleted", "tue-deleted"],
    ]);
  });

  it("lists an entry moved to another week as one update in both weeks", () => {
    const moved = {
      ...committed(entry({ _id: "moved", localDate: "2026-10-09" })),
      localDate: "2026-10-13",
    };

    for (const weekDates of [WEEK, NEXT_WEEK]) {
      expect(
        listWeekChanges({ entries: [moved], tombstones: [], weekDates }),
      ).toEqual([
        expect.objectContaining({
          kind: "updated",
          entryId: "moved",
          changedFields: ["localDate"],
        }),
      ]);
    }
  });

  it("is empty when every entry is committed", () => {
    expect(
      listWeekChanges({
        entries: [committed(entry({ _id: "a" }))],
        tombstones: [],
        weekDates: WEEK,
      }),
    ).toEqual([]);
  });
});

describe("describing committed values", () => {
  const projects: LocalProject[] = [
    {
      _id: "project-1",
      name: "Acme Corporation",
      displayName: "Acme",
      code: " ACME-1 ",
      color: "#000",
      icon: DEFAULT_PROJECT_ICON,
      status: "archived",
      tasks: [
        { _id: "task-1", name: "Build", status: "archived", createdAt: 1 },
      ],
    },
  ];

  it("names an archived project and task, so a deleted entry still reads", () => {
    expect(
      describeTimesheetCommitValues(projects, {
        projectId: "project-1",
        taskId: "task-1",
      }),
    ).toEqual({
      projectName: "Acme",
      projectFullName: "Acme Corporation",
      projectCode: "ACME-1",
      taskName: "Build",
    });
  });

  it("leaves out what it cannot find", () => {
    expect(
      describeTimesheetCommitValues(projects, {
        projectId: "gone",
        taskId: "task-1",
      }),
    ).toEqual({});
  });
});

describe("stored tombstones", () => {
  it("keeps valid tombstones and drops malformed ones and repeats", () => {
    const valid = tombstone("a", "2026-10-05");

    expect(
      normalizeTimesheetTombstones([
        valid,
        { entryId: "b", commit: { at: "soon", localDate: "2026-10-05" } },
        { commit: valid.commit },
        { ...valid, commit: { ...valid.commit, at: 60 } },
        null,
      ]),
    ).toEqual([valid]);
  });

  it("keeps the stale flag of a stored copy", () => {
    const stale = tombstone("a", "2026-10-05");
    stale.commit.stale = true;

    expect(normalizeTimesheetTombstones([stale])).toEqual([stale]);
  });

  it("reads a missing list as empty", () => {
    expect(normalizeTimesheetTombstones(undefined)).toEqual([]);
  });
});
