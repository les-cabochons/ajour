import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalTimesheetEntry } from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  deleteTimesheetEntries,
  deleteTimesheetEntry,
  duplicateTimesheetEntry,
  markTimesheetEntriesCommitted,
  markTimesheetEntriesNotCommitted,
  markTimesheetEntryNotCommitted,
  moveTimesheetEntry,
  normalizeTimesheetEntry,
  pasteTimesheetEntries,
  relocateTimesheetEntries,
  reorderTimesheetEntries,
  saveManualTimesheetEntry,
  placeRunningRow,
  selectMostRecentTimesheetEntry,
  selectSortableDayEntryIds,
  updateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import { getTimesheetEntryChange } from "@/domain/time/timesheet-commit";
import { getSharedTableStepOrder } from "@/lib/table-drag";

function createState(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    user: {
      _id: "local-user",
      name: "Local User",
      email: "local@example.com",
    },
    projects: [
      {
        _id: "project-1",
        name: "Mercury",
        color: "#123456",
        icon: DEFAULT_PROJECT_ICON,
        status: "active",
        tasks: [
          {
            _id: "task-1",
            name: "Feature work",
            status: "active",
            createdAt: 1,
            billable: true,
          },
        ],
      },
    ],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [],
    timesheetImportDrafts: [],
    timesheetTombstones: [],
    workItems: [
      {
        _id: "work-item-1",
        title: "Feature work",
        status: "active",
        source: "manual",
        projectId: "project-1",
        taskId: "task-1",
        remainingEstimateHours: 2,
        completedEstimateHours: 0,
        createdAt: 1,
      },
    ],
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
    userPreferences: {
      themeMode: "system",
      updateTrack: "stable",
      projectDataShapeId: "default",
      weeklyTimeViewStyle: "grid",
      weeklyCapacityTargets: {
        monday: 8,
        tuesday: 8,
        wednesday: 8,
        thursday: 8,
        friday: 8,
        saturday: 0,
        sunday: 0,
      },
      warnWhenOverCapacity: true,
      warnWhenSubmittingUnderCapacity: true,
      closeParentSubitems: "ask",
    },
    updatedAt: 0,
    ...overrides,
  };
}

const factories = {
  createId: () => "timesheet-1",
  now: () => 100,
};

