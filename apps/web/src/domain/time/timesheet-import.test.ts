import { describe, expect, it } from "vitest";
import type {
  LocalAppState,
  LocalProject,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import {
  commitReadyTimesheetImportDrafts,
  commitTimesheetImportDraft,
  dismissTimesheetImportDraft,
  stageTimesheetImportRows,
  type TimesheetImportFactories,
} from "@/domain/time/timesheet-import";

function createFactories(): TimesheetImportFactories {
  let nextId = 1;

  return {
    createId: (prefix) => `${prefix}-${nextId++}`,
    now: () => 500,
  };
}

function createProject(status: "active" | "archived" = "active") {
  return {
    _id: "project-1",
    name: "Mercury",
    displayName: "Mercury",
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status,
    tasks: [
      {
        _id: "task-1",
        name: "Build",
        status: "active",
        createdAt: 100,
      },
    ],
  } satisfies LocalProject;
}

function createEntry(): LocalTimesheetEntry {
  return {
    _id: "entry-1",
    localDate: "2026-07-30",
    projectId: "project-1",
    taskId: "task-1",
    label: "Build",
    durationMs: 1_000,
    sourceBlockIds: [],
    committedAt: 100,
  };
}

function createState(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    projects: [createProject()],
    timesheetEntries: [],
    timesheetImportDrafts: [],
    timesheetTombstones: [],
    workItems: [],
    ...overrides,
  } as LocalAppState;
}

describe("timesheet import staging", () => {
  it("normalizes rows and detects matching local entries", () => {
    const state = stageTimesheetImportRows(
      createState({ timesheetEntries: [createEntry()] }),
      [
        {
          date: " 2026-07-30 ",
          project: " mércury ",
          task: " build ",
          note: " imported note ",
          hours: 1.5,
        },
      ],
      createFactories(),
    );

    expect(state.timesheetImportDrafts[0]).toMatchObject({
      _id: "timesheet_import-1",
      localDate: "2026-07-30",
      projectName: "mércury",
      taskName: "build",
      note: "imported note",
      durationMs: 1.5 * 60 * 60 * 1000,
      potentialConflict: true,
      conflictEntryIds: ["entry-1"],
      importedAt: 500,
    });
  });

  it("dismisses one staged row", () => {
    const staged = stageTimesheetImportRows(
      createState(),
      [
        {
          date: "2026-07-30",
          project: "Mercury",
          task: "Build",
          hours: 1,
        },
        {
          date: "2026-07-31",
          project: "Mercury",
          task: "Build",
          hours: 2,
        },
      ],
      createFactories(),
    );
    const dismissed = dismissTimesheetImportDraft(
      staged,
      staged.timesheetImportDrafts[0]!._id,
    );

    expect(dismissed.timesheetImportDrafts).toHaveLength(1);
    expect(dismissed.timesheetImportDrafts[0]?.localDate).toBe("2026-07-31");
  });

  it("rejects invalid durations and does not conflate unknown names with unassigned entries", () => {
    expect(() =>
      stageTimesheetImportRows(
        createState(),
        [
          {
            date: "2026-07-30",
            project: "Mercury",
            task: "Build",
            hours: Number.POSITIVE_INFINITY,
          },
        ],
        createFactories(),
      ),
    ).toThrow("Imported hours must be a positive finite number.");

    const staged = stageTimesheetImportRows(
      createState({
        timesheetEntries: [
          {
            ...createEntry(),
            projectId: undefined,
            taskId: undefined,
          },
        ],
      }),
      [
        {
          date: "2026-07-30",
          project: "Unknown",
          task: "Unknown",
          hours: 1,
        },
      ],
      createFactories(),
    );

    expect(staged.timesheetImportDrafts[0]?.potentialConflict).toBe(false);
  });

  it("rejects invalid dates and tasks without projects", () => {
    expect(() =>
      stageTimesheetImportRows(
        createState(),
        [
          {
            date: "2026-02-31",
            project: "Mercury",
            task: "Build",
            hours: 1,
          },
        ],
        createFactories(),
      ),
    ).toThrow("Imported date must use a valid YYYY-MM-DD value.");
    const staged = stageTimesheetImportRows(
      createState(),
      [
        {
          date: "2026-07-30",
          project: "",
          task: "Build",
          hours: 1,
        },
      ],
      createFactories(),
    );
    expect(() =>
      commitTimesheetImportDraft(
        staged,
        staged.timesheetImportDrafts[0]!._id,
        createFactories(),
      ),
    ).toThrow("Imported tasks require a project.");
  });
});

