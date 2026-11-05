import { describe, expect, it } from "vitest";
import type {
  LocalAppState,
  LocalProject,
  LocalProjectTask,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  findTaskMergeSuggestions,
  mergeTask,
  taskNameCloseness,
} from "@/domain/projects/task-merge";
import { findLockedWeekWrite } from "@/domain/time/locked-weeks";
import { captureUndo, restoreUndo } from "@/domain/local-state-undo";

/*
 * Merge into… on a managed project (#507, ADR 0016): a local task, Design
 * review, merged into the source's Design reviews.
 */

const factories = {
  createId: (prefix: string) => `${prefix}-1`,
  now: () => 9_000,
};

function task(id: string, overrides: Partial<LocalProjectTask> = {}) {
  return {
    _id: id,
    name: `Task ${id}`,
    status: "active",
    createdAt: 10,
    ...overrides,
  } satisfies LocalProjectTask;
}

function managedProject(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    _id: "p1",
    name: "Acme - Support",
    color: "#123456",
    icon: DEFAULT_PROJECT_ICON,
    status: "active",
    source: {
      pluginId: "example-project-source",
      connectionId: "c1",
      remoteId: "acme",
      syncedAt: 1,
    },
    tasks: [
      task("local", { name: "Design review" }),
      task("source", {
        name: "Design reviews",
        source: { remoteId: "t1", group: "Build", assigned: true },
      }),
      task("other", {
        name: "Meetings",
        source: { remoteId: "t2", assigned: true },
      }),
    ],
    ...overrides,
  };
}

function entry(
  id: string,
  overrides: Partial<LocalTimesheetEntry> = {},
): LocalTimesheetEntry {
  return {
    _id: id,
    localDate: "2026-11-03",
    projectId: "p1",
    taskId: "local",
    label: "Design review",
    note: `Note ${id}`,
    durationMs: 3_600_000,
    sourceBlockIds: [],
    committedAt: 100,
    ...overrides,
  };
}

function state(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    user: { _id: "u", name: "U", email: "u@example.com" },
    projects: [managedProject()],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [],
    timesheetTombstones: [],
    lockedWeeks: [],
    timesheetImportDrafts: [],
    commitPromptedWeeks: [],
    workItems: [],
    workflowStates: [],
    workflowStateMappings: [],
    workflowStateWriteRules: [],
    backlogSortMode: "custom",
    capture: {
      urlMode: "sanitized_path",
      titleMode: "normalized",
      blockedDomains: [],
      sensitiveDomains: [],
      maxPathSegments: 4,
    },
    userPreferences: {} as LocalAppState["userPreferences"],
    updatedAt: 1,
    ...overrides,
  };
}

function projectOf(next: LocalAppState) {
  return next.projects.find((project) => project._id === "p1")!;
}

function taskOf(next: LocalAppState, taskId: string) {
  return projectOf(next).tasks.find((candidate) => candidate._id === taskId)!;
}