describe("timesheet entry lifecycle", () => {
  it("creates a labeled entry and applies logged time to mapped work", () => {
    const state = saveManualTimesheetEntry(
      createState(),
      {
        localDate: "2026-07-30",
        projectId: "project-1",
        taskId: "task-1",
        note: "Implementation",
        durationMs: 60 * 60 * 1000,
      },
      factories,
    );

    expect(state.timesheetEntries[0]).toEqual({
      _id: "timesheet-1",
      localDate: "2026-07-30",
      workItemId: undefined,
      projectId: "project-1",
      taskId: "task-1",
      label: "Feature work",
      note: "Implementation",
      durationMs: 60 * 60 * 1000,
      sourceBlockIds: [],
      committedAt: 100,
    });
    expect(state.workItems[0]).toMatchObject({
      remainingEstimateHours: 1,
      completedEstimateHours: 1,
    });
  });

  it("gives an entry stored as submitted a committed copy of its values", () => {
    const entry = normalizeTimesheetEntry({
      _id: "entry-1",
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      label: "Legacy",
      note: "Shipped",
      durationMs: 100,
      committedAt: 1,
      submittedAt: 0,
      submittedFingerprint: "old",
    } as never);

    expect(entry).toEqual({
      _id: "entry-1",
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      label: "Legacy",
      note: "Shipped",
      durationMs: 100,
      committedAt: 1,
      sourceBlockIds: [],
      commit: {
        at: 0,
        localDate: "2026-07-30",
        projectId: "project-1",
        taskId: "task-1",
        note: "Shipped",
        durationMs: 100,
      },
    });
    expect(entry).not.toHaveProperty("submittedAt");
    expect(entry).not.toHaveProperty("submittedFingerprint");
  });

  it("gives an entry edited since its submission no copy, so it shows as added", () => {
    const entry = normalizeTimesheetEntry({
      _id: "entry-1",
      localDate: "2026-07-30",
      label: "Legacy",
      durationMs: 100,
      committedAt: 1,
      previousSubmittedAt: 5,
    } as never);

    expect(entry.commit).toBeUndefined();
    expect(entry).not.toHaveProperty("previousSubmittedAt");
  });

  it("keeps a stored copy and drops a malformed one", () => {
    const commit = { at: 9, localDate: "2026-07-30", durationMs: 100 };
    const stored = {
      _id: "entry-1",
      localDate: "2026-07-30",
      label: "Stored",
      durationMs: 100,
      sourceBlockIds: [],
      committedAt: 1,
    };

    expect(
      normalizeTimesheetEntry({ ...stored, commit } as never).commit,
    ).toEqual(commit);
    expect(
      normalizeTimesheetEntry({ ...stored, commit: { at: "x" } } as never),
    ).not.toHaveProperty("commit");
  });

  it("clears a derived task label when the task is removed", () => {
    const state = createState({
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-07-30",
          projectId: "project-1",
          taskId: "task-1",
          label: "Feature work",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 50,
        },
      ],
    });
    const updated = updateTimesheetEntry(
      state,
      "entry-1",
      { projectId: "project-1", taskId: undefined, durationMs: 100 },
      factories,
    );

    expect(updated.timesheetEntries[0]).toMatchObject({
      label: "",
      committedAt: 50,
    });
  });

  it("preserves omitted fields and synchronizes a linked timer edit", () => {
    const state = createState({
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-07-30",
          projectId: "project-1",
          taskId: "task-1",
          label: "Feature work",
          note: "Keep me",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 50,
        },
      ],
      timers: [
        {
          _id: "timer-1",
          entryId: "entry-1",
          localDate: "2026-07-30",
          projectId: "project-1",
          taskId: "task-1",
          accumulatedDurationMs: 100,
          startedAt: 10,
        },
      ],
    });
    const updated = updateTimesheetEntry(
      state,
      "entry-1",
      { durationMs: 200 },
      { ...factories, now: () => 150 },
    );

    expect(updated.timesheetEntries[0]).toMatchObject({
      projectId: "project-1",
      taskId: "task-1",
      note: "Keep me",
      durationMs: 200,
    });
    expect(updated.timers[0]).toMatchObject({
      accumulatedDurationMs: 200,
      startedAt: 150,
    });
  });

  it("deletes an unlinked entry and reverses logged estimates", () => {
    const saved = saveManualTimesheetEntry(
      createState(),
      {
        localDate: "2026-07-30",
        projectId: "project-1",
        taskId: "task-1",
        durationMs: 60 * 60 * 1000,
      },
      factories,
    );
    const deleted = deleteTimesheetEntry(saved, "timesheet-1");

    expect(deleted.timesheetEntries).toEqual([]);
    expect(deleted.workItems[0]).toMatchObject({
      remainingEstimateHours: 2,
      completedEstimateHours: 0,
    });
  });

  it("deletes several entries at once and reverses their logged estimates", () => {
    const halfHour = 30 * 60 * 1000;
    const withFirst = saveManualTimesheetEntry(
      createState(),
      {
        localDate: "2026-07-30",
        projectId: "project-1",
        taskId: "task-1",
        durationMs: halfHour,
      },
      { ...factories, createId: () => "timesheet-1" },
    );
    const withBoth = saveManualTimesheetEntry(
      withFirst,
      {
        localDate: "2026-07-31",
        projectId: "project-1",
        taskId: "task-1",
        durationMs: halfHour,
      },
      { ...factories, createId: () => "timesheet-2" },
    );
    const deleted = deleteTimesheetEntries(withBoth, [
      "timesheet-1",
      "timesheet-2",
    ]);

    expect(deleted.timesheetEntries).toEqual([]);
    expect(deleted.workItems[0]).toMatchObject({
      remainingEstimateHours: 2,
      completedEstimateHours: 0,
    });
  });

  it("rejects delete, duplicate, and move while an entry is linked to a running timer", () => {
    const saved = saveManualTimesheetEntry(
      createState(),
      {
        localDate: "2026-07-30",
        projectId: "project-1",
        taskId: "task-1",
        durationMs: 60 * 60 * 1000,
      },
      factories,
    );
    const runningState = {
      ...saved,
      timers: [
        {
          _id: "timer-1",
          startedAt: 1,
          localDate: "2026-07-30",
          projectId: "project-1",
          taskId: "task-1",
          accumulatedDurationMs: 60 * 60 * 1000,
          entryId: "timesheet-1",
        },
      ],
    };
    const relocateValues = {
      localDate: "2026-07-31",
      projectId: "project-1",
      taskId: "task-1",
      durationMs: 60 * 60 * 1000,
    };

    expect(deleteTimesheetEntry(runningState, "timesheet-1")).toBe(
      runningState,
    );
    expect(deleteTimesheetEntries(runningState, ["timesheet-1"])).toBe(
      runningState,
    );
    expect(
      duplicateTimesheetEntry(
        runningState,
        "timesheet-1",
        relocateValues,
        factories,
      ),
    ).toBe(runningState);
    expect(
      moveTimesheetEntry(
        runningState,
        "timesheet-1",
        relocateValues,
        factories,
      ),
    ).toBe(runningState);
  });

  it("duplicates visible values without copying the committed copy or source provenance", () => {
    const state = createState({
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-07-30",
          workItemId: "work-item-1",
          projectId: "project-1",
          taskId: "task-1",
          label: "Feature work",
          note: "Original",
          durationMs: 60 * 60 * 1000,
          sourceBlockIds: ["block-1"],
          committedAt: 10,
          commit: {
            at: 20,
            localDate: "2026-07-30",
            projectId: "project-1",
            taskId: "task-1",
            note: "Original",
            durationMs: 60 * 60 * 1000,
          },
        },
      ],
    });

    const duplicated = duplicateTimesheetEntry(
      state,
      "entry-1",
      {
        localDate: "2026-07-31",
        projectId: "project-1",
        taskId: "task-1",
        note: "Visible edit",
        durationMs: 30 * 60 * 1000,
      },
      factories,
    );

    expect(duplicated.timesheetEntries[1]).toMatchObject({
      _id: "timesheet-1",
      localDate: "2026-07-31",
      workItemId: "work-item-1",
      note: "Visible edit",
      durationMs: 30 * 60 * 1000,
      sourceBlockIds: [],
    });
    expect(duplicated.timesheetEntries[1]).not.toHaveProperty("commit");
    expect(duplicated.workItems[0]).toMatchObject({
      remainingEstimateHours: 1.5,
      completedEstimateHours: 0.5,
    });
  });

  it("preserves the label when duplicating a taskless imported entry", () => {
    const state = createState({
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-07-30",
          projectId: "project-1",
          label: "github.com",
          durationMs: 30 * 60 * 1000,
          sourceBlockIds: ["block-1"],
          committedAt: 10,
        },
      ],
    });

    const duplicated = duplicateTimesheetEntry(
      state,
      "entry-1",
      {
        localDate: "2026-07-31",
        projectId: "project-1",
        taskId: undefined,
        durationMs: 30 * 60 * 1000,
      },
      factories,
    );

    expect(duplicated.timesheetEntries[1]).toMatchObject({
      label: "github.com",
      sourceBlockIds: [],
    });
  });

  it("moves an entry without changing logged estimates and keeps its committed copy", () => {
    const entry = {
      _id: "entry-1",
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      label: "Feature work",
      note: "Original",
      durationMs: 60 * 60 * 1000,
      sourceBlockIds: ["block-1"],
      committedAt: 10,
      commit: {
        at: 20,
        localDate: "2026-07-30",
        projectId: "project-1",
        taskId: "task-1",
        note: "Original",
        durationMs: 60 * 60 * 1000,
      },
    };
    const baseline = createState();
    const state = createState({
      timesheetEntries: [entry],
      workItems: baseline.workItems.map((workItem) => ({
        ...workItem,
        remainingEstimateHours: 1,
        completedEstimateHours: 1,
      })),
    });

    const moved = moveTimesheetEntry(
      state,
      "entry-1",
      {
        localDate: "2026-07-31",
        projectId: "project-1",
        taskId: "task-1",
        note: "Original",
        durationMs: 60 * 60 * 1000,
      },
      { ...factories, now: () => 300 },
    );

    expect(moved.timesheetEntries[0]).toMatchObject({
      _id: "entry-1",
      localDate: "2026-07-31",
      sourceBlockIds: ["block-1"],
      committedAt: 300,
      commit: { localDate: "2026-07-30" },
    });
    expect(moved.workItems).toEqual(state.workItems);
  });

  it("reorders one day by exchanging committed-time slots", () => {
    const state = createState({
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-07-30",
          label: "First",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 300,
        },
        {
          _id: "other-day",
          localDate: "2026-07-29",
          label: "Other",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 250,
        },
        {
          _id: "entry-2",
          localDate: "2026-07-30",
          label: "Second",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 200,
        },
      ],
    });

    // The day shows entry-2 (200) then entry-1 (300); putting entry-1 first
    // gives it the earlier timestamp.
    const reordered = reorderTimesheetEntries(state, "2026-07-30", [
      "entry-1",
      "entry-2",
    ]);

    expect(
      reordered.timesheetEntries.map(({ _id, committedAt }) => ({
        _id,
        committedAt,
      })),
    ).toEqual([
      { _id: "entry-1", committedAt: 200 },
      { _id: "other-day", committedAt: 250 },
      { _id: "entry-2", committedAt: 300 },
    ]);
  });

  it("rejects an incomplete entry order", () => {
    const state = createState({
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-07-30",
          label: "First",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 300,
        },
      ],
    });

    expect(
      reorderTimesheetEntries(state, "2026-07-30", ["entry-1", "missing"]),
    ).toBe(state);
  });

  it("reorders entries that share the same committed timestamp", () => {
    const state = createState({
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-07-30",
          label: "First",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 300,
        },
        {
          _id: "entry-2",
          localDate: "2026-07-30",
          label: "Second",
          durationMs: 100,
          sourceBlockIds: [],
          committedAt: 300,
        },
      ],
    });

    const reordered = reorderTimesheetEntries(state, "2026-07-30", [
      "entry-2",
      "entry-1",
    ]);

    expect(reordered.timesheetEntries.map((entry) => entry._id)).toEqual([
      "entry-2",
      "entry-1",
    ]);
  });
});

