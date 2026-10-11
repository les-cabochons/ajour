import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalTimesheetEntry } from "@/domain/local-state";
import {
  deleteTimesheetEntry,
  duplicateTimesheetEntry,
  moveTimesheetEntry,
  updateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import {
  cancelTimer,
  startTimer,
  startTimerWithEntry,
} from "@/domain/time/timer-transitions";
import {
  captureTimeEntryUndo,
  restoreTimeEntryUndo,
} from "@/domain/time/time-entry-undo";

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

/** Three entries on one day: the middle one is submitted, with an unrounded duration. */
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
        note: "Submitted work",
        durationMs: 75_123,
        committedAt: 20,
        submittedAt: 50,
        submittedFingerprint: "fingerprint-b",
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
  const undo = captureTimeEntryUndo(before, after);
  if (!undo) throw new Error("The action changed nothing.");
  return { after, undo };
}

describe("time entry undo", () => {
  it("restores a deleted entry exactly, in its old position, with its logged time", () => {
    const before = createState();
    const { after, undo } = undoAction(before, (state) =>
      deleteTimesheetEntry(state, "entry-b"),
    );

    const restored = restoreTimeEntryUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
    expect(restored.state.workItems).toEqual(before.workItems);
  });

  it("restores a discarded running entry and its provisional entry", () => {
    const before = startTimerWithEntry(
      createState(),
      { localDate: "2026-10-07", projectId: "project-1", taskId: "task-1" },
      { createId: (prefix) => `${prefix}-running`, now: () => 500 },
    );
    const { after, undo } = undoAction(before, (state) =>
      cancelTimer(state, "timer-running"),
    );
    expect(after.timers).toEqual([]);

    const restored = restoreTimeEntryUndo(after, undo);

    expect(restored.result).toBe("restored");
    expect(restored.state.timers).toEqual(before.timers);
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
  });

  it("restores a discarded timer that was continuing a saved entry", () => {
    const before = startTimer(
      createState(),
      {
        localDate: "2026-10-07",
        projectId: "project-1",
        taskId: "task-1",
        accumulatedDurationMs: HOUR,
        entryId: "entry-a",
      },
      { createId: (prefix) => `${prefix}-continue`, now: () => 500 },
    );
    const { after, undo } = undoAction(before, (state) =>
      cancelTimer(state, "timer-continue"),
    );

    const restored = restoreTimeEntryUndo(after, undo);

    expect(restored.state.timers).toEqual(before.timers);
    expect(restored.state.timesheetEntries).toEqual(before.timesheetEntries);
  });

  it("moves a submitted entry back to its day with its submission and order", () => {
    const before = createState();
    const { after, undo } = undoAction(before, (state) =>
      moveTimesheetEntry(
        state,
        "entry-b",
        {
          localDate: "2026-10-08",
          projectId: "project-1",
          taskId: "task-1",
          note: "Submitted work",
          durationMs: 75_123,
        },
        factories,
      ),
    );
    expect(after.timesheetEntries[1]).toMatchObject({
      localDate: "2026-10-08",
      committedAt: 100,
    });

    const restored = restoreTimeEntryUndo(after, undo);

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

    const restored = restoreTimeEntryUndo(after, undo);

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

    expect(restoreTimeEntryUndo(reloaded, undo).result).toBe("restored");
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

    const restored = restoreTimeEntryUndo(edited, undo);

    expect(restored.result).toBe("stale");
    expect(restored.state).toBe(edited);
  });

  it("does not bring a discarded timer back while another timer runs", () => {
    const before = startTimer(
      createState(),
      { localDate: "2026-10-07", note: "First timer" },
      { createId: () => "timer-first", now: () => 500 },
    );
    const { after, undo } = undoAction(before, (state) =>
      cancelTimer(state, "timer-first"),
    );
    const restarted = startTimer(
      after,
      { localDate: "2026-10-07", note: "Second timer" },
      { createId: () => "timer-second", now: () => 600 },
    );

    const restored = restoreTimeEntryUndo(restarted, undo);

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

    const restored = restoreTimeEntryUndo(after, undo);

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

    const restored = restoreTimeEntryUndo(after, undo);

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

    const restored = restoreTimeEntryUndo(synced, undo);

    expect(restored.state.workItems[0]).toMatchObject({
      remainingEstimateHours: 4,
      completedEstimateHours: 3,
    });
  });

  it("records nothing when the action was rejected", () => {
    const state = createState();

    expect(
      captureTimeEntryUndo(state, deleteTimesheetEntry(state, "missing")),
    ).toBeNull();
  });
});
