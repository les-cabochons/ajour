import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalTimesheetEntry } from "@/domain/local-state";
import {
  getWeekChangesForAgent,
  getWorkItemForAgent,
  listProjectsForAgent,
  listTimeEntriesForAgent,
  listWorkItemsForAgent,
  readRunningTimer,
} from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import {
  externalEntryId,
  timesheetChangeVersion,
} from "@/domain/agents/external-id";
import { listWeekChanges } from "@/domain/time/timesheet-commit";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 14, 15);
const WEEK = [
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16",
  "2026-10-17",
  "2026-10-18",
];

function entry(
  overrides: Partial<LocalTimesheetEntry> & { _id: string },
): LocalTimesheetEntry {
  return {
    localDate: "2026-10-13",
    projectId: "project-1",
    taskId: "task-1",
    label: "Build",
    durationMs: HOUR,
    sourceBlockIds: [],
    committedAt: 10,
    ...overrides,
  };
}

function createState(): LocalAppState {
  return {
    projects: [
      {
        _id: "project-1",
        name: "Acme",
        color: "#123456",
        status: "active",
        tasks: [
          { _id: "task-1", name: "Build", status: "active", createdAt: 1 },
          { _id: "task-2", name: "Old", status: "archived", createdAt: 1 },
        ],
      },
      {
        _id: "project-2",
        name: "Gone",
        code: "GONE-1",
        color: "#654321",
        status: "archived",
        tasks: [],
      },
    ],
    timers: [
      {
        _id: "timer-1",
        startedAt: NOW - 30 * 60_000,
        localDate: "2026-10-14",
        projectId: "project-1",
        taskId: "task-1",
        note: "Review",
        accumulatedDurationMs: 15 * 60_000,
      },
    ],
    timesheetEntries: [
      entry({ _id: "e1", note: "Morning", committedAt: 20 }),
      entry({
        _id: "e2",
        note: "Afternoon",
        committedAt: 10,
        commit: {
          at: 5,
          localDate: "2026-10-13",
          projectId: "project-1",
          taskId: "task-1",
          note: "Afternoon",
          durationMs: HOUR,
        },
      }),
      entry({ _id: "e3", localDate: "2026-10-20" }),
    ],
    timesheetTombstones: [],
    workItems: [
      {
        _id: "w1",
        title: "Fix login",
        status: "active",
        source: "manual",
        projectId: "project-1",
        workflowStateId: "todo",
        priority: 2,
        note: "Steps in the ticket",
        createdAt: 1,
      },
      {
        _id: "w2",
        title: "Snoozed task",
        status: "active",
        source: "manual",
        snoozedUntil: NOW + HOUR,
        createdAt: 2,
      },
      {
        _id: "w3",
        title: "Waiting on review",
        status: "settled",
        source: "manual",
        createdAt: 3,
      },
    ],
    workflowStates: [
      { _id: "todo", name: "To do", color: "#000", createdAt: 1 },
    ],
    backlogSortMode: "custom",
    userPreferences: {
      weeklyCapacityTargets: {
        monday: 8 * HOUR,
        tuesday: 8 * HOUR,
        wednesday: 8 * HOUR,
        thursday: 8 * HOUR,
        friday: 8 * HOUR,
        saturday: 0,
        sunday: 0,
      },
    },
  } as unknown as LocalAppState;
}

/** The default state, with the "Acme" project carrying the code "ACME-1". */
function stateWithCodedProject(): LocalAppState {
  const state = createState();
  return {
    ...state,
    projects: state.projects.map((project) =>
      project._id === "project-1" ? { ...project, code: "ACME-1" } : project,
    ),
  };
}

