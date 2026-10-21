import { describe, expect, it } from "vitest";
import type {
  LocalAppState,
  LocalTimesheetEntry,
  LocalTimesheetImportDraft,
  LocalWorkItem,
} from "@/domain/local-state";
import {
  deleteWorkflowState,
  setWorkflowStateMapping,
} from "@/domain/backlog/workflow-states";
import {
  deleteWorkItem,
  updateWorkItem,
} from "@/domain/backlog/work-item-transitions";
import { archiveBacklogItem } from "@/domain/backlog/backlog-item-lifecycle";
import {
  setProjectTaskStatus,
  updateProject,
  updateProjectTask,
} from "@/domain/projects/project-transitions";
import {
  deleteTimesheetEntry,
  duplicateTimesheetEntry,
  markTimesheetEntriesCommitted,
  moveTimesheetEntry,
  updateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import { cancelTimer, startTimer } from "@/domain/time/timer-transitions";
import {
  clearTimesheetImportDrafts,
  dismissTimesheetImportDraft,
} from "@/domain/time/timesheet-import";
import {
  captureUndo,
  getUndoProjectIds,
  restoreUndo,
} from "@/domain/local-state-undo";

const HOUR = 60 * 60 * 1000;

function entry(
  overrides: Partial<LocalTimesheetEntry> & { _id: string },
): LocalTimesheetEntry {
  return {
    localDate: "2026-10-07",
    projectId: "project-1",
    taskId: "task-1",
    label: "Feature work",
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt: 10,
    ...overrides,
  };
}

/** Three entries on one day: the middle one is committed, with an unrounded duration. */
function createState(): LocalAppState {
  return {
    projects: [
      {
        _id: "project-1",
        name: "Mercury",
        color: "#123456",
        status: "active",
        tasks: [
          {
            _id: "task-1",
            name: "Feature work",
            status: "active",
            createdAt: 1,
          },
        ],
      },
    ],
    timers: [],
    timesheetEntries: [
      entry({ _id: "entry-a", note: "First", committedAt: 30 }),
      entry({
        _id: "entry-b",
        note: "Committed work",
        durationMs: 75_123,
        committedAt: 20,
        commit: {
          at: 50,
          localDate: "2026-10-07",
          projectId: "project-1",
          taskId: "task-1",
          note: "Committed work",
          durationMs: 75_123,
        },
      }),
      entry({ _id: "entry-c", note: "Last", committedAt: 10 }),
    ],
    workItems: [
      {
        _id: "work-item-1",
        title: "Feature work",
        status: "active",
        source: "manual",
        projectId: "project-1",
        taskId: "task-1",
        // Enough completed time to take back without clamping at zero.
        remainingEstimateHours: 2,
        completedEstimateHours: 3,
        createdAt: 1,
      },
    ],
    timesheetImportDrafts: [],
    timesheetTombstones: [],
    lockedWeeks: [],
    workflowStates: [],
    workflowStateMappings: [],
    workflowStateWriteRules: [],
  } as unknown as LocalAppState;
}

/** The fixture state with other estimates on its one work item. */
function withWorkItem(
  estimates: Partial<LocalAppState["workItems"][number]>,
): LocalAppState {
  const state = createState();
  return {
    ...state,
    workItems: [{ ...state.workItems[0]!, ...estimates }],
  };
}

const factories = { createId: () => "copy-1", now: () => 100 };

function undoAction(
  before: LocalAppState,
  action: (state: LocalAppState) => LocalAppState,
) {
  const after = action(before);
  const undo = captureUndo(before, after);
  if (!undo) throw new Error("The action changed nothing.");
  return { after, undo };
}

describe("time entry undo", () => {
  it("takes back a change to the submitted weeks", () => {
    const before = createState();
    const after = {
      ...before,
      lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 1 }],
    };

    const undo = captureUndo(before, after)!;
    const restored = restoreUndo(after, undo);

    expect(undo.lockedWeeks).toHaveLength(1);
    expect(restored.result).toBe("restored");
    expect(restored.state.lockedWeeks).toEqual([]);
  });

  /** The fixture with "entry-b" committed as it is. */
  function withCommittedEntryB(): LocalAppState {
    const state = createState();
    return {
      ...state,
      timesheetEntries: state.timesheetEntries.map((item) =>
        item._id === "entry-b"
          ? {
              ...item,
              commit: {
                at: 50,
                localDate: item.localDate,
                projectId: item.projectId,
                taskId: item.taskId,
                note: item.note,
                durationMs: item.durationMs,
              },
            }
          : item,
      ),
    };
  }

  it("takes the tombstone back when a committed entry's delete is undone", () => {
    const before = withCommittedEntryB();
    const { after, undo } = undoAction(before, (state) =>
      deleteTimesheetEntry(state, "entry-b"),
    );
    expect(after.timesheetTombstones).toEqual([
      expect.objectContaining({ entryId: "entry-b" }),
    ]);

    const restored = restoreUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.timesheetTombstones).toEqual([]);
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
  });

  it("undoes Mark as committed: previous copies return and the tombstone comes back", () => {
    const base = createState();
    const olderCommit = {
      at: 5,
      localDate: "2026-10-07",
      projectId: "project-1",
      taskId: "task-1",
      note: "Before the edit",
      durationMs: HOUR,
    };
    const before: LocalAppState = {
      ...base,
      timesheetEntries: [
        // Added: never committed.
        entry({ _id: "entry-a", note: "First" }),
        // Updated: its older copy has another note.
        entry({ _id: "entry-b", note: "After the edit", commit: olderCommit }),
      ],
      // Deleted: its committed copy is on a tombstone.
      timesheetTombstones: [
        {
          entryId: "entry-d",
          commit: { ...olderCommit, note: "Removed work" },
        },
      ],
    };
    const { after, undo } = undoAction(before, (state) =>
      markTimesheetEntriesCommitted(
        state,
        ["entry-a", "entry-b", "entry-d"],
        () => 900,
      ),
    );
    expect(after.timesheetTombstones).toEqual([]);
    expect(after.timesheetEntries.map((item) => item.commit?.at)).toEqual([
      900, 900,
    ]);

    const restored = restoreUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
    expect(restored.state.timesheetEntries[0]!.commit).toBeUndefined();
    expect(restored.state.timesheetEntries[1]!.commit).toEqual(olderCommit);
    expect(restored.state.timesheetTombstones).toEqual(
      before.timesheetTombstones,
    );
  });

  it("refuses to undo a delete whose deletion was committed since", () => {
    const { after, undo } = undoAction(withCommittedEntryB(), (state) =>
      deleteTimesheetEntry(state, "entry-b"),
    );
    // Committing the deleted change clears its tombstone.
    const deletionCommitted = { ...after, timesheetTombstones: [] };

    expect(restoreUndo(deletionCommitted, undo)).toEqual({
      state: deletionCommitted,
      result: "stale",
      staleReason: "changed_since",
    });
  });

  it("restores a deleted entry exactly, in its old position, with its logged time", () => {
    const before = createState();
    const { after, undo } = undoAction(before, (state) =>
      deleteTimesheetEntry(state, "entry-b"),
    );

    const restored = restoreUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("restores a discarded running entry that started from nothing", () => {
    const before = startTimer(
      createState(),
      { projectId: "project-1", taskId: "task-1" },
      "2026-10-07",
      { createId: (prefix) => `${prefix}-running`, now: () => 500 },
    );
    const { after, undo } = undoAction(before, (state) =>
      cancelTimer(state, "timer-running"),
    );
    expect(after.timers).toEqual([]);

    const restored = restoreUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.timers).toEqual(before.timers);
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
  });

  it("restores a discarded timer that was continuing a saved entry", () => {
    const before = startTimer(
      createState(),
      {
        projectId: "project-1",
        taskId: "task-1",
        accumulatedDurationMs: HOUR,
        entryId: "entry-a",
      },
      "2026-10-07",
      { createId: (prefix) => `${prefix}-continue`, now: () => 500 },
    );
    const { after, undo } = undoAction(before, (state) =>
      cancelTimer(state, "timer-continue"),
    );

    const restored = restoreUndo(after, undo);

    expect(restored.state.timers).toEqual(before.timers);
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
  });

  it("moves a committed entry back to its day with its copy and order", () => {
    const before = createState();
    const { after, undo } = undoAction(before, (state) =>
      moveTimesheetEntry(
        state,
        "entry-b",
        {
          localDate: "2026-10-08",
          projectId: "project-1",
          taskId: "task-1",
          note: "Committed work",
          durationMs: 75_123,
        },
        factories,
      ),
    );
    expect(after.timesheetEntries[1]).toMatchObject({
      localDate: "2026-10-08",
      committedAt: 100,
    });

    const restored = restoreUndo(after, undo);

    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("removes the copy made by Duplicate to… and takes back its logged time", () => {
    const before = createState();
    const { after, undo } = undoAction(before, (state) =>
      duplicateTimesheetEntry(
        state,
        "entry-a",
        {
          localDate: "2026-10-08",
          projectId: "project-1",
          taskId: "task-1",
          note: "First",
          durationMs: HOUR,
        },
        factories,
      ),
    );
    expect(after.workItems).not.toEqual(before.workItems);

    const restored = restoreUndo(after, undo);

    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("matches records read back from storage, where undefined fields are dropped", () => {
    const before = createState();
    const { after, undo } = undoAction(before, (state) =>
      moveTimesheetEntry(
        state,
        "entry-a",
        {
          localDate: "2026-10-08",
          projectId: "project-1",
          taskId: "task-1",
          note: "First",
          durationMs: HOUR,
        },
        factories,
      ),
    );
    const reloaded = JSON.parse(JSON.stringify(after)) as LocalAppState;

    expect(restoreUndo(reloaded, undo).result).toBe("restored");
  });

  it("leaves the state alone when the entry changed after the action", () => {
    const before = createState();
    const { after, undo } = undoAction(before, (state) =>
      moveTimesheetEntry(
        state,
        "entry-a",
        {
          localDate: "2026-10-08",
          projectId: "project-1",
          taskId: "task-1",
          note: "First",
          durationMs: HOUR,
        },
        factories,
      ),
    );
    const edited = updateTimesheetEntry(
      after,
      "entry-a",
      { note: "Edited after the move", durationMs: HOUR },
      factories,
    );

    const restored = restoreUndo(edited, undo);

    expect(restored.result).toBe("stale");
    expect(restored.state).toBe(edited);
  });

  it("does not bring a discarded timer back while another timer runs", () => {
    const before = startTimer(
      createState(),
      { note: "First timer" },
      "2026-10-07",
      { createId: () => "timer-first", now: () => 500 },
    );
    const { after, undo } = undoAction(before, (state) =>
      cancelTimer(state, "timer-first"),
    );
    const restarted = startTimer(
      after,
      { note: "Second timer" },
      "2026-10-07",
      { createId: () => "timer-second", now: () => 600 },
    );

    const restored = restoreUndo(restarted, undo);

    expect(restored.result).toBe("stale");
    expect(restored.state).toBe(restarted);
  });

  it("restores a completed estimate that the delete clamped at zero", () => {
    const before = withWorkItem({
      remainingEstimateHours: 2,
      completedEstimateHours: 0.5,
    });
    const { after, undo } = undoAction(before, (state) =>
      deleteTimesheetEntry(state, "entry-a"),
    );
    expect(after.workItems[0]?.completedEstimateHours).toBe(0);

    const restored = restoreUndo(after, undo);

    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("restores remaining and overrun estimates exactly", () => {
    const before = withWorkItem({
      remainingEstimateHours: 3,
      remainingEstimateOverrunHours: 0.5,
      completedEstimateHours: 4,
    });
    const { after, undo } = undoAction(before, (state) =>
      deleteTimesheetEntry(state, "entry-a"),
    );
    // The refund pays back the overrun first, which replaying 1h would not undo.
    expect(after.workItems[0]).toMatchObject({
      remainingEstimateHours: 3.5,
      remainingEstimateOverrunHours: undefined,
    });

    const restored = restoreUndo(after, undo);

    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("replays the logged time on a work item edited after the action", () => {
    const before = createState();
    const { after, undo } = undoAction(before, (state) =>
      deleteTimesheetEntry(state, "entry-a"),
    );
    expect(after.workItems[0]).toMatchObject({
      remainingEstimateHours: 3,
      completedEstimateHours: 2,
    });
    // A sync sets a new remaining estimate while the toast shows.
    const synced = {
      ...after,
      workItems: [{ ...after.workItems[0]!, remainingEstimateHours: 5 }],
    };

    const restored = restoreUndo(synced, undo);

    expect(restored.state.workItems[0]).toMatchObject({
      remainingEstimateHours: 4,
      completedEstimateHours: 3,
    });
  });

  it("records nothing when the action was rejected", () => {
    const state = createState();

    expect(
      captureUndo(state, deleteTimesheetEntry(state, "missing")),
    ).toBeNull();
  });
});

function workItem(
  overrides: Partial<LocalWorkItem> & { _id: string },
): LocalWorkItem {
  return {
    title: overrides._id,
    status: "active",
    source: "manual",
    createdAt: 1,
    ...overrides,
  };
}

function importDraft(_id: string): LocalTimesheetImportDraft {
  return {
    _id,
    localDate: "2026-10-07",
    projectName: "Mercury",
    taskName: "Feature work",
    durationMs: HOUR,
    potentialConflict: false,
    conflictEntryIds: [],
    importedAt: 5,
  };
}

/**
 * A parent backlog item whose two subitems sit apart in the list, two backlog
 * statuses with one source mapping, a second project task and three import
 * drafts.
 */
function createBacklogState(): LocalAppState {
  const state = createState();
  const project = state.projects[0]!;
  return setWorkflowStateMapping(
    {
      ...state,
      projects: [
        {
          ...project,
          tasks: [
            ...project.tasks,
            { _id: "task-2", name: "Review", status: "active", createdAt: 2 },
          ],
        },
      ],
      workItems: [
        workItem({ _id: "item-first", workflowStateId: "status-doing" }),
        workItem({ _id: "item-parent", description: "Parent notes" }),
        workItem({ _id: "subitem-1", parentWorkItemId: "item-parent" }),
        workItem({
          _id: "item-synced",
          source: "azure_devops",
          sourceId: "42",
          sourceConnectionId: "connection-1",
          sourceStatusKey: "active",
        }),
        workItem({ _id: "subitem-2", parentWorkItemId: "item-parent" }),
      ],
      workflowStates: [
        { _id: "status-doing", name: "Doing", color: "#2563eb", createdAt: 1 },
        { _id: "status-done", name: "Done", color: "#059669", createdAt: 2 },
      ],
      timesheetImportDrafts: [
        importDraft("draft-1"),
        importDraft("draft-2"),
        importDraft("draft-3"),
      ],
    },
    {
      source: "azure_devops",
      connectionId: "connection-1",
      sourceStatusKey: "active",
      workflowStateId: "status-doing",
    },
  );
}

describe("backlog and project undo", () => {
  it("restores a deleted backlog item and its subitems in their old places", () => {
    const before = createBacklogState();
    const { after, undo } = undoAction(before, (state) =>
      deleteWorkItem(state, "item-parent"),
    );
    expect(after.workItems.map((item) => item._id)).toEqual([
      "item-first",
      "item-synced",
    ]);

    const restored = restoreUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("keeps later edits to records the action did not change", () => {
    const before = createBacklogState();
    const { after, undo } = undoAction(before, (state) =>
      deleteWorkItem(state, "item-parent"),
    );
    const edited = updateWorkItem(after, "item-first", { title: "Renamed" });

    const restored = restoreUndo(edited, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.workItems.map((item) => item._id)).toEqual(
      before.workItems.map((item) => item._id),
    );
    expect(restored.state.workItems[0]?.title).toBe("Renamed");
  });

  it("restores an archived backlog item to active", () => {
    const before = createBacklogState();
    const { after, undo } = undoAction(before, (state) =>
      archiveBacklogItem(state, "item-parent", {
        createId: () => "unused",
        now: () => 100,
      }),
    );
    expect(after.workItems[1]).toMatchObject({
      status: "archived",
      archivedAt: 100,
    });

    const restored = restoreUndo(after, undo);

    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("refuses to undo an archive when the item changed after it", () => {
    const before = createBacklogState();
    const { after, undo } = undoAction(before, (state) =>
      archiveBacklogItem(state, "item-parent", {
        createId: () => "unused",
        now: () => 100,
      }),
    );
    const edited = updateWorkItem(after, "item-parent", {
      description: "Edited",
    });

    const restored = restoreUndo(edited, undo);

    expect(restored.result).toBe("stale");
    expect(restored.state).toBe(edited);
  });

  it("restores a deleted workflow state with its mapping and the items that used it", () => {
    const before = createBacklogState();
    expect(before.workItems[3]).toMatchObject({
      workflowStateId: "status-doing",
      importedWorkflowStateId: "status-doing",
    });
    const { after, undo } = undoAction(before, (state) =>
      deleteWorkflowState(state, "status-doing"),
    );
    expect(after.workflowStateMappings).toEqual([]);
    expect(after.workItems[0]?.workflowStateId).toBeUndefined();

    const restored = restoreUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.workflowStates).toEqual(before.workflowStates);
    expect(restored.state.workflowStateMappings).toEqual(
      before.workflowStateMappings,
    );
    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("lists the projects an undo would restore, so a team sync waits for them", () => {
    const before = createBacklogState();
    const { undo } = undoAction(before, (state) => ({
      ...state,
      projects: updateProject(state.projects, "project-1", { name: "Renamed" }),
    }));

    expect([...getUndoProjectIds(undo)]).toEqual(["project-1"]);
    expect(getUndoProjectIds(undefined).size).toBe(0);
  });

  it("restores an archived project", () => {
    const before = createBacklogState();
    const { after, undo } = undoAction(before, (state) => ({
      ...state,
      projects: updateProject(state.projects, "project-1", {
        status: "archived",
      }),
    }));

    const restored = restoreUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.projects).toEqual(before.projects);
  });

  it("restores an archived task, and refuses once its project changed again", () => {
    const before = createBacklogState();
    const { after, undo } = undoAction(before, (state) => ({
      ...state,
      projects: setProjectTaskStatus(
        state.projects,
        "project-1",
        "task-2",
        "archived",
        () => 100,
      ),
    }));

    expect(restoreUndo(after, undo).state.projects).toEqual(before.projects);

    const renamed = {
      ...after,
      projects: updateProjectTask(after.projects, "project-1", "task-1", {
        name: "Renamed",
      }),
    };
    expect(restoreUndo(renamed, undo).result).toBe("stale");
  });

  it("restores one dismissed import draft in its old place", () => {
    const before = createBacklogState();
    const { after, undo } = undoAction(before, (state) =>
      dismissTimesheetImportDraft(state, "draft-2"),
    );

    const restored = restoreUndo(after, undo);

    expect(restored.state.timesheetImportDrafts).toEqual(
      before.timesheetImportDrafts,
    );
  });

  it("restores every draft after Dismiss all", () => {
    const before = createBacklogState();
    const { after, undo } = undoAction(before, clearTimesheetImportDrafts);
    expect(after.timesheetImportDrafts).toEqual([]);

    const restored = restoreUndo(after, undo);

    expect(restored.state.timesheetImportDrafts).toEqual(
      before.timesheetImportDrafts,
    );
  });
});

it("restores custom backlog order and refuses undo after another reorder", () => {
  const before: LocalAppState = {
    ...createState(),
    workItems: [
      {
        _id: "a",
        title: "A",
        source: "manual",
        status: "active",
        createdAt: 1,
      },
      {
        _id: "b",
        title: "B",
        source: "manual",
        status: "active",
        createdAt: 1,
      },
    ],
  };
  const after = { ...before, workItems: [...before.workItems].reverse() };
  const undo = captureUndo(before, after)!;
  expect(
    restoreUndo(after, undo).state.workItems.map((item) => item._id),
  ).toEqual(["a", "b"]);
  expect(restoreUndo(before, undo).result).toBe("stale");
});