describe("mergeTask", () => {
  it("moves every entry of the task to the other task, under its name", () => {
    const before = state({
      timesheetEntries: [
        entry("e1"),
        entry("e2", { localDate: "2026-11-04" }),
        entry("kept", { taskId: "other", label: "Meetings" }),
      ],
    });

    const { state: after, result } = mergeTask(
      before,
      "p1",
      "local",
      "source",
      factories,
    );

    expect(result).toMatchObject({ kind: "merged", movedEntryCount: 2 });
    expect(
      after.timesheetEntries.map(
        ({ _id, taskId, label, note, durationMs }) => ({
          _id,
          taskId,
          label,
          note,
          durationMs,
        }),
      ),
    ).toEqual([
      {
        _id: "e1",
        taskId: "source",
        label: "Design reviews",
        note: "Note e1",
        durationMs: 3_600_000,
      },
      {
        _id: "e2",
        taskId: "source",
        label: "Design reviews",
        note: "Note e2",
        durationMs: 3_600_000,
      },
      {
        _id: "kept",
        taskId: "other",
        label: "Meetings",
        note: "Note kept",
        durationMs: 3_600_000,
      },
    ]);
    // The entries keep their place in their day.
    expect(after.timesheetEntries.map((item) => item.committedAt)).toEqual([
      100, 100, 100,
    ]);
  });

  it("marks committed copies stale, so the next commit moves them in the timesheet tool", () => {
    const committed = {
      at: 50,
      localDate: "2026-11-03",
      projectId: "p1",
      taskId: "local",
      note: "Note committed",
      durationMs: 3_600_000,
    };
    const before = state({
      timesheetEntries: [
        entry("committed", { commit: committed }),
        entry("added"),
        // Edited since its commit: already a change, its copy stays as it is.
        entry("edited", {
          durationMs: 7_200_000,
          commit: { ...committed, note: "Note edited" },
        }),
      ],
    });

    const { state: after, result } = mergeTask(
      before,
      "p1",
      "local",
      "source",
      factories,
    );

    const byId = new Map(
      after.timesheetEntries.map((item) => [item._id, item]),
    );
    expect(byId.get("committed")!.commit).toEqual({
      ...committed,
      stale: true,
    });
    expect(byId.get("added")!.commit).toBeUndefined();
    expect(byId.get("edited")!.commit).toEqual({
      ...committed,
      note: "Note edited",
    });
    expect(result).toMatchObject({ staleEntryCount: 1 });
  });

  it("moves the running entry too, without losing its running time", () => {
    const timer = {
      _id: "timer-1",
      startedAt: 500,
      localDate: "2026-11-03",
      projectId: "p1",
      taskId: "local",
      note: "Note e1",
      accumulatedDurationMs: 3_600_000,
      entryId: "e1",
    };
    const other = {
      ...timer,
      _id: "timer-2",
      taskId: "other",
      entryId: undefined,
    };
    const before = state({
      timesheetEntries: [entry("e1")],
      timers: [timer, other],
    });

    const { state: after, result } = mergeTask(
      before,
      "p1",
      "local",
      "source",
      factories,
    );

    expect(after.timers).toEqual([{ ...timer, taskId: "source" }, other]);
    expect(result).toMatchObject({ movedTimerCount: 1 });
  });

  it("archives the emptied task, and moves its pin and star to a task without", () => {
    const before = state({
      projects: [
        managedProject({
          tasks: [
            task("local", {
              name: "Design review",
              pinnedSlot: "3",
              favoritedAt: 40,
            }),
            task("source", {
              name: "Design reviews",
              source: { remoteId: "t1", group: "Build", assigned: true },
            }),
          ],
        }),
      ],
    });

    const { state: after, result } = mergeTask(
      before,
      "p1",
      "local",
      "source",
      factories,
    );

    expect(taskOf(after, "local")).toEqual({
      _id: "local",
      name: "Design review",
      status: "archived",
      createdAt: 10,
      archivedAt: 9_000,
    });
    expect(taskOf(after, "source")).toEqual({
      _id: "source",
      name: "Design reviews",
      status: "active",
      createdAt: 10,
      source: { remoteId: "t1", group: "Build", assigned: true },
      pinnedSlot: "3",
      favoritedAt: 40,
    });
    expect(result).toMatchObject({ movedPin: true, movedFavorite: true });
  });

  it("leaves the target's own pin and star, and the merged task's source link", () => {
    const before = state({
      projects: [
        managedProject({
          tasks: [
            task("old", {
              name: "Design",
              pinnedSlot: "3",
              favoritedAt: 40,
              status: "archived",
              archivedAt: 800,
              archivedByMissingSync: true,
              source: { remoteId: "t0", group: "Build", assigned: true },
            }),
            task("source", {
              name: "Design reviews",
              pinnedSlot: "4",
              favoritedAt: 50,
              source: { remoteId: "t1", group: "Build", assigned: true },
            }),
          ],
        }),
      ],
    });

    const { state: after, result } = mergeTask(
      before,
      "p1",
      "old",
      "source",
      factories,
    );

    expect(taskOf(after, "source")).toMatchObject({
      pinnedSlot: "4",
      favoritedAt: 50,
      source: { remoteId: "t1", group: "Build", assigned: true },
    });
    // Archived by the user now: the source no longer brings it back.
    expect(taskOf(after, "old")).toEqual({
      _id: "old",
      name: "Design",
      status: "archived",
      createdAt: 10,
      archivedAt: 800,
      pinnedSlot: "3",
      favoritedAt: 40,
      source: { remoteId: "t0", group: "Build", assigned: true },
    });
    expect(result).toMatchObject({ movedPin: false, movedFavorite: false });
  });

  it.each([
    {
      why: "a Local only target, whose time never reaches the timesheet tool",
      into: "lunch",
      reason: "local_only_target",
    },
    {
      why: "a target in another project",
      into: "elsewhere",
      reason: "missing",
    },
    { why: "the same task", into: "local", reason: "same_task" },
    { why: "an archived target", into: "closed", reason: "archived_target" },
  ] as const)("refuses $why and changes nothing", ({ into, reason }) => {
    const before = state({
      projects: [
        managedProject({
          tasks: [
            task("local", { name: "Design review" }),
            task("lunch", { name: "Team lunch", commitAs: "local" }),
            task("closed", { status: "archived", archivedAt: 5 }),
          ],
        }),
        {
          ...managedProject({ _id: "p2" }),
          tasks: [task("elsewhere")],
        },
      ],
      timesheetEntries: [entry("e1")],
    });

    const merged = mergeTask(before, "p1", "local", into, factories);

    expect(merged).toEqual({
      state: before,
      result: { kind: "refused", reason },
    });
    expect(merged.state).toBe(before);
  });

  it("refuses in a project that isn't managed", () => {
    const before = state({
      projects: [managedProject({ source: undefined })],
      timesheetEntries: [entry("e1")],
    });

    expect(
      mergeTask(before, "p1", "local", "source", factories).result,
    ).toEqual({ kind: "refused", reason: "not_managed" });
  });

  it("leaves entries of submitted weeks on the merged task, as the timesheet tool has them", () => {
    const before = state({
      lockedWeeks: [{ weekOf: "2026-10-26", lockedAt: 1 }],
      timesheetEntries: [
        entry("submitted", { localDate: "2026-10-27" }),
        entry("e1"),
      ],
    });

    const { state: after, result } = mergeTask(
      before,
      "p1",
      "local",
      "source",
      factories,
    );

    expect(after.timesheetEntries.map((item) => item.taskId)).toEqual([
      "local",
      "source",
    ]);
    expect(result).toMatchObject({ movedEntryCount: 1, keptEntryCount: 1 });
    expect(findLockedWeekWrite(before, after)).toBeUndefined();
    expect(taskOf(after, "local").status).toBe("archived");
  });

  it("is undone in one step: entries, running entry, pin and task come back", () => {
    const before = state({
      projects: [
        managedProject({
          tasks: [
            task("local", { name: "Design review", pinnedSlot: "3" }),
            task("source", {
              name: "Design reviews",
              source: { remoteId: "t1", assigned: true },
            }),
          ],
        }),
      ],
      timesheetEntries: [
        entry("e1", {
          commit: {
            at: 50,
            localDate: "2026-11-03",
            projectId: "p1",
            taskId: "local",
            note: "Note e1",
            durationMs: 3_600_000,
          },
        }),
      ],
      timers: [
        {
          _id: "timer-1",
          startedAt: 500,
          localDate: "2026-11-03",
          projectId: "p1",
          taskId: "local",
          accumulatedDurationMs: 0,
        },
      ],
    });
    const { state: after } = mergeTask(
      before,
      "p1",
      "local",
      "source",
      factories,
    );

    const undone = restoreUndo(after, captureUndo(before, after)!);

    expect(undone.result).toBe("restored");
    expect(undone.state.projects).toEqual(before.projects);
    expect(undone.state.timesheetEntries).toEqual(before.timesheetEntries);
    expect(undone.state.timers).toEqual(before.timers);
  });

  it("keeps when the entries were last used, so recent tasks don't change", () => {
    const before = state({
      timesheetEntries: [entry("e1", { usedAt: 70 }), entry("e2")],
    });

    const { state: after } = mergeTask(
      before,
      "p1",
      "local",
      "source",
      factories,
    );

    expect(after.timesheetEntries.map((item) => item.usedAt)).toEqual([
      70,
      undefined,
    ]);
  });
});

