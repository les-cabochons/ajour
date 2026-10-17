import { describe, expect, it } from "vitest";
import type {
  LocalAppState,
  LocalTimer,
  LocalTimesheetEntry,
  LocalTimesheetImportDraft,
} from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  acceptCalendarSuggestions,
  type CalendarSuggestion,
} from "@/domain/time/calendar-suggestions";
import {
  assertNoLockedWeekWrite,
  findLockedWeekWrite,
  getDateLockReason,
  getLockedWeek,
  isDateLocked,
  LockedWeekError,
  lockedWeekMessage,
  normalizeLockedWeeks,
} from "@/domain/time/locked-weeks";
import { toCommittedCopy } from "@/domain/time/timesheet-commit";
import {
  deleteTimesheetEntries,
  deleteTimesheetEntry,
  dropTimesheetEntries,
  duplicateTimesheetEntry,
  markTimesheetEntriesNotCommitted,
  moveTimesheetEntry,
  pasteTimesheetEntries,
  reorderTimesheetEntries,
  saveManualTimesheetEntry,
  updateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import { commitTimesheetImportDraft } from "@/domain/time/timesheet-import";
import {
  continueTimesheetEntry,
  saveTimer,
  startTimer,
} from "@/domain/time/timer-transitions";

const submitted = { lockedWeeks: [{ weekOf: "2026-10-05", lockedAt: 50 }] };

describe("isDateLocked", () => {
  it("locks every day from Monday to Sunday of a submitted week", () => {
    for (const day of ["2026-10-05", "2026-10-08", "2026-10-11"]) {
      expect(isDateLocked(submitted, day)).toBe(true);
    }
    expect(isDateLocked(submitted, "2026-10-04")).toBe(false);
    expect(isDateLocked(submitted, "2026-10-12")).toBe(false);
  });

  it("reads a half-typed or impossible date as not locked", () => {
    expect(isDateLocked(submitted, "2026-10-0")).toBe(false);
    expect(isDateLocked(submitted, "2026-02-30")).toBe(false);
  });

  it("names the week and the way out", () => {
    expect(lockedWeekMessage("2026-10-05")).toBe(
      "The week of 2026-10-05 is submitted. Reopen it to change it.",
    );
    expect(getDateLockReason(submitted, "2026-10-11")).toBe(
      "The week of 2026-10-05 is submitted. Reopen it to change it.",
    );
    expect(getDateLockReason(submitted, "2026-10-12")).toBeUndefined();
    expect(getLockedWeek(submitted, "2026-10-09")).toEqual({
      weekOf: "2026-10-05",
      lockedAt: 50,
    });
  });
});

describe("normalizeLockedWeeks", () => {
  it("keeps valid weeks on their Monday, once each, in week order", () => {
    expect(
      normalizeLockedWeeks([
        { weekOf: "2026-10-14", lockedAt: 7 },
        { weekOf: "2026-10-05", lockedAt: 5 },
        { weekOf: "2026-10-12", lockedAt: 9 },
        { weekOf: "2026-02-30", lockedAt: 1 },
        { weekOf: "2026-10-19" },
        "2026-10-26",
        null,
      ]),
    ).toEqual([
      { weekOf: "2026-10-05", lockedAt: 5 },
      { weekOf: "2026-10-12", lockedAt: 7 },
    ]);
  });

  it("reads anything but a list as no submitted week", () => {
    expect(normalizeLockedWeeks(undefined)).toEqual([]);
    expect(normalizeLockedWeeks({})).toEqual([]);
  });
});

const HOUR = 3_600_000;
const LOCKED = "2026-10-05";

/** A committed entry on Acme · Build whose note is its id. */
function committedEntry(
  _id: string,
  localDate: string,
  committedAt = 10,
): LocalTimesheetEntry {
  const entry: LocalTimesheetEntry = {
    _id,
    localDate,
    projectId: "p1",
    taskId: "t1",
    label: "Build",
    note: _id,
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt,
  };
  return { ...entry, commit: toCommittedCopy(entry, 5) };
}

/** The week of 2026-10-05 is submitted with "locked" on Tuesday; "open" is on the next Tuesday. */
function createState(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    user: { _id: "local-user", name: "Local User", email: "local@example.com" },
    projects: [
      {
        _id: "p1",
        name: "Acme",
        color: "#123456",
        icon: DEFAULT_PROJECT_ICON,
        status: "active",
        tasks: [{ _id: "t1", name: "Build", status: "active", createdAt: 1 }],
      },
    ],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [
      committedEntry("locked", "2026-10-06"),
      committedEntry("open", "2026-10-13"),
    ],
    timesheetTombstones: [],
    lockedWeeks: [{ weekOf: LOCKED, lockedAt: 50 }],
    timesheetImportDrafts: [],
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
    userPreferences: {
      themeMode: "system",
      updateTrack: "stable",
      projectDataShapeId: "default",
      weeklyTimeViewStyle: "grid",
      weeklyCapacityTargets: {
        monday: 8 * HOUR,
        tuesday: 8 * HOUR,
        wednesday: 8 * HOUR,
        thursday: 8 * HOUR,
        friday: 8 * HOUR,
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
  createId: (prefix: string) => `${prefix}-new`,
  now: () => 100,
};

/** An entry's own values on `localDate`. */
function valuesOn(localDate: string, note = "locked") {
  return { localDate, projectId: "p1", taskId: "t1", note, durationMs: HOUR };
}

function importDraft(localDate: string): LocalTimesheetImportDraft {
  return {
    _id: "draft-1",
    localDate,
    projectName: "Acme",
    taskName: "Build",
    durationMs: HOUR,
    potentialConflict: false,
    conflictEntryIds: [],
    importedAt: 1,
  };
}

function suggestion(localDate: string): CalendarSuggestion {
  return {
    key: "work:standup",
    pluginId: "ics",
    connectionId: "work",
    connectionLabel: "Work",
    occurrenceKey: "standup",
    localDate,
    startsAt: Date.parse(`${localDate}T09:00:00`),
    endsAt: Date.parse(`${localDate}T09:30:00`),
    durationMs: HOUR / 2,
    title: "Standup",
    untitled: false,
    allDay: false,
  };
}

function runningOn(localDate: string): LocalTimer {
  return {
    _id: "timer-1",
    startedAt: 0,
    localDate,
    projectId: "p1",
    taskId: "t1",
    accumulatedDurationMs: 0,
  };
}

type Write = [string, LocalAppState, (state: LocalAppState) => LocalAppState];

describe("the write check", () => {
  const refused: Write[] = [
    [
      "create an entry on a locked day",
      createState(),
      (s) =>
        saveManualTimesheetEntry(
          s,
          { localDate: "2026-10-07", projectId: "p1", durationMs: HOUR },
          factories,
        ),
    ],
    [
      "edit a locked entry",
      createState(),
      (s) =>
        updateTimesheetEntry(
          s,
          "locked",
          { projectId: "p1", taskId: "t1", note: "Changed", durationMs: HOUR },
          factories,
        ),
    ],
    [
      "move a locked entry out of its week",
      createState(),
      (s) => moveTimesheetEntry(s, "locked", valuesOn("2026-10-14"), factories),
    ],
    [
      "move an entry into a locked week",
      createState(),
      (s) =>
        moveTimesheetEntry(
          s,
          "open",
          valuesOn("2026-10-07", "open"),
          factories,
        ),
    ],
    [
      "duplicate an entry into a locked week",
      createState(),
      (s) =>
        duplicateTimesheetEntry(
          s,
          "open",
          valuesOn("2026-10-07", "open"),
          factories,
        ),
    ],
    [
      "duplicate a locked entry on its own day",
      createState(),
      (s) =>
        duplicateTimesheetEntry(s, "locked", valuesOn("2026-10-06"), factories),
    ],
    [
      "delete a locked entry",
      createState(),
      (s) => deleteTimesheetEntry(s, "locked"),
    ],
    [
      "delete a selection that holds a locked entry",
      createState(),
      (s) => deleteTimesheetEntries(s, ["open", "locked"]),
    ],
    [
      "paste copies on a locked day",
      createState(),
      (s) =>
        pasteTimesheetEntries(
          s,
          [{ entryId: "open", localDate: "2026-10-08" }],
          "copy",
          factories,
        ),
    ],
    [
      "paste a cut locked entry in another week",
      createState(),
      (s) =>
        pasteTimesheetEntries(
          s,
          [{ entryId: "locked", localDate: "2026-10-15" }],
          "cut",
          factories,
        ),
    ],
    [
      "drop a dragged entry on a locked day",
      createState(),
      (s) =>
        dropTimesheetEntries(
          s,
          { entryIds: ["open"], localDate: "2026-10-06", targetIndex: 0 },
          factories,
        ).state,
    ],
    [
      "reorder a locked day",
      createState({
        timesheetEntries: [
          committedEntry("locked", "2026-10-06", 10),
          committedEntry("locked-2", "2026-10-06", 20),
        ],
      }),
      (s) => reorderTimesheetEntries(s, "2026-10-06", ["locked-2", "locked"]),
    ],
    [
      "mark a locked entry as not committed",
      createState(),
      (s) => markTimesheetEntriesNotCommitted(s, ["locked"]),
    ],
    [
      "commit an imported entry on a locked day",
      createState({ timesheetImportDrafts: [importDraft("2026-10-08")] }),
      (s) => commitTimesheetImportDraft(s, "draft-1", factories),
    ],
    [
      "add a calendar suggestion on a locked day",
      createState(),
      (s) =>
        acceptCalendarSuggestions(
          s,
          [{ suggestion: suggestion("2026-10-08"), projectId: "p1" }],
          factories,
        ).state,
    ],
    [
      "start a running entry on a locked today",
      createState(),
      (s) => startTimer(s, { projectId: "p1" }, "2026-10-09", factories),
    ],
    [
      "continue a locked entry on its own day",
      createState(),
      (s) => continueTimesheetEntry(s, "locked", "2026-10-06", factories),
    ],
    [
      "save a running entry into a locked day",
      createState({ timers: [runningOn("2026-10-09")] }),
      (s) => saveTimer(s, "timer-1", factories),
    ],
  ];

  it.each(refused)("refuses to %s", (_name, before, write) => {
    const after = write(before);

    expect(after).not.toBe(before);
    expect(findLockedWeekWrite(before, after)).toBe(LOCKED);
    expect(() => assertNoLockedWeekWrite(before, after)).toThrow(
      new LockedWeekError(LOCKED),
    );
  });

  const allowed: Write[] = [
    [
      "edit an entry of an open week",
      createState(),
      (s) =>
        updateTimesheetEntry(
          s,
          "open",
          { projectId: "p1", taskId: "t1", note: "Changed", durationMs: HOUR },
          factories,
        ),
    ],
    [
      "duplicate a locked entry to an open week",
      createState(),
      (s) =>
        duplicateTimesheetEntry(s, "locked", valuesOn("2026-10-14"), factories),
    ],
    [
      "continue a locked entry today, in an open week",
      createState(),
      (s) => continueTimesheetEntry(s, "locked", "2026-10-16", factories),
    ],
    [
      "submit the week",
      createState({ lockedWeeks: [] }),
      (s) => ({ ...s, lockedWeeks: [{ weekOf: LOCKED, lockedAt: 60 }] }),
    ],
    ["reopen the week", createState(), (s) => ({ ...s, lockedWeeks: [] })],
    [
      "rebuild every entry with the same values",
      createState(),
      (s) => ({
        ...s,
        timesheetEntries: s.timesheetEntries.map((entry) => ({
          ...entry,
          workItemId: undefined,
        })),
      }),
    ],
  ];

  it.each(allowed)("lets through: %s", (_name, before, write) => {
    const after = write(before);

    expect(after).not.toBe(before);
    expect(findLockedWeekWrite(before, after)).toBeUndefined();
    expect(() => assertNoLockedWeekWrite(before, after)).not.toThrow();
  });

  it("refuses any other write that adds an entry on a locked day, such as a browser activity commit", () => {
    const before = createState();
    const activity: LocalTimesheetEntry = {
      _id: "activity",
      localDate: "2026-10-10",
      projectId: "p1",
      label: "github.com",
      durationMs: HOUR,
      sourceBlockIds: ["bucket:1"],
      committedAt: 100,
    };

    expect(
      findLockedWeekWrite(before, {
        ...before,
        timesheetEntries: [...before.timesheetEntries, activity],
      }),
    ).toBe(LOCKED);
  });

  it("lets a running entry from Sunday save there after the next week was submitted", () => {
    // 00:30 on Monday, October 12: the running entry started on Sunday the 11th.
    const before = createState({
      lockedWeeks: [{ weekOf: "2026-10-12", lockedAt: 50 }],
      timers: [runningOn("2026-10-11")],
    });

    const stopped = saveTimer(before, "timer-1", factories);
    expect(stopped.timesheetEntries.at(-1)!.localDate).toBe("2026-10-11");
    expect(findLockedWeekWrite(before, stopped)).toBeUndefined();

    // Switch saves Sunday's entry and starts one on Monday, which is locked.
    const switched = startTimer(
      before,
      { projectId: "p1" },
      "2026-10-12",
      factories,
    );
    expect(findLockedWeekWrite(before, switched)).toBe("2026-10-12");
  });
});