describe("Move up and Move down on time entries", () => {
  function savedEntry(_id: string, localDate: string, committedAt: number) {
    return {
      _id,
      localDate,
      label: "",
      durationMs: 60_000,
      sourceBlockIds: [],
      committedAt,
    };
  }

  const entries = [
    savedEntry("second", "2026-07-30", 200),
    savedEntry("third", "2026-07-30", 300),
    savedEntry("other-day", "2026-07-29", 900),
    savedEntry("first", "2026-07-30", 100),
  ];

  it("steps through the day's order as the Day list shows it, oldest first", () => {
    expect(selectSortableDayEntryIds(entries, "2026-07-30")).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("persists Move down like a drag, by trading committed timestamps", () => {
    const state = createState({ timesheetEntries: entries });
    const next = getSharedTableStepOrder(
      selectSortableDayEntryIds(state.timesheetEntries, "2026-07-30"),
      "first",
      1,
    );

    const reordered = reorderTimesheetEntries(state, "2026-07-30", next!.order);

    expect(
      selectSortableDayEntryIds(reordered.timesheetEntries, "2026-07-30"),
    ).toEqual(["second", "first", "third"]);
  });
});

describe("placeRunningRow", () => {
  const entries = [{ _id: "first" }, { _id: "second" }, { _id: "third" }];
  const ids = (rows: { _id: string }[]) => rows.map((row) => row._id);

  it("puts a resumed entry's running row in that entry's place", () => {
    expect(
      ids(
        placeRunningRow(entries, {
          row: { _id: "running" },
          resumedEntryId: "first",
        }),
      ),
    ).toEqual(["running", "second", "third"]);
  });

  it("puts a new running entry last", () => {
    expect(ids(placeRunningRow(entries, { row: { _id: "running" } }))).toEqual([
      "first",
      "second",
      "third",
      "running",
    ]);
  });

  it("puts the running row last when its resumed entry is not listed", () => {
    expect(
      ids(
        placeRunningRow(entries, {
          row: { _id: "running" },
          resumedEntryId: "on-another-day",
        }),
      ),
    ).toEqual(["first", "second", "third", "running"]);
  });

  it("lists the entries alone without a running entry", () => {
    expect(ids(placeRunningRow(entries, null))).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("selectMostRecentTimesheetEntry", () => {
  function savedEntry(_id: string, localDate: string, committedAt: number) {
    return {
      _id,
      localDate,
      label: "",
      durationMs: 60_000,
      sourceBlockIds: [],
      committedAt,
    };
  }

  it("picks the last entry of the latest day up to today", () => {
    const entries = [
      savedEntry("monday-last", "2026-10-05", 50),
      savedEntry("tuesday-first", "2026-10-06", 10),
      savedEntry("tuesday-last", "2026-10-06", 20),
      savedEntry("next-week", "2026-10-13", 99),
    ];

    expect(selectMostRecentTimesheetEntry(entries, "2026-10-11")?._id).toBe(
      "tuesday-last",
    );
  });

  it("picks the entry the Day view shows last when timestamps tie", () => {
    const entries = [
      savedEntry("imported-a", "2026-10-06", 20),
      savedEntry("imported-b", "2026-10-06", 20),
    ];

    expect(selectSortableDayEntryIds(entries, "2026-10-06").at(-1)).toBe(
      "imported-b",
    );
    expect(selectMostRecentTimesheetEntry(entries, "2026-10-11")?._id).toBe(
      "imported-b",
    );
  });

  it("skips the running entry and returns nothing without entries", () => {
    const entries = [
      savedEntry("older", "2026-10-05", 10),
      savedEntry("running", "2026-10-06", 20),
    ];

    expect(
      selectMostRecentTimesheetEntry(entries, "2026-10-11", "running")?._id,
    ).toBe("older");
    expect(selectMostRecentTimesheetEntry([], "2026-10-11")).toBeUndefined();
  });
});

describe("tombstones", () => {
  const HOUR = 60 * 60 * 1000;
  const committedEntry: LocalTimesheetEntry = {
    _id: "entry-1",
    localDate: "2026-07-30",
    projectId: "project-1",
    taskId: "task-1",
    label: "Feature work",
    note: "Shipped",
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt: 10,
    commit: {
      at: 50,
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      note: "Shipped",
      durationMs: HOUR,
    },
  };

  it("leaves a tombstone with the committed copy when a committed entry is deleted", () => {
    const next = deleteTimesheetEntry(
      createState({ timesheetEntries: [committedEntry] }),
      "entry-1",
    );

    expect(next.timesheetEntries).toEqual([]);
    expect(next.timesheetTombstones).toEqual([
      { entryId: "entry-1", commit: committedEntry.commit },
    ]);
  });

  it("leaves no tombstone for an entry never committed", () => {
    const neverCommitted: LocalTimesheetEntry = {
      ...committedEntry,
      commit: undefined,
    };
    const next = deleteTimesheetEntry(
      createState({ timesheetEntries: [neverCommitted] }),
      "entry-1",
    );

    expect(next.timesheetEntries).toEqual([]);
    expect(next.timesheetTombstones).toEqual([]);
  });
});

describe("committed copies", () => {
  const HOUR = 60 * 60 * 1000;
  const values = {
    localDate: "2026-07-30",
    projectId: "project-1",
    taskId: "task-1",
    note: "API",
    durationMs: HOUR,
  };

  /** Two saved entries, "a" and "b", never committed. */
  function savedEntries(): LocalAppState {
    const withA = saveManualTimesheetEntry(createState(), values, {
      createId: () => "a",
      now: () => 100,
    });
    return saveManualTimesheetEntry(withA, values, {
      createId: () => "b",
      now: () => 100,
    });
  }

  function find(state: LocalAppState, entryId: string) {
    return state.timesheetEntries.find((item) => item._id === entryId)!;
  }

  function changeOf(state: LocalAppState, entryId: string) {
    return getTimesheetEntryChange(find(state, entryId))?.kind;
  }

  it("commits only the listed changes", () => {
    const next = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );

    expect(find(next, "a").commit).toEqual({ at: 500, ...values });
    expect(changeOf(next, "a")).toBeUndefined();
    expect(changeOf(next, "b")).toBe("added");
  });

  it("clears a listed tombstone and keeps the unlisted ones", () => {
    const commit = { at: 50, ...values };
    const state = createState({
      timesheetTombstones: [
        { entryId: "gone-1", commit },
        { entryId: "gone-2", commit },
      ],
    });

    expect(
      markTimesheetEntriesCommitted(state, ["gone-1"], () => 500)
        .timesheetTombstones,
    ).toEqual([{ entryId: "gone-2", commit }]);
  });

  it("returns the same state when no listed id has a change", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );

    expect(
      markTimesheetEntriesCommitted(committed, ["a", "unknown"], () => 600),
    ).toBe(committed);
  });

  it("keeps the copy across an edit, and an edit back shows no change", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );
    const edit = (state: LocalAppState, durationMs: number, note: string) =>
      updateTimesheetEntry(
        state,
        "a",
        { projectId: "project-1", taskId: "task-1", note, durationMs },
        factories,
      );

    const edited = edit(committed, 2 * HOUR, "API v2");
    expect(find(edited, "a").commit).toEqual({ at: 500, ...values });
    expect(changeOf(edited, "a")).toBe("updated");

    expect(changeOf(edit(edited, HOUR, "API"), "a")).toBeUndefined();
  });

  it("keeps the copy when the entry moves to another week", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );
    const moved = moveTimesheetEntry(
      committed,
      "a",
      { ...values, localDate: "2026-08-04" },
      factories,
    );

    expect(find(moved, "a")).toMatchObject({
      localDate: "2026-08-04",
      commit: { localDate: "2026-07-30" },
    });
    expect(changeOf(moved, "a")).toBe("updated");
  });

  it("gives a duplicate no copy, so it shows as added", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );
    const duplicated = duplicateTimesheetEntry(committed, "a", values, {
      createId: () => "copy",
      now: () => 600,
    });

    expect(changeOf(duplicated, "copy")).toBe("added");
  });

  it("marks a committed entry as not committed, so it shows as updated", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a", "b"],
      () => 500,
    );

    const next = markTimesheetEntryNotCommitted(committed, "a");

    expect(find(next, "a").commit).toEqual({ at: 500, ...values, stale: true });
    expect(changeOf(next, "a")).toBe("updated");
    expect(changeOf(next, "b")).toBeUndefined();
  });

  it("keeps the copy of an entry marked as not committed for a delete and a new commit", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a", "b"],
      () => 500,
    );
    const notCommitted = markTimesheetEntriesNotCommitted(committed, [
      "a",
      "b",
    ]);

    // A delete still leaves a tombstone, so the external entry goes too.
    expect(deleteTimesheetEntry(notCommitted, "a").timesheetTombstones).toEqual(
      [{ entryId: "a", commit: { at: 500, ...values, stale: true } }],
    );
    // Committing again saves a fresh copy without the flag.
    const recommitted = markTimesheetEntriesCommitted(
      notCommitted,
      ["b"],
      () => 600,
    );
    expect(find(recommitted, "b").commit).toEqual({ at: 600, ...values });
  });

  it("leaves an entry with a change to commit as it is", () => {
    const committed = markTimesheetEntriesCommitted(
      savedEntries(),
      ["a"],
      () => 500,
    );
    // Its committed day finds the external entry, so the copy stays.
    const moved = moveTimesheetEntry(
      committed,
      "a",
      { ...values, localDate: "2026-08-04" },
      factories,
    );

    expect(markTimesheetEntryNotCommitted(moved, "a")).toBe(moved);
    expect(markTimesheetEntryNotCommitted(moved, "b")).toBe(moved);
    expect(markTimesheetEntryNotCommitted(moved, "unknown")).toBe(moved);
  });
});

