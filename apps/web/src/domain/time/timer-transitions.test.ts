import { describe, expect, it } from "vitest";
import type {
  LocalAppState,
  LocalProject,
  LocalTimer,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import {
  normalizeTimer,
  cancelTimer,
  continueTimesheetEntry,
  editRunningEntry,
  saveTimer,
  startTimer,
  type TimerFactories,
} from "@/domain/time/timer-transitions";

const TODAY = "2026-07-30";

function createFactories(now = 1_000): TimerFactories {
  let nextId = 1;

  return {
    createId: (prefix) => `${prefix}-${nextId++}`,
    now: () => now,
  };
}

function createProject(): LocalProject {
  return {
    _id: "project-1",
    name: "Mercury",
    displayName: "Mercury",
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [
      {
        _id: "task-1",
        name: "Build",
        status: "active",
        createdAt: 100,
      },
    ],
  };
}

function createEntry(overrides: Partial<LocalTimesheetEntry> = {}) {
  return {
    _id: "entry-1",
    localDate: "2026-07-30",
    projectId: "project-1",
    taskId: "task-1",
    label: "Build",
    note: "Existing work",
    durationMs: 500,
    sourceBlockIds: [],
    committedAt: 600,
    ...overrides,
  } satisfies LocalTimesheetEntry;
}

function createState(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    projects: [createProject()],
    timers: [],
    timesheetEntries: [],
    workItems: [],
    ...overrides,
  } as LocalAppState;
}

function createRunningTimer(overrides: Partial<LocalTimer> = {}): LocalTimer {
  return {
    _id: "timer-1",
    startedAt: 700,
    localDate: TODAY,
    projectId: "project-1",
    taskId: "task-1",
    note: "Running work",
    accumulatedDurationMs: 200,
    ...overrides,
  };
}

describe("timer hydration", () => {
  it("hydrates legacy labels, dates, and accumulated duration", () => {
    const timer = normalizeTimer({
      _id: "timer-1",
      startedAt: Date.UTC(2026, 6, 30, 12),
      label: "Legacy note",
    } as Partial<LocalTimer> & {
      _id: string;
      startedAt: number;
      label: string;
    });

    expect(timer).toMatchObject({
      localDate: "2026-07-30",
      note: "Legacy note",
      accumulatedDurationMs: 0,
    });
  });
});

describe("starting a running entry", () => {
  it("starts on today with no counted time when Hours is empty", () => {
    const started = startTimer(
      createState(),
      { projectId: "project-1", taskId: "task-1", note: "Build" },
      TODAY,
      createFactories(),
    );

    expect(started.timers).toEqual([
      expect.objectContaining({
        _id: "timer-1",
        startedAt: 1_000,
        localDate: TODAY,
        projectId: "project-1",
        note: "Build",
        accumulatedDurationMs: 0,
      }),
    ]);
    expect(started.timesheetEntries).toEqual([]);
  });

  it("counts on from typed Hours", () => {
    const halfHourMs = 30 * 60_000;
    const started = startTimer(
      createState(),
      { accumulatedDurationMs: halfHourMs },
      TODAY,
      createFactories(1_000),
    );
    const saved = saveTimer(started, "timer-1", createFactories(61_000));

    expect(saved.timesheetEntries[0]).toMatchObject({
      localDate: TODAY,
      durationMs: halfHourMs + 60_000,
    });
  });

  it("saves the running entry and switches at one boundary", () => {
    let clockCalls = 0;
    const factories: TimerFactories = {
      createId: (prefix) => `${prefix}-switched`,
      now: () => 1_000 + clockCalls++ * 100,
    };
    const switched = startTimer(
      createState({ timers: [createRunningTimer({ _id: "active-timer" })] }),
      { note: "Fresh entry" },
      TODAY,
      factories,
    );

    expect(switched.timesheetEntries).toEqual([
      expect.objectContaining({
        _id: "timesheet-switched",
        localDate: TODAY,
        note: "Running work",
        durationMs: 500,
      }),
    ]);
    expect(switched.timers).toEqual([
      expect.objectContaining({
        _id: "timer-switched",
        startedAt: 1_000,
        localDate: TODAY,
        note: "Fresh entry",
      }),
    ]);
    expect(clockCalls).toBe(1);
  });

  it("keeps a running entry that started yesterday on yesterday when switching", () => {
    const switched = startTimer(
      createState({
        timers: [createRunningTimer({ localDate: "2026-07-29" })],
      }),
      {},
      TODAY,
      createFactories(),
    );

    expect(switched.timesheetEntries[0]?.localDate).toBe("2026-07-29");
    expect(switched.timers[0]?.localDate).toBe(TODAY);
  });
});