describe("findTaskMergeSuggestions", () => {
  const sourceTask = (
    id: string,
    name: string,
    overrides: Partial<LocalProjectTask> = {},
  ) =>
    task(id, {
      name,
      createdAt: 1_000,
      source: { remoteId: `r-${id}`, group: "Build", assigned: true },
      ...overrides,
    });
  // The source renamed Design to Design reviews: the sync archived one and
  // added the other at 1,000.
  const gone = sourceTask("gone", "Design", {
    createdAt: 10,
    status: "archived",
    archivedAt: 1_000,
    archivedByMissingSync: true,
  });

  it("pairs a task that left the source with a new one of its group, closest name first", () => {
    const project = managedProject({
      tasks: [
        gone,
        sourceTask("far", "Testing"),
        sourceTask("near", "Design reviews"),
        sourceTask("older", "Designs", { createdAt: 500 }),
        sourceTask("elsewhere", "Design!", {
          source: { remoteId: "r-x", group: "Run", assigned: true },
        }),
      ],
    });

    expect(
      findTaskMergeSuggestions(project, [entry("e1", { taskId: "gone" })]),
    ).toEqual([{ kind: "renamed", fromTaskId: "gone", intoTaskId: "near" }]);
  });

  it("pairs a gone task only while it holds entries", () => {
    const project = managedProject({
      tasks: [gone, sourceTask("near", "Design reviews")],
    });

    expect(findTaskMergeSuggestions(project, [])).toEqual([]);
  });

  it("pairs a local task with a source task of a close name", () => {
    const project = managedProject({
      tasks: [
        task("local", { name: "design  Review" }),
        task("unlike", { name: "Lunch" }),
        sourceTask("source", "Design reviews"),
        sourceTask("other", "Meetings"),
      ],
    });

    expect(findTaskMergeSuggestions(project, [])).toEqual([
      { kind: "lookalike", fromTaskId: "local", intoTaskId: "source" },
    ]);
  });

  it("never suggests anything for a Local only task or project", () => {
    const tasks = [
      { ...gone, commitAs: "local" as const },
      task("local", { name: "Design review", commitAs: "local" }),
      sourceTask("source", "Design reviews"),
    ];
    const entries = [entry("e1", { taskId: "gone" })];

    expect(
      findTaskMergeSuggestions(managedProject({ tasks }), entries),
    ).toEqual([]);
    expect(
      findTaskMergeSuggestions(
        managedProject({
          localOnly: true,
          tasks: [gone, task("local", { name: "Design review" }), tasks[2]!],
        }),
        entries,
      ),
    ).toEqual([]);
  });

  it("skips a pair the user said is not the same, for the next closest", () => {
    const project = managedProject({
      tasks: [
        task("local", { name: "Design review" }),
        sourceTask("source", "Design reviews"),
        sourceTask("second", "Design preview"),
      ],
    });

    expect(
      findTaskMergeSuggestions(
        project,
        [],
        (pair) => pair.intoTaskId === "source",
      ),
    ).toEqual([
      { kind: "lookalike", fromTaskId: "local", intoTaskId: "second" },
    ]);
  });

  it("suggests nothing in a project that isn't managed", () => {
    const project = managedProject({
      source: undefined,
      tasks: [
        task("local", { name: "Design review" }),
        sourceTask("source", "Design reviews"),
      ],
    });

    expect(findTaskMergeSuggestions(project, [])).toEqual([]);
  });
});

describe("taskNameCloseness", () => {
  it.each([
    ["Design review", "design  REVIEW", 1],
    ["Meeting", "Meetings", 0.92],
    ["Design review", "Design preview", 0.88],
    ["Design", "Design reviews", 0.56],
    ["Support", "Sport", 0.6],
    ["Design", "Testing", 0.18],
  ] as const)("rates %s and %s at %d", (left, right, closeness) => {
    expect(taskNameCloseness(left, right)).toBeCloseTo(closeness, 2);
  });
});
