import { describe, expect, it } from "vitest";
import type { CalendarEventFacts } from "@ajour/shared";
import type {
  LocalAppState,
  LocalCalendarDecision,
  LocalCalendarEventRule,
} from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import { captureUndo, restoreUndo } from "@/domain/local-state-undo";
import {
  DEFAULT_CALENDAR_SUGGESTION_SETTINGS,
  acceptCalendarSuggestions,
  buildCalendarSuggestions,
  dismissCalendarSuggestions,
  forgetCalendarEventRule,
  groupCalendarSuggestionsByDay,
  hideCalendarMeeting,
  normalizeCalendarSuggestionSettings,
  pruneCalendarDecisions,
  removeCalendarConnectionData,
  selectCheckedSuggestions,
  type CalendarSuggestion,
  type FetchedCalendarEvents,
} from "@/domain/time/calendar-suggestions";

/** A local time on October 2026, so day assignment holds in any time zone. */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

function createState(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    user: { _id: "local-user", name: "Local User", email: "local@example.com" },
    projects: [
      {
        _id: "internal",
        name: "Internal",
        color: "#123456",
        icon: DEFAULT_PROJECT_ICON,
        status: "active",
        tasks: [
          { _id: "meetings", name: "Meetings", status: "active", createdAt: 1 },
          { _id: "old", name: "Old", status: "archived", createdAt: 1 },
        ],
      },
      {
        _id: "closed",
        name: "Closed",
        color: "#654321",
        icon: DEFAULT_PROJECT_ICON,
        status: "archived",
        tasks: [],
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
        _id: "meetings-item",
        title: "Team meetings",
        status: "active",
        source: "manual",
        projectId: "internal",
        taskId: "meetings",
        remainingEstimateHours: 10,
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

function event(
  overrides: Partial<CalendarEventFacts> = {},
): CalendarEventFacts {
  return {
    eventId: "standup",
    seriesId: "standup",
    startsAt: at(14, 9),
    endsAt: at(14, 9, 15),
    allDay: false,
    title: "Daily standup",
    status: "confirmed",
    response: "accepted",
    busy: true,
    ...overrides,
  };
}

function fetched(
  events: CalendarEventFacts[],
  connectionId = "work",
): FetchedCalendarEvents {
  return {
    pluginId: "ics",
    connectionId,
    connectionLabel: connectionId === "work" ? "Work" : "Personal",
    events,
  };
}

let nextId = 0;
const factories = {
  createId: (prefix: string) => `${prefix}-${++nextId}`,
  now: () => 1_000,
};

function suggestionsFor(
  state: LocalAppState,
  events: CalendarEventFacts[],
  settings = DEFAULT_CALENDAR_SUGGESTION_SETTINGS,
) {
  return buildCalendarSuggestions(state, [fetched(events)], settings);
}

function only(suggestions: CalendarSuggestion[]) {
  expect(suggestions).toHaveLength(1);
  return suggestions[0]!;
}

const standupRule: LocalCalendarEventRule = {
  _id: "rule-1",
  pluginId: "ics",
  connectionId: "work",
  seriesId: "standup",
  label: "Daily standup",
  action: "assign",
  projectId: "internal",
  taskId: "meetings",
  createdAt: 1,
};

describe("building suggestions", () => {
  it("places events on their local day, rounds durations and orders by start", () => {
    const suggestions = suggestionsFor(createState(), [
      event({
        eventId: "late",
        seriesId: undefined,
        startsAt: at(14, 16),
        endsAt: at(14, 16, 50) + 20_000,
        title: "Review",
      }),
      event(),
      event({
        eventId: "night",
        seriesId: undefined,
        startsAt: at(15, 23),
        endsAt: at(16, 1),
        title: "Release",
      }),
    ]);

    expect(
      suggestions.map((item) => [item.title, item.localDate, item.durationMs]),
    ).toEqual([
      ["Daily standup", "2026-10-14", 15 * 60_000],
      ["Review", "2026-10-14", 50 * 60_000],
      ["Release", "2026-10-15", 2 * 60 * 60_000],
    ]);
    expect(suggestions[0]).toMatchObject({
      pluginId: "ics",
      connectionId: "work",
      connectionLabel: "Work",
      seriesId: "standup",
      allDay: false,
    });
  });

  it("drops cancelled occurrences and names untitled events Busy", () => {
    const suggestions = suggestionsFor(createState(), [
      event({ status: "cancelled" }),
      event({ eventId: "private", seriesId: undefined, title: "  " }),
    ]);

    expect(only(suggestions)).toMatchObject({ title: "Busy", untitled: true });
  });

  it("marks what each filter hides and keeps the rest visible", () => {
    const events = [
      event({
        eventId: "allday",
        seriesId: undefined,
        allDay: true,
        startsAt: at(14, 0),
        endsAt: at(15, 0),
      }),
      event({
        eventId: "conference",
        seriesId: undefined,
        startsAt: at(12, 9),
        endsAt: at(14, 9),
      }),
      event({ eventId: "declined", seriesId: undefined, response: "declined" }),
      event({ eventId: "free", seriesId: undefined, busy: false }),
      event({
        eventId: "unanswered",
        seriesId: undefined,
        response: "needsAction",
      }),
      event({ eventId: "unknown", seriesId: undefined, response: "unknown" }),
      event({ eventId: "short", seriesId: undefined, endsAt: at(14, 9, 5) }),
    ];
    const reasons = (settings = DEFAULT_CALENDAR_SUGGESTION_SETTINGS) =>
      Object.fromEntries(
        suggestionsFor(createState(), events, settings).map((item) => [
          item.occurrenceKey.split('"')[1],
          item.hiddenBy ?? "visible",
        ]),
      );

    expect(reasons()).toEqual({
      allday: "allDay",
      conference: "allDay",
      declined: "declined",
      free: "free",
      unanswered: "visible",
      unknown: "visible",
      short: "visible",
    });
    expect(
      reasons({
        ...DEFAULT_CALENDAR_SUGGESTION_SETTINGS,
        hideAllDay: false,
        hideDeclined: false,
        hideFree: false,
        hideUnanswered: true,
        minimumMinutes: 10,
      }),
    ).toMatchObject({
      allday: "visible",
      declined: "visible",
      free: "visible",
      unanswered: "unanswered",
      unknown: "visible",
      short: "short",
    });
  });

  it("groups by day into visible and hidden", () => {
    const days = groupCalendarSuggestionsByDay(
      suggestionsFor(createState(), [
        event(),
        event({ eventId: "free", seriesId: undefined, busy: false }),
      ]),
    );
    expect(days.get("2026-10-14")?.visible.map((item) => item.title)).toEqual([
      "Daily standup",
    ]);
    expect(days.get("2026-10-14")?.hidden).toHaveLength(1);
  });

  it("fills a remembered meeting's project only while project and task are active", () => {
    expect(
      only(
        suggestionsFor(createState({ calendarEventRules: [standupRule] }), [
          event(),
        ]),
      ),
    ).toMatchObject({
      projectId: "internal",
      taskId: "meetings",
      ruleId: "rule-1",
    });

    for (const rule of [
      { ...standupRule, taskId: "old" },
      { ...standupRule, projectId: "closed", taskId: undefined },
      { ...standupRule, projectId: "deleted" },
      { ...standupRule, connectionId: "personal" },
    ]) {
      const suggestion = only(
        suggestionsFor(createState({ calendarEventRules: [rule] }), [event()]),
      );
      expect(suggestion.projectId).toBeUndefined();
    }
  });

  it("leaves out hidden meetings and decided occurrences, and suggests again once the entry is gone", () => {
    const decision: LocalCalendarDecision = {
      _id: "decision-1",
      pluginId: "ics",
      connectionId: "work",
      occurrenceKey: JSON.stringify(["standup", at(14, 9)]),
      localDate: "2026-10-14",
      decision: "added",
      entryId: "entry-1",
      decidedAt: 1,
    };
    const tomorrow = event({ startsAt: at(15, 9), endsAt: at(15, 9, 15) });
    const withEntry = createState({
      calendarDecisions: [decision],
      timesheetEntries: [
        {
          _id: "entry-1",
          localDate: "2026-10-14",
          label: "Meetings",
          durationMs: 900_000,
          sourceBlockIds: [],
          committedAt: 1,
        },
      ],
    });

    expect(
      suggestionsFor(withEntry, [event(), tomorrow]).map(
        (item) => item.localDate,
      ),
    ).toEqual(["2026-10-15"]);
    expect(
      suggestionsFor({ ...withEntry, timesheetEntries: [] }, [
        event(),
        tomorrow,
      ]),
    ).toHaveLength(2);
    expect(
      suggestionsFor(
        createState({
          calendarDecisions: [
            { ...decision, decision: "dismissed", entryId: undefined },
          ],
        }),
        [event()],
      ),
    ).toEqual([]);
    expect(
      suggestionsFor(
        createState({
          calendarEventRules: [
            {
              ...standupRule,
              action: "hide",
              projectId: undefined,
              taskId: undefined,
            },
          ],
        }),
        [event(), tomorrow],
      ),
    ).toEqual([]);
  });

  it("keeps the same event from two connections apart", () => {
    const suggestions = buildCalendarSuggestions(createState(), [
      fetched([event()], "work"),
      fetched([event()], "personal"),
    ]);
    expect(suggestions.map((item) => item.connectionLabel).sort()).toEqual([
      "Personal",
      "Work",
    ]);
  });
});

describe("the Calendar panel's selection", () => {
  it("checks visible suggestions with a project unless unchecked, and totals them", () => {
    const suggestions = suggestionsFor(
      createState({ calendarEventRules: [standupRule] }),
      [
        event(),
        event({ startsAt: at(15, 9), endsAt: at(15, 9, 15) }),
        event({
          eventId: "kickoff",
          seriesId: undefined,
          startsAt: at(14, 11),
          endsAt: at(14, 12),
        }),
        event({
          eventId: "free",
          seriesId: "standup",
          busy: false,
          startsAt: at(16, 9),
          endsAt: at(16, 10),
        }),
      ],
    );
    const tomorrow = suggestions.find(
      (item) => item.localDate === "2026-10-15",
    )!;

    const all = selectCheckedSuggestions(suggestions, new Set());
    expect(all.checked.map((item) => item.localDate)).toEqual([
      "2026-10-14",
      "2026-10-15",
    ]);
    expect(all.totalMs).toBe(30 * 60_000);

    const one = selectCheckedSuggestions(suggestions, new Set([tomorrow.key]));
    expect(one.checked).toHaveLength(1);
    expect(one.totalMs).toBe(15 * 60_000);
  });
});

describe("acting on suggestions", () => {
  it("adds entries with the title as note, logs the time and remembers the meeting", () => {
    const state = createState();
    const [standup, review] = suggestionsFor(state, [
      event(),
      event({
        eventId: "review",
        seriesId: undefined,
        startsAt: at(14, 15),
        endsAt: at(14, 16),
        title: "Review",
      }),
    ]);

    const { state: next, result } = acceptCalendarSuggestions(
      state,
      [
        {
          suggestion: standup!,
          projectId: "internal",
          taskId: "meetings",
          remember: true,
        },
        { suggestion: review!, projectId: "internal", remember: true },
      ],
      factories,
    );

    expect(result.skipped).toBe(0);
    expect(
      next.timesheetEntries.map((entry) => [
        entry.localDate,
        entry.projectId,
        entry.taskId,
        entry.note,
        entry.durationMs,
      ]),
    ).toEqual([
      ["2026-10-14", "internal", "meetings", "Daily standup", 15 * 60_000],
      ["2026-10-14", "internal", undefined, "Review", 60 * 60_000],
    ]);
    expect(result.entryIds).toEqual(
      next.timesheetEntries.map((entry) => entry._id),
    );
    expect(next.workItems[0]?.remainingEstimateHours).toBe(9.75);
    expect(
      next.calendarDecisions?.map((item) => [item.decision, item.entryId]),
    ).toEqual(result.entryIds.map((id) => ["added", id]));
    // A one-off event has no meeting to remember.
    expect(next.calendarEventRules).toEqual([
      expect.objectContaining({
        seriesId: "standup",
        label: "Daily standup",
        action: "assign",
        projectId: "internal",
        taskId: "meetings",
      }),
    ]);
    expect(suggestionsFor(next, [event()])).toEqual([]);
  });

  it("skips suggestions without an active project or already added", () => {
    const state = createState();
    const standup = only(suggestionsFor(state, [event()]));
    const first = acceptCalendarSuggestions(
      state,
      [{ suggestion: standup, projectId: "internal" }],
      factories,
    );

    const again = acceptCalendarSuggestions(
      first.state,
      [
        { suggestion: standup, projectId: "internal" },
        { suggestion: standup, projectId: "closed" },
      ],
      factories,
    );
    expect(again.result).toEqual({ entryIds: [], skipped: 2 });
    expect(again.state).toBe(first.state);
  });

  it("replaces a remembered meeting's project when the user picks another", () => {
    const state = createState({ calendarEventRules: [standupRule] });
    const standup = only(suggestionsFor(state, [event()]));
    const { state: next } = acceptCalendarSuggestions(
      state,
      [{ suggestion: standup, projectId: "internal", remember: true }],
      factories,
    );
    expect(next.calendarEventRules).toHaveLength(1);
    expect(next.calendarEventRules![0]).toMatchObject({
      _id: "rule-1",
      createdAt: 1,
      projectId: "internal",
    });
    expect(next.calendarEventRules![0]!.taskId).toBeUndefined();
  });

  it("dismisses occurrences, hides and forgets meetings", () => {
    const state = createState();
    const [today, tomorrow] = suggestionsFor(state, [
      event(),
      event({ startsAt: at(15, 9), endsAt: at(15, 9, 15) }),
    ]);

    const dismissed = dismissCalendarSuggestions(state, [today!], factories);
    expect(
      suggestionsFor(dismissed, [
        event(),
        event({ startsAt: at(15, 9), endsAt: at(15, 9, 15) }),
      ]).map((item) => item.localDate),
    ).toEqual(["2026-10-15"]);

    const hidden = hideCalendarMeeting(dismissed, tomorrow!, factories);
    expect(hidden.calendarEventRules).toEqual([
      expect.objectContaining({
        action: "hide",
        seriesId: "standup",
        label: "Daily standup",
      }),
    ]);
    expect(
      suggestionsFor(hidden, [
        event({ startsAt: at(16, 9), endsAt: at(16, 9, 15) }),
      ]),
    ).toEqual([]);

    const ruleId = hidden.calendarEventRules![0]!._id;
    const forgotten = forgetCalendarEventRule(hidden, ruleId);
    expect(forgotten.calendarEventRules).toEqual([]);
    expect(forgetCalendarEventRule(forgotten, ruleId)).toBe(forgotten);

    const oneOff = only(
      suggestionsFor(state, [
        event({ eventId: "one-off", seriesId: undefined }),
      ]),
    );
    expect(hideCalendarMeeting(state, oneOff, factories)).toBe(state);
  });

  it("undoes an add, including the decision, the rule and the logged time", () => {
    const state = createState();
    const standup = only(suggestionsFor(state, [event()]));
    const { state: next } = acceptCalendarSuggestions(
      state,
      [
        {
          suggestion: standup,
          projectId: "internal",
          taskId: "meetings",
          remember: true,
        },
      ],
      factories,
    );

    const undo = captureUndo(state, next)!;
    const restored = restoreUndo(next, undo);
    expect(restored.result).toBe("restored");
    expect(restored.state.timesheetEntries).toEqual([]);
    expect(restored.state.calendarDecisions).toEqual([]);
    expect(restored.state.calendarEventRules).toEqual([]);
    expect(restored.state.workItems[0]?.remainingEstimateHours).toBe(10);
  });

  it("removes one connection's decisions and remembered meetings", () => {
    const state = createState({
      calendarEventRules: [
        standupRule,
        { ...standupRule, _id: "rule-2", connectionId: "personal" },
      ],
      calendarDecisions: [
        {
          _id: "decision-1",
          pluginId: "ics",
          connectionId: "work",
          occurrenceKey: "x",
          localDate: "2026-10-14",
          decision: "dismissed",
          decidedAt: 1,
        },
      ],
    });

    const next = removeCalendarConnectionData(state, {
      pluginId: "ics",
      connectionId: "work",
    });
    expect(next.calendarDecisions).toEqual([]);
    expect(next.calendarEventRules?.map((rule) => rule._id)).toEqual([
      "rule-2",
    ]);
    expect(
      removeCalendarConnectionData(next, {
        pluginId: "ics",
        connectionId: "work",
      }),
    ).toBe(next);
  });
});

describe("settings and retention", () => {
  it("normalizes stored settings", () => {
    expect(normalizeCalendarSuggestionSettings(undefined)).toEqual(
      DEFAULT_CALENDAR_SUGGESTION_SETTINGS,
    );
    expect(
      normalizeCalendarSuggestionSettings({
        hideAllDay: false,
        minimumMinutes: -5,
        refreshMinutes: 5000,
        hideFree: "yes",
      }),
    ).toEqual({
      ...DEFAULT_CALENDAR_SUGGESTION_SETTINGS,
      hideAllDay: false,
      minimumMinutes: 0,
      refreshMinutes: 1440,
    });
  });

  it("keeps decisions for 90 days past their day", () => {
    const decision = (localDate: string): LocalCalendarDecision => ({
      _id: localDate,
      pluginId: "ics",
      connectionId: "work",
      occurrenceKey: localDate,
      localDate,
      decision: "dismissed",
      decidedAt: 1,
    });

    expect(
      pruneCalendarDecisions(
        [
          decision("2026-07-17"),
          decision("2026-07-18"),
          decision("2026-10-14"),
        ],
        "2026-10-16",
      ).map((item) => item.localDate),
    ).toEqual(["2026-07-18", "2026-10-14"]);
  });
});
