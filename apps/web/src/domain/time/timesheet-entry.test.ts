import { describe, expect, it } from "vitest";
import type { LocalAppState } from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  createTimesheetEntrySubmissionFingerprint,
  deleteTimesheetEntry,
  markTimesheetEntriesSubmitted,
  normalizeTimesheetEntry,
  reorderTimesheetEntries,
  saveManualTimesheetEntry,
  updateTimesheetEntry,
} from "@/domain/time/timesheet-entry";

function createState(
  overrides: Partial<LocalAppState> = {},
): LocalAppState {
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
    backlogStatuses: [],
    backlogStatusMappings: [],
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
      submittedFingerprint:
        createTimesheetEntrySubmissionFingerprint(
          submitted.timesheetEntries[0]!,
        ),
    });
    expect(changed.timesheetEntries[0]).toMatchObject({
      submittedAt: undefined,
      submittedFingerprint: undefined,
    });
    expect(unchanged.timesheetEntries[0]?.committedAt).toBe(100);
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

  it("deletes an entry, detaches its timer, and reverses logged estimates", () => {
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
    const deleted = deleteTimesheetEntry(
      {
        ...saved,
        timers: [
          {
            _id: "timer-1",
            startedAt: 1,
            localDate: "2026-07-30",
            projectId: "project-1",
            taskId: "task-1",
            accumulatedDurationMs: 0,
            entryId: "timesheet-1",
          },
        ],
      },
      "timesheet-1",
    );

    expect(deleted.timesheetEntries).toEqual([]);
    expect(deleted.timers[0]?.entryId).toBeUndefined();
    expect(deleted.workItems[0]).toMatchObject({
      remainingEstimateHours: 2,
      completedEstimateHours: 0,
    });
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
      reorderTimesheetEntries(state, "2026-07-30", [
        "entry-1",
        "missing",
      ]),
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