describe("pasteTimesheetEntries", () => {
  const HOUR = 60 * 60 * 1000;
  function entry(id: string, localDate: string, committedAt: number) {
    return {
      _id: id,
      localDate,
      workItemId: "work-item-1",
      projectId: "project-1",
      taskId: "task-1",
      label: "Feature work",
      note: id,
      durationMs: HOUR,
      sourceBlockIds: [],
      committedAt,
    };
  }
  let nextId = 0;
  const pasteFactories = {
    createId: () => `copy-${++nextId}`,
    now: () => 500,
  };

  it("copies several entries to their days in one change", () => {
    nextId = 0;
    const state = createState({
      timesheetEntries: [
        entry("monday", "2026-10-05", 10),
        entry("tuesday", "2026-10-06", 20),
      ],
    });

    const pasted = pasteTimesheetEntries(
      state,
      [
        { entryId: "monday", localDate: "2026-10-12" },
        { entryId: "tuesday", localDate: "2026-10-13" },
      ],
      "copy",
      pasteFactories,
    );

    expect(pasted.timesheetEntries.slice(2)).toMatchObject([
      { _id: "copy-1", localDate: "2026-10-12", note: "monday" },
      { _id: "copy-2", localDate: "2026-10-13", note: "tuesday" },
    ]);
    // The originals stay, and each copy logs its hour on the work item.
    expect(pasted.timesheetEntries.slice(0, 2)).toEqual(state.timesheetEntries);
    expect(pasted.workItems[0]).toMatchObject({ completedEstimateHours: 2 });
  });

  it("moves cut entries and keeps their pasted order oldest first", () => {
    const state = createState({
      timesheetEntries: [
        entry("first", "2026-10-05", 10),
        entry("second", "2026-10-05", 20),
      ],
      // The two hours the entries already logged.
      workItems: createState().workItems.map((workItem) => ({
        ...workItem,
        completedEstimateHours: 2,
      })),
    });

    // Pasted in reading order: "first" was shown above "second".
    const pasted = pasteTimesheetEntries(
      state,
      [
        { entryId: "first", localDate: "2026-10-07" },
        { entryId: "second", localDate: "2026-10-07" },
      ],
      "cut",
      { createId: () => "unused", now: () => 500 },
    );

    expect(pasted.timesheetEntries).toMatchObject([
      { _id: "first", localDate: "2026-10-07", committedAt: 500 },
      { _id: "second", localDate: "2026-10-07", committedAt: 501 },
    ]);
    expect(pasted.workItems).toEqual(state.workItems);
  });

  it("skips entries that are gone or linked to the running timer", () => {
    const state = createState({
      timesheetEntries: [entry("running", "2026-10-05", 10)],
      timers: [
        {
          _id: "timer-1",
          startedAt: 1,
          localDate: "2026-10-05",
          projectId: "project-1",
          taskId: "task-1",
          accumulatedDurationMs: HOUR,
          entryId: "running",
        },
      ],
    });

    const pasted = pasteTimesheetEntries(
      state,
      [
        { entryId: "running", localDate: "2026-10-06" },
        { entryId: "deleted", localDate: "2026-10-06" },
      ],
      "cut",
      pasteFactories,
    );

    expect(pasted).toBe(state);
  });
});

