import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalTimesheetEntry } from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  createTimesheetEntrySubmissionFingerprint,
  deleteTimesheetEntries,
  deleteTimesheetEntry,
  duplicateTimesheetEntry,
  markTimesheetEntriesCommitted,
  markTimesheetEntriesNotSubmitted,
  markTimesheetEntriesSubmitted,
  moveTimesheetEntry,
  normalizeTimesheetEntry,
  reorderTimesheetEntries,
  saveManualTimesheetEntry,
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
      submittedAt: undefined,
      submittedFingerprint: undefined,
    });
    expect(state.workItems[0]).toMatchObject({
      remainingEstimateHours: 1,
      completedEstimateHours: 1,
    });
  });

  it("preserves submission for an unchanged edit and clears it after a change", () => {
    const saved = saveManualTimesheetEntry(
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
    const submitted = markTimesheetEntriesSubmitted(
      saved,
      ["timesheet-1"],
      () => 200,
    );
    const unchanged = updateTimesheetEntry(
      submitted,
      "timesheet-1",
      {
        projectId: "project-1",
        taskId: "task-1",
        note: "Implementation",
        durationMs: 60 * 60 * 1000,
      },
      { ...factories, now: () => 300 },
    );
    const changed = updateTimesheetEntry(
      unchanged,
      "timesheet-1",
      {
        projectId: "project-1",
        taskId: "task-1",
        note: "Changed",
        durationMs: 60 * 60 * 1000,
      },
      { ...factories, now: () => 400 },
    );

    expect(unchanged.timesheetEntries[0]).toMatchObject({
      submittedAt: 200,
      submittedFingerprint: createTimesheetEntrySubmissionFingerprint(
        submitted.timesheetEntries[0]!,
      ),
    });
    expect(changed.timesheetEntries[0]).toMatchObject({
      submittedAt: undefined,
      submittedFingerprint: undefined,
    });
    expect(unchanged.timesheetEntries[0]?.committedAt).toBe(100);
  });

  it("remembers the submission time of an edited entry until it is marked again", () => {
    const saved = saveManualTimesheetEntry(
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
    const submitted = markTimesheetEntriesSubmitted(
      saved,
      ["timesheet-1"],
      () => 200,
    );
    const edit = (state: LocalAppState, note: string) =>
      updateTimesheetEntry(
        state,
        "timesheet-1",
        {
          projectId: "project-1",
          taskId: "task-1",
          note,
          durationMs: 60 * 60 * 1000,
        },
        factories,
      );
    const changed = edit(submitted, "Changed");
    const changedTwice = edit(changed, "Changed again");
    const resubmitted = markTimesheetEntriesSubmitted(
      changedTwice,
      ["timesheet-1"],
      () => 500,
    );

    expect(changed.timesheetEntries[0]).toMatchObject({
      submittedAt: undefined,
      previousSubmittedAt: 200,
    });
    expect(changedTwice.timesheetEntries[0]?.previousSubmittedAt).toBe(200);
    expect(resubmitted.timesheetEntries[0]).toMatchObject({
      submittedAt: 500,
      previousSubmittedAt: undefined,
    });
  });

  it("hydrates legacy source IDs and preserves a zero submission timestamp", () => {
    const entry = normalizeTimesheetEntry({
      _id: "entry-1",
      localDate: "2026-07-30",
      label: "Legacy",
      durationMs: 100,
      committedAt: 1,
      submittedAt: 0,
    } as never);

    expect(entry).toMatchObject({
      sourceBlockIds: [],
      submittedAt: 0,
      submittedFingerprint: expect.any(String),
    });
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

  it("duplicates visible values without copying submission or source provenance", () => {
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
          submittedAt: 20,
          submittedFingerprint: "submitted",
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
      submittedAt: undefined,
      submittedFingerprint: undefined,
    });
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

  it("moves an entry without changing logged estimates and clears submission", () => {
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
      submittedAt: 20,
      submittedFingerprint: "",
    };
    entry.submittedFingerprint =
      createTimesheetEntrySubmissionFingerprint(entry);
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
      submittedAt: undefined,
      submittedFingerprint: undefined,
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

    const reordered = reorderTimesheetEntries(state, "2026-07-30", [
      "entry-2",
      "entry-1",
    ]);

    expect(
      reordered.timesheetEntries.map(({ _id, committedAt }) => ({
        _id,
        committedAt,
      })),
    ).toEqual([
      { _id: "entry-2", committedAt: 300 },
      { _id: "other-day", committedAt: 250 },
      { _id: "entry-1", committedAt: 200 },
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
    savedEntry("middle", "2026-07-30", 200),
    savedEntry("top", "2026-07-30", 300),
    savedEntry("other-day", "2026-07-29", 900),
    savedEntry("bottom", "2026-07-30", 100),
  ];

  it("steps through the day's order as the Day list shows it", () => {
    expect(selectSortableDayEntryIds(entries, "2026-07-30")).toEqual([
      "top",
      "middle",
      "bottom",
    ]);
  });

  it("leaves out the entry the running entry resumed", () => {
    expect(selectSortableDayEntryIds(entries, "2026-07-30", "top")).toEqual([
      "middle",
      "bottom",
    ]);
  });

  it("persists Move down like a drag, by trading committed timestamps", () => {
    const state = createState({ timesheetEntries: entries });
    const next = getSharedTableStepOrder(
      selectSortableDayEntryIds(state.timesheetEntries, "2026-07-30"),
      "top",
      1,
    );

    const reordered = reorderTimesheetEntries(state, "2026-07-30", next!.order);

    expect(
      selectSortableDayEntryIds(reordered.timesheetEntries, "2026-07-30"),
    ).toEqual(["middle", "top", "bottom"]);
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

  it("picks the top entry of the latest day up to today", () => {
    const entries = [
      savedEntry("monday-top", "2026-10-05", 50),
      savedEntry("tuesday-bottom", "2026-10-06", 10),
      savedEntry("tuesday-top", "2026-10-06", 20),
      savedEntry("next-week", "2026-10-13", 99),
    ];

    expect(selectMostRecentTimesheetEntry(entries, "2026-10-11")?._id).toBe(
      "tuesday-top",
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

describe("markTimesheetEntriesNotSubmitted", () => {
  /** Two saved entries, "a" and "b", both on 2026-07-30 for one hour. */
  function savedEntries(): LocalAppState {
    const values = {
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      durationMs: 60 * 60 * 1000,
    };
    const withA = saveManualTimesheetEntry(createState(), values, {
      createId: () => "a",
      now: () => 100,
    });
    return saveManualTimesheetEntry(withA, values, {
      createId: () => "b",
      now: () => 100,
    });
  }

  it("returns submitted entries to saved and keeps their old submission time", () => {
    const state = markTimesheetEntriesSubmitted(
      savedEntries(),
      ["a"],
      () => 200,
    );
    const next = markTimesheetEntriesNotSubmitted(state, ["a", "b"]);

    expect(
      next.timesheetEntries.find((item) => item._id === "a"),
    ).toMatchObject({
      submittedAt: undefined,
      submittedFingerprint: undefined,
      previousSubmittedAt: 200,
    });
    expect(next.timesheetEntries.find((item) => item._id === "b")).toEqual(
      state.timesheetEntries.find((item) => item._id === "b"),
    );
  });

  it("returns the same state when nothing was submitted", () => {
    const state = savedEntries();
    expect(markTimesheetEntriesNotSubmitted(state, ["b"])).toBe(state);
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
});