describe("agent read model", () => {
  it("reads the running entry with its counted minutes", () => {
    expect(readRunningTimer(createState(), NOW)).toEqual({
      timerId: "timer-1",
      date: "2026-10-14",
      countedMinutes: 45,
      note: "Review",
      projectId: "project-1",
      projectName: "Acme",
      taskId: "task-1",
      taskName: "Build",
    });
  });

  it("lists entries in a range with their state, oldest day first", () => {
    const result = listTimeEntriesForAgent(
      createState(),
      { from: "2026-10-12", to: "2026-10-18" },
      NOW,
    );
    expect(result.entries.map((item) => [item.entryId, item.state])).toEqual([
      ["e2", "committed"],
      ["e1", "saved"],
    ]);
    expect(result.running?.timerId).toBe("timer-1");
  });

  it("refuses ranges over 62 days", () => {
    expect(() =>
      listTimeEntriesForAgent(
        createState(),
        { from: "2026-01-01", to: "2026-12-31" },
        NOW,
      ),
    ).toThrow(AgentToolRefusal);
  });

  it("lists only active projects and tasks", () => {
    expect(listProjectsForAgent(createState())).toEqual({
      projects: [
        {
          projectId: "project-1",
          name: "Acme",
          tasks: [{ taskId: "task-1", name: "Build" }],
        },
      ],
    });
  });

  it("returns the sidebar work list by default, without snoozed items", () => {
    const items = listWorkItemsForAgent(
      createState(),
      { filter: "sidebar", limit: 50 },
      NOW,
    ).workItems;
    expect(items.map((item) => item.workItemId)).toEqual(["w1"]);
    expect(items[0]).toMatchObject({ workflowState: "To do", priority: 2 });
  });

  it("filters work items by status and text", () => {
    expect(
      listWorkItemsForAgent(
        createState(),
        { filter: "all", text: "REVIEW", limit: 50 },
        NOW,
      ).workItems.map((item) => item.workItemId),
    ).toEqual(["w3"]);
  });

  it("refuses an unknown work item id with a hint", () => {
    expect(() => getWorkItemForAgent(createState(), "nope", NOW)).toThrow(
      "No backlog item has the id nope. Call list_work_items.",
    );
  });

  const NEXT_WEEK = [
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ];

  /** e1 added, e2 updated from 1 h to 2 h, and a deleted entry on the archived project. */
  function changesState(): LocalAppState {
    const state = createState();
    return {
      ...state,
      timesheetEntries: state.timesheetEntries.map((item) =>
        item._id === "e2" ? { ...item, durationMs: 2 * HOUR } : item,
      ),
      timesheetTombstones: [
        {
          entryId: "gone",
          commit: {
            at: 5,
            localDate: "2026-10-14",
            projectId: "project-2",
            note: "Old work",
            durationMs: HOUR,
          },
        },
      ],
    };
  }

  const allChecked = {
    weekDates: WEEK,
    onlyChecked: true,
    uncheckedIds: new Set<string>(),
    projectPropertyPlugins: [],
  };

  it("lists the week's changes with external ids, in decimal hours", () => {
    const acme = {
      projectName: "Acme",
      projectFullName: "Acme",
      taskName: "Build",
    };

    expect(getWeekChangesForAgent(changesState(), allChecked).changes).toEqual([
      {
        change: "added",
        entryId: "e1",
        externalId: externalEntryId("e1"),
        version: expect.stringMatching(/^v:[0-9a-f]{8}$/),
        checked: true,
        current: { date: "2026-10-13", ...acme, hours: 1, note: "Morning" },
      },
      {
        change: "updated",
        entryId: "e2",
        externalId: externalEntryId("e2"),
        version: expect.stringMatching(/^v:[0-9a-f]{8}$/),
        checked: true,
        current: { date: "2026-10-13", ...acme, hours: 2, note: "Afternoon" },
        committed: { date: "2026-10-13", ...acme, hours: 1, note: "Afternoon" },
      },
      {
        change: "deleted",
        entryId: "gone",
        externalId: externalEntryId("gone"),
        version: expect.stringMatching(/^v:[0-9a-f]{8}$/),
        checked: true,
        // The project is archived since, and still named.
        committed: {
          date: "2026-10-14",
          projectName: "Gone",
          projectFullName: "Gone",
          projectCode: "GONE-1",
          hours: 1,
          note: "Old work",
        },
      },
    ]);
  });

  it("gives each change the version of its kind, current and committed values", () => {
    const state = changesState();
    const expected = listWeekChanges({
      entries: state.timesheetEntries,
      tombstones: state.timesheetTombstones,
      weekDates: WEEK,
    }).map(timesheetChangeVersion);

    expect(
      getWeekChangesForAgent(state, allChecked).changes.map(
        (change) => change.version,
      ),
    ).toEqual(expected);
  });

  it("leaves out unchecked changes unless asked for every change", () => {
    const input = { ...allChecked, uncheckedIds: new Set(["e1"]) };

    expect(
      getWeekChangesForAgent(changesState(), input).changes.map(
        (change) => change.entryId,
      ),
    ).toEqual(["e2", "gone"]);
    expect(
      getWeekChangesForAgent(changesState(), {
        ...input,
        onlyChecked: false,
      }).changes.find((change) => change.entryId === "e1"),
    ).toMatchObject({ checked: false });
  });

  it("shows an entry moved to the next week in both weeks, with one external id", () => {
    const state = createState();
    state.timesheetEntries = state.timesheetEntries.map((item) =>
      item._id === "e2" ? { ...item, localDate: "2026-10-20" } : item,
    );

    for (const weekDates of [WEEK, NEXT_WEEK]) {
      expect(
        getWeekChangesForAgent(state, {
          ...allChecked,
          weekDates,
        }).changes.find((change) => change.entryId === "e2"),
      ).toMatchObject({
        change: "updated",
        externalId: externalEntryId("e2"),
        current: { date: "2026-10-20" },
        committed: { date: "2026-10-13" },
      });
    }
  });

  it("sends the resolved plugin properties of active plugins", () => {
    const state = stateWithCodedProject();
    state.projects[0]!.pluginProperties = {
      "workday-agent": { name: "CA004 Tech & Design" },
      inactive: { other: "hidden" },
    };
    const change = getWeekChangesForAgent(state, {
      ...allChecked,
      projectPropertyPlugins: [
        {
          pluginId: "workday-agent",
          capability: {
            section: "Workday",
            fields: [
              { id: "name", label: "Workday name", defaultFrom: "fullName" },
              { id: "code", label: "Workday code", defaultFrom: "code" },
              { id: "empty", label: "Empty" },
            ],
          },
        },
      ],
    }).changes.find((item) => item.entryId === "e1")!;

    expect(change.current).toMatchObject({
      projectFullName: "Acme",
      projectCode: "ACME-1",
      projectProperties: {
        "workday-agent": { name: "CA004 Tech & Design", code: "ACME-1" },
      },
    });
  });

  it("sends no plugin properties when no plugin adds any", () => {
    const change = getWeekChangesForAgent(stateWithCodedProject(), allChecked)
      .changes[0]!;

    expect(change.current).not.toHaveProperty("projectProperties");
  });
});