describe("relocateTimesheetEntries", () => {
  const HOUR = 60 * 60 * 1000;
  function entry(id: string, localDate: string, committedAt: number) {
    return {
      _id: id,
      localDate,
      projectId: "project-1",
      taskId: "task-1",
      label: "Feature work",
      note: id,
      durationMs: HOUR,
      sourceBlockIds: [],
      committedAt,
    };
  }
  const runningTimer = {
    _id: "timer-1",
    startedAt: 1,
    localDate: "2026-10-05",
    projectId: "project-1",
    taskId: "task-1",
    accumulatedDurationMs: HOUR,
    entryId: "running",
  };

  it("reports the copies, in the order of the entries, skipping the running entry", () => {
    let nextId = 0;
    const state = createState({
      timesheetEntries: [
        entry("monday", "2026-10-05", 10),
        entry("running", "2026-10-05", 20),
        entry("tuesday", "2026-10-06", 30),
      ],
      timers: [runningTimer],
    });

    const { state: next, entryIds } = relocateTimesheetEntries(
      state,
      [
        { entryId: "monday", localDate: "2026-10-05" },
        { entryId: "running", localDate: "2026-10-05" },
        { entryId: "tuesday", localDate: "2026-10-06" },
      ],
      "copy",
      { createId: () => `copy-${++nextId}`, now: () => 500 },
    );

    expect(entryIds).toEqual(["copy-1", "copy-2"]);
    // Each copy lands at the end of its own day, in the order of the entries.
    expect(next.timesheetEntries.slice(3)).toMatchObject([
      {
        _id: "copy-1",
        localDate: "2026-10-05",
        note: "monday",
        committedAt: 500,
      },
      {
        _id: "copy-2",
        localDate: "2026-10-06",
        note: "tuesday",
        committedAt: 502,
      },
    ]);
  });

  it("reports the moved entries for a cut, and nothing for gone entries", () => {
    const state = createState({
      timesheetEntries: [
        entry("first", "2026-10-05", 10),
        entry("second", "2026-10-06", 20),
      ],
    });

    const { state: next, entryIds } = relocateTimesheetEntries(
      state,
      [
        { entryId: "first", localDate: "2026-10-08" },
        { entryId: "gone", localDate: "2026-10-08" },
        { entryId: "second", localDate: "2026-10-08" },
      ],
      "cut",
      { createId: () => "unused", now: () => 500 },
    );

    expect(entryIds).toEqual(["first", "second"]);
    expect(next.timesheetEntries).toMatchObject([
      { _id: "first", localDate: "2026-10-08", committedAt: 500 },
      { _id: "second", localDate: "2026-10-08", committedAt: 502 },
    ]);
  });

  it("returns the same state and no entries when nothing could move", () => {
    const state = createState({
      timesheetEntries: [entry("running", "2026-10-05", 10)],
      timers: [runningTimer],
    });

    const result = relocateTimesheetEntries(
      state,
      [{ entryId: "running", localDate: "2026-10-06" }],
      "cut",
      { createId: () => "unused", now: () => 500 },
    );

    expect(result.state).toBe(state);
    expect(result.entryIds).toEqual([]);
  });
});