describe("editing the running entry", () => {
  it("saves the form and keeps counting without touching the count", () => {
    const state = createState({ timers: [createRunningTimer()] });

    const edited = editRunningEntry(
      state,
      "timer-1",
      { projectId: "project-1", note: "Renamed" },
      { now: () => 5_000 },
    );

    expect(edited.timers).toEqual([
      {
        ...createRunningTimer(),
        taskId: undefined,
        note: "Renamed",
      },
    ]);
  });

  it("counts on from corrected counted time", () => {
    const state = createState({ timers: [createRunningTimer()] });

    const edited = editRunningEntry(
      state,
      "timer-1",
      { projectId: "project-1", taskId: "task-1", countedDurationMs: 3_000 },
      { now: () => 5_000 },
    );
    const saved = saveTimer(edited, "timer-1", createFactories(6_000));

    expect(edited.timers[0]).toMatchObject({
      startedAt: 5_000,
      accumulatedDurationMs: 3_000,
    });
    expect(saved.timesheetEntries[0]?.durationMs).toBe(4_000);
  });

  it("leaves the resumed entry's saved time alone until Stop", () => {
    const entry = createEntry({ durationMs: 500 });
    const state = createState({
      timesheetEntries: [entry],
      timers: [createRunningTimer({ entryId: entry._id })],
    });

    const edited = editRunningEntry(
      state,
      "timer-1",
      { countedDurationMs: 2_000 },
      { now: () => 5_000 },
    );

    expect(edited.timesheetEntries).toEqual([entry]);
  });

  it("rejects negative counted time and unknown running entries", () => {
    const state = createState({ timers: [createRunningTimer()] });
    const factories = { now: () => 5_000 };

    expect(
      editRunningEntry(state, "timer-1", { countedDurationMs: -1 }, factories),
    ).toBe(state);
    expect(editRunningEntry(state, "missing", {}, factories)).toBe(state);
  });
});