describe("timesheet import commits", () => {
  it("reactivates a matching project and commits against its task", () => {
    const staged = stageTimesheetImportRows(
      createState({ projects: [createProject("archived")] }),
      [
        {
          date: "2026-07-30",
          project: "Mercury",
          task: "Build",
          hours: 1,
        },
      ],
      createFactories(),
    );
    const committed = commitTimesheetImportDraft(
      staged,
      staged.timesheetImportDrafts[0]!._id,
      createFactories(),
    );

    expect(committed.projects[0]?.status).toBe("active");
    expect(committed.timesheetEntries[0]).toMatchObject({
      projectId: "project-1",
      taskId: "task-1",
      label: "Build",
      durationMs: 60 * 60 * 1000,
    });
    expect(committed.timesheetImportDrafts).toEqual([]);
  });

  it("reactivates a matching archived task", () => {
    const project: LocalProject = createProject();
    project.tasks[0]!.status = "archived";
    project.tasks[0]!.archivedAt = 200;
    const staged = stageTimesheetImportRows(
      createState({ projects: [project] }),
      [
        {
          date: "2026-07-30",
          project: "Mercury",
          task: "Build",
          hours: 1,
        },
      ],
      createFactories(),
    );
    const committed = commitTimesheetImportDraft(
      staged,
      staged.timesheetImportDrafts[0]!._id,
      createFactories(),
    );

    expect(committed.projects[0]?.tasks[0]).toMatchObject({
      status: "active",
      archivedAt: undefined,
    });
  });

  it("creates missing projects and tasks atomically", () => {
    const staged = stageTimesheetImportRows(
      createState({ projects: [] }),
      [
        {
          date: "2026-07-30",
          project: "Apollo",
          task: "Planning",
          hours: 2,
        },
      ],
      createFactories(),
    );
    const committed = commitTimesheetImportDraft(
      staged,
      staged.timesheetImportDrafts[0]!._id,
      createFactories(),
    );

    expect(committed.projects).toEqual([
      expect.objectContaining({
        name: "Apollo",
        status: "active",
        tasks: [expect.objectContaining({ name: "Planning" })],
      }),
    ]);
    expect(committed.timesheetEntries[0]).toMatchObject({
      projectId: committed.projects[0]?._id,
      taskId: committed.projects[0]?.tasks[0]?._id,
    });
  });

  it("commits ready rows and keeps conflicting drafts for review", () => {
    const staged = stageTimesheetImportRows(
      createState({ timesheetEntries: [createEntry()] }),
      [
        {
          date: "2026-07-30",
          project: "Mercury",
          task: "Build",
          hours: 1,
        },
        {
          date: "2026-07-31",
          project: "Mercury",
          task: "Build",
          hours: 2,
        },
      ],
      createFactories(),
    );
    const committed = commitReadyTimesheetImportDrafts(
      staged,
      createFactories(),
    );

    expect(committed.timesheetEntries).toHaveLength(2);
    expect(committed.timesheetImportDrafts).toEqual([
      expect.objectContaining({
        localDate: "2026-07-30",
        potentialConflict: true,
      }),
    ]);
  });

  it("rechecks conflicts while committing a batch", () => {
    const staged = stageTimesheetImportRows(
      createState({ timesheetEntries: [] }),
      [
        {
          date: "2026-07-30",
          project: "Mercury",
          task: "Build",
          hours: 1,
        },
        {
          date: "2026-07-30",
          project: "Mercury",
          task: "Build",
          hours: 2,
        },
      ],
      createFactories(),
    );
    const committed = commitReadyTimesheetImportDrafts(
      staged,
      createFactories(),
    );

    expect(committed.timesheetEntries).toHaveLength(1);
    expect(committed.timesheetImportDrafts).toEqual([
      expect.objectContaining({
        potentialConflict: true,
        conflictEntryIds: [committed.timesheetEntries[0]!._id],
      }),
    ]);
  });
});