describe("timer and timesheet entry lifecycle", () => {
  it("saves elapsed time as a new entry and removes the timer", () => {
    const state = createState({
      timers: [
        {
          _id: "timer-1",
          startedAt: 700,
          localDate: "2026-07-30",
          projectId: "project-1",
          taskId: "task-1",
          note: "Build",
          accumulatedDurationMs: 200,
        },
      ],
    });

    const saved = saveTimer(state, "timer-1", createFactories());

    expect(saved.timers).toEqual([]);
    expect(saved.timesheetEntries[0]).toMatchObject({
      _id: "timesheet-1",
      label: "Build",
      durationMs: 500,
      committedAt: 1_000,
    });
  });

  it("keeps a committed entry when its resumed timer is cancelled at zero", () => {
    const commit = {
      at: 650,
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      note: "Existing work",
      durationMs: 0,
    };
    const committedEntry = createEntry({ durationMs: 0, commit });
    const state = createState({
      timesheetEntries: [committedEntry],
      timers: [createRunningTimer({ entryId: committedEntry._id })],
    });

    const cancelled = cancelTimer(state, "timer-1");

    expect(cancelled.timers).toEqual([]);
    expect(cancelled.timesheetEntries).toEqual([committedEntry]);
  });

  it("removes an uncommitted provisional entry when its timer is cancelled", () => {
    const provisional = createEntry({ durationMs: 0 });
    const state = createState({
      timesheetEntries: [provisional],
      timers: [createRunningTimer({ entryId: provisional._id })],
    });

    expect(cancelTimer(state, "timer-1").timesheetEntries).toEqual([]);
  });

  it("keeps the resumed entry's committed copy, so the added time shows as a change", () => {
    const commit = {
      at: 650,
      localDate: "2026-07-30",
      projectId: "project-1",
      taskId: "task-1",
      note: "Existing work",
      durationMs: 500,
    };
    const originalEntry = createEntry({ commit });
    const state = createState({
      timesheetEntries: [originalEntry],
      timers: [
        {
          _id: "timer-1",
          startedAt: 900,
          localDate: originalEntry.localDate,
          projectId: originalEntry.projectId,
          taskId: originalEntry.taskId,
          note: originalEntry.note,
          accumulatedDurationMs: originalEntry.durationMs,
          entryId: originalEntry._id,
        },
      ],
    });

    const saved = saveTimer(state, "timer-1", createFactories());

    expect(saved.timesheetEntries[0]).toMatchObject({
      durationMs: 600,
      commit,
    });
  });

  it("replaces a restarted entry and keeps its source blocks", () => {
    const originalEntry = createEntry({ sourceBlockIds: ["browser:1"] });
    const state = createState({
      timesheetEntries: [originalEntry],
      timers: [
        {
          _id: "timer-1",
          startedAt: 900,
          localDate: originalEntry.localDate,
          projectId: originalEntry.projectId,
          taskId: originalEntry.taskId,
          note: originalEntry.note,
          accumulatedDurationMs: originalEntry.durationMs,
          entryId: originalEntry._id,
        },
      ],
    });

    const saved = saveTimer(state, "timer-1", createFactories());

    expect(saved.timesheetEntries).toHaveLength(1);
    expect(saved.timesheetEntries[0]).toMatchObject({
      _id: originalEntry._id,
      durationMs: 600,
      sourceBlockIds: ["browser:1"],
    });
  });

  it("creates a replacement entry when a timer points to a missing entry", () => {
    const state = createState({
      timers: [
        {
          _id: "timer-1",
          startedAt: 900,
          localDate: "2026-07-30",
          accumulatedDurationMs: 100,
          entryId: "missing-entry",
        },
      ],
    });

    const saved = saveTimer(state, "timer-1", createFactories());

    expect(saved.timesheetEntries).toEqual([
      expect.objectContaining({
        _id: "missing-entry",
        durationMs: 200,
      }),
    ]);
  });

  it("saves the active timer and continues the selected entry at one boundary", () => {
    const activeEntry = createEntry();
    const selectedEntry = createEntry({
      _id: "entry-2",
      note: "Selected work",
      durationMs: 1_200,
    });
    let clockCalls = 0;
    const factories: TimerFactories = {
      createId: (prefix) => `${prefix}-switched`,
      now: () => 1_000 + clockCalls++ * 100,
    };
    const restarted = continueTimesheetEntry(
      createState({
        timesheetEntries: [activeEntry, selectedEntry],
        timers: [
          {
            _id: "old-timer",
            startedAt: 700,
            localDate: activeEntry.localDate,
            projectId: activeEntry.projectId,
            taskId: activeEntry.taskId,
            note: activeEntry.note,
            accumulatedDurationMs: activeEntry.durationMs,
            entryId: activeEntry._id,
          },
        ],
      }),
      selectedEntry._id,
      "2026-07-30",
      factories,
    );

    expect(restarted.timers).toEqual([
      expect.objectContaining({
        _id: "timer-switched",
        startedAt: 1_000,
        entryId: selectedEntry._id,
        accumulatedDurationMs: selectedEntry.durationMs,
      }),
    ]);
    expect(restarted.timesheetEntries).toEqual([
      expect.objectContaining({
        _id: activeEntry._id,
        durationMs: 800,
        committedAt: activeEntry.committedAt,
      }),
      selectedEntry,
    ]);
    expect(clockCalls).toBe(1);
  });

  it("keeps the active timer running when the selected entry is unknown", () => {
    const state = createState({
      timers: [
        {
          _id: "old-timer",
          startedAt: 700,
          localDate: "2026-07-30",
          accumulatedDurationMs: 500,
        },
      ],
    });

    expect(
      continueTimesheetEntry(state, "missing", "2026-07-30", createFactories()),
    ).toBe(state);
  });

  it("preserves malformed multiple-timer state instead of losing tracked time", () => {
    const selectedEntry = createEntry({ _id: "entry-selected" });
    const state = createState({
      timesheetEntries: [selectedEntry],
      timers: [
        {
          _id: "timer-first",
          startedAt: 700,
          localDate: "2026-07-30",
          accumulatedDurationMs: 500,
        },
        {
          _id: "timer-second",
          startedAt: 800,
          localDate: "2026-07-30",
          accumulatedDurationMs: 300,
        },
      ],
    });
    let clockCalls = 0;
    let idCalls = 0;
    const factories: TimerFactories = {
      createId: (prefix) => {
        idCalls += 1;
        return `${prefix}-unexpected`;
      },
      now: () => {
        clockCalls += 1;
        return 1_000;
      },
    };

    expect(
      continueTimesheetEntry(state, selectedEntry._id, "2026-07-30", factories),
    ).toBe(state);
    expect(state.timers).toHaveLength(2);
    expect(clockCalls).toBe(0);
    expect(idCalls).toBe(0);
  });

  it("resumes today's entry when no timer is active", () => {
    const entry = createEntry();
    const restarted = continueTimesheetEntry(
      createState({ timesheetEntries: [entry] }),
      entry._id,
      "2026-07-30",
      createFactories(),
    );

    expect(restarted.timers[0]).toMatchObject({
      entryId: entry._id,
      accumulatedDurationMs: entry.durationMs,
    });
  });

  it("continues another day's entry as a new running entry today", () => {
    const entry = createEntry({ note: "Checkout refactor" });
    const continued = continueTimesheetEntry(
      createState({ timesheetEntries: [entry] }),
      entry._id,
      "2026-08-03",
      createFactories(),
    );

    expect(continued.timers[0]).toMatchObject({
      localDate: "2026-08-03",
      projectId: entry.projectId,
      taskId: entry.taskId,
      note: "Checkout refactor",
      accumulatedDurationMs: 0,
    });
    expect(continued.timers[0]?.entryId).not.toBe(entry._id);
    expect(
      continued.timesheetEntries.find((item) => item._id === entry._id),
    ).toEqual(entry);
  });

  it("leaves state unchanged when saving or continuing an unknown record", () => {
    const state = createState();
    const factories = createFactories();

    expect(saveTimer(state, "missing", factories)).toBe(state);
    expect(
      continueTimesheetEntry(state, "missing", "2026-07-30", factories),
    ).toBe(state);
  });
});
