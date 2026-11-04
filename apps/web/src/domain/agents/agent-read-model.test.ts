import { describe, expect, it } from "vitest";
import type { DataToolOutput } from "@ajour/shared/agent-tools";
import type { LocalAppState, LocalTimesheetEntry } from "@/domain/local-state";
import {
  checkChangeVersionsOrRefuse,
  findEntriesForAgent,
  getWeekChangesForAgent,
  getWeekLinesForAgent,
  getWeekStatusForAgent,
  getWorkItemForAgent,
  listProjectsForAgent,
  listTimeEntriesForAgent,
  listWorkItemsForAgent,
  readRunningTimer,
  toAgentEntry,
} from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import {
  externalEntryId,
  timesheetChangeVersion,
} from "@/domain/agents/external-id";
import {
  NO_PROPERTY_PLUGINS,
  type PropertyPlugins,
} from "@/domain/projects/plugin-properties";
import {
  isTimesheetEntryCommitted,
  listWeekChanges,
} from "@/domain/time/timesheet-commit";
import { markTimesheetEntriesCommitted } from "@/domain/time/timesheet-entry";
import type { SubmitGroupBy } from "@/domain/time/timesheet-submission";

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
    lockedWeeks: [],
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
  it("reports the week's status: lock, waiting changes, committed hours and entries, and pace", () => {
    const state: LocalAppState = {
      ...createState(),
      timesheetTombstones: [
        {
          entryId: "gone",
          commit: {
            at: 5,
            localDate: "2026-10-15",
            projectId: "project-1",
            taskId: "task-1",
            durationMs: HOUR / 2,
          },
        },
      ],
    };
    const acme = {
      projectName: "Acme",
      projectFullName: "Acme",
      taskName: "Build",
    };
    const input = {
      weekDates: WEEK,
      today: "2026-10-14",
      propertyPlugins: NO_PROPERTY_PLUGINS,
    };

    const status = getWeekStatusForAgent(state, input);
    expect(status).toEqual({
      weekOf: "2026-10-12",
      version: expect.stringMatching(/^v:[0-9a-f]{8}$/),
      locked: false,
      // e1 was never committed, and "gone" was deleted since its commit.
      uncommittedChanges: 2,
      committedHoursByDay: [
        { date: "2026-10-12", hours: 0 },
        { date: "2026-10-13", hours: 1 },
        { date: "2026-10-14", hours: 0 },
        { date: "2026-10-15", hours: 0.5 },
        { date: "2026-10-16", hours: 0 },
        { date: "2026-10-17", hours: 0 },
        { date: "2026-10-18", hours: 0 },
      ],
      committedEntries: [
        {
          entryId: "e2",
          externalId: externalEntryId("e2"),
          committed: {
            date: "2026-10-13",
            ...acme,
            hours: 1,
            note: "Afternoon",
          },
        },
        {
          entryId: "gone",
          externalId: externalEntryId("gone"),
          committed: { date: "2026-10-15", ...acme, hours: 0.5 },
        },
      ],
      // Monday to Wednesday expect 24 hours; e1 and e2 log 2.
      pace: {
        loggedHours: 2,
        targetHours: 40,
        expectedHours: 24,
        status: "under",
      },
    });
    const locked = getWeekStatusForAgent(
      { ...state, lockedWeeks: [{ weekOf: "2026-10-12", lockedAt: 1 }] },
      input,
    );
    expect(locked.locked).toBe(true);
    expect(locked.version).not.toBe(status.version);
  });

  it("versions the week's status by what submit_week depends on", () => {
    const input = {
      weekDates: WEEK,
      today: "2026-10-14",
      propertyPlugins: NO_PROPERTY_PLUGINS,
    };
    const state = createState();
    const { version } = getWeekStatusForAgent(state, input);

    // Pace is not part of it: another day reads the same version.
    expect(
      getWeekStatusForAgent(state, { ...input, today: "2026-10-16" }).version,
    ).toBe(version);
    // A change to a committed copy is.
    const edited: LocalAppState = {
      ...state,
      timesheetEntries: state.timesheetEntries.map((entry) =>
        entry.commit
          ? { ...entry, commit: { ...entry.commit, durationMs: 2 * HOUR } }
          : entry,
      ),
    };
    expect(getWeekStatusForAgent(edited, input).version).not.toBe(version);
  });

  it("versions exact committed durations, not the rounded hours", () => {
    const input = {
      weekDates: WEEK,
      today: "2026-10-14",
      propertyPlugins: NO_PROPERTY_PLUGINS,
    };
    const base = createState();
    const committed = base.timesheetEntries.find((entry) => entry.commit)!;
    /** Two committed entries on Tuesday, each lasting an hour and `seconds`. */
    const withDurations = (seconds: number): LocalAppState => {
      const durationMs = HOUR + seconds * 1000;
      return {
        ...base,
        timesheetEntries: ["c1", "c2"].map((_id) => ({
          ...committed,
          _id,
          durationMs,
          commit: { ...committed.commit!, durationMs },
        })),
      };
    };
    const before = getWeekStatusForAgent(withDurations(5), input);
    const after = getWeekStatusForAgent(withDurations(15), input);

    // Each entry reads the same rounded hours, so only the exact durations
    // tell them apart.
    expect(after.committedEntries).toEqual(before.committedEntries);
    expect(after.version).not.toBe(before.version);
  });

  it("reads the running entry with its counted minutes and seconds", () => {
    expect(readRunningTimer(createState(), NOW + 7_900)).toEqual({
      timerId: "timer-1",
      shortId: "timer-1",
      date: "2026-10-14",
      countedMinutes: 45,
      countedSeconds: 45 * 60 + 7,
      runningSince: new Date(NOW - 30 * 60_000).toISOString(),
      note: "Review",
      projectId: "project-1",
      projectName: "Acme",
      taskId: "task-1",
      taskName: "Build",
    });
  });

  it("says when each entry was last saved", () => {
    const state = createState();
    state.timesheetEntries[0] = { ...state.timesheetEntries[0]!, usedAt: NOW };
    const entries = listTimeEntriesForAgent(
      state,
      { from: "2026-10-13", to: "2026-10-13" },
      NOW,
    ).entries;
    expect(
      Object.fromEntries(entries.map((e) => [e.entryId, e.savedAt])),
    ).toEqual({
      e1: new Date(NOW).toISOString(),
      e2: new Date(10).toISOString(),
    });
  });

  it("names the project's code when it has one", () => {
    const state = createState();
    state.projects[0] = { ...state.projects[0]!, code: "ACME" };
    expect(readRunningTimer(state, NOW)).toMatchObject({
      projectName: "Acme",
      projectCode: "ACME",
    });
    expect(
      listTimeEntriesForAgent(
        state,
        { from: "2026-10-13", to: "2026-10-13" },
        NOW,
      ).entries[0],
    ).toMatchObject({ projectCode: "ACME" });
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
    expect(listProjectsForAgent(createState(), NO_PROPERTY_PLUGINS)).toEqual({
      projects: [
        {
          projectId: "project-1",
          name: "Acme",
          fullName: "Acme",
          displayName: "Acme",
          localOnly: false,
          tasks: [
            { taskId: "task-1", name: "Build", commitsAs: { kind: "own" } },
          ],
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
    propertyPlugins: NO_PROPERTY_PLUGINS,
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
      projects: state.projects,
      weekDates: WEEK,
    }).map((change) => timesheetChangeVersion(change));

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

  /** changesState with Build set to commit as `commitAs`. */
  function withBuild(commitAs: "waiting" | "local"): LocalAppState {
    const state = changesState();
    return {
      ...state,
      projects: state.projects.map((project) => ({
        ...project,
        tasks: project.tasks.map((task) =>
          task._id === "task-1" ? { ...task, commitAs } : task,
        ),
      })),
    };
  }

  it("leaves out changes on a Not known yet task, and refuses to mark them", () => {
    const state = withBuild("waiting");
    const changes = getWeekChangesForAgent(state, {
      ...allChecked,
      onlyChecked: false,
    }).changes;
    expect(changes.map((change) => change.entryId)).toEqual(["gone"]);

    const version = getWeekChangesForAgent(changesState(), allChecked)
      .changes[0]!.version;
    expect(() =>
      checkChangeVersionsOrRefuse(
        state,
        [{ entryId: "e1", version }],
        NO_PROPERTY_PLUGINS,
      ),
    ).toThrow(
      'e1 is on "Build", a task that is Not known yet. Its time stays out of the commit until the user chooses what the task commits as.',
    );
  });

  it("leaves out local changes, deletes a committed entry moved to local time, and refuses to mark the rest", () => {
    const state = withBuild("local");
    // e1 was never committed: local, so left out. e2 was committed under
    // Build before it became local and changed since: the tool drops it.
    expect(
      getWeekChangesForAgent(state, allChecked).changes.map((change) => [
        change.change,
        change.entryId,
      ]),
    ).toEqual([
      ["deleted", "e2"],
      ["deleted", "gone"],
    ]);
    const version = getWeekChangesForAgent(changesState(), allChecked)
      .changes[0]!.version;
    expect(() =>
      checkChangeVersionsOrRefuse(
        state,
        [{ entryId: "e1", version }],
        NO_PROPERTY_PLUGINS,
      ),
    ).toThrow("e1 changed since you read it.");
  });

  it("drops a deleted-then-committed local entry from the week status", () => {
    const state = withBuild("local");
    const e2 = getWeekChangesForAgent(state, allChecked).changes.find(
      (change) => change.entryId === "e2",
    )!;
    checkChangeVersionsOrRefuse(
      state,
      [{ entryId: "e2", version: e2.version }],
      NO_PROPERTY_PLUGINS,
    );
    const marked = markTimesheetEntriesCommitted(state, ["e2"], () => 99);
    expect(
      marked.timesheetEntries.find((item) => item._id === "e2")!.commit,
    ).toMatchObject({ local: true });

    expect(
      getWeekChangesForAgent(marked, allChecked).changes.map(
        (change) => change.entryId,
      ),
    ).toEqual(["gone"]);
    const status = getWeekStatusForAgent(marked, {
      weekDates: WEEK,
      today: "2026-10-16",
      propertyPlugins: NO_PROPERTY_PLUGINS,
    });
    expect(status.committedEntries.map((item) => item.entryId)).not.toContain(
      "e2",
    );
    expect(
      isTimesheetEntryCommitted(
        marked.timesheetEntries.find((item) => item._id === "e2")!,
      ),
    ).toBe(false);
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
      propertyPlugins: {
        projects: [
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
        tasks: [],
      },
    }).changes.find((item) => item.entryId === "e1")!;

    expect(change.current).toMatchObject({
      projectFullName: "Acme",
      projectCode: "ACME-1",
      projectProperties: {
        "workday-agent": { name: "CA004 Tech & Design", code: "ACME-1" },
      },
    });
  });

  it("sends the task's plugin properties, with the task's name as default", () => {
    const workdayTask = {
      pluginId: "workday-agent",
      capability: {
        section: "Workday",
        fields: [
          {
            id: "task",
            label: "Workday task",
            defaultFrom: "name" as const,
          },
        ],
      },
    };
    const input = {
      ...allChecked,
      propertyPlugins: { projects: [], tasks: [workdayTask] },
    };
    const unmapped = getWeekChangesForAgent(createState(), input).changes.find(
      (item) => item.entryId === "e1",
    )!;
    expect(unmapped.current).toMatchObject({
      taskName: "Build",
      taskProperties: { "workday-agent": { task: "Build" } },
    });

    const state = createState();
    state.projects[0]!.tasks[0]!.pluginProperties = {
      "workday-agent": { task: "07 Run" },
    };
    const mapped = getWeekChangesForAgent(state, input).changes.find(
      (item) => item.entryId === "e1",
    )!;
    expect(mapped.current).toMatchObject({
      taskName: "Build",
      taskProperties: { "workday-agent": { task: "07 Run" } },
    });
  });

  it("changes the week status version when a task's mapping changes", () => {
    const workdayTask = {
      pluginId: "workday-agent",
      capability: {
        section: "Workday",
        fields: [
          { id: "task", label: "Workday task", defaultFrom: "name" as const },
        ],
      },
    };
    const status = (state: LocalAppState) =>
      getWeekStatusForAgent(state, {
        weekDates: WEEK,
        today: WEEK[0]!,
        propertyPlugins: { projects: [], tasks: [workdayTask] },
      }).version;
    const state = createState();
    const before = status(state);
    state.projects[0]!.tasks[0]!.pluginProperties = {
      "workday-agent": { task: "07 Run" },
    };

    expect(status(state)).not.toBe(before);
  });

  it("sends no plugin properties when no plugin adds any", () => {
    const change = getWeekChangesForAgent(stateWithCodedProject(), allChecked)
      .changes[0]!;

    expect(change.current).not.toHaveProperty("projectProperties");
    expect(change.current).not.toHaveProperty("taskProperties");
  });
});

describe("the Commit page's lines for agents", () => {
  const workdayTask = {
    pluginId: "workday-agent",
    capability: {
      section: "Workday",
      fields: [
        { id: "task", label: "Workday task", defaultFrom: "name" as const },
      ],
    },
  };
  const plugins: PropertyPlugins = { projects: [], tasks: [workdayTask] };

  /**
   * Acme, whose Build task commits as 07 Run, with a Review task, a Not
   * known yet Temp task and a Local only Lunch task, and a Local only Home
   * project. Wednesday holds only local time, and the running entry is on
   * Wednesday too.
   */
  function weekState(): LocalAppState {
    const state = createState();
    return {
      ...state,
      projects: [
        {
          _id: "acme",
          name: "Acme Corporation",
          displayName: "Acme",
          code: "ACME-1",
          color: "#123456",
          status: "active",
          tasks: [
            {
              _id: "build",
              name: "Build",
              status: "active",
              createdAt: 1,
              pluginProperties: { "workday-agent": { task: "07 Run" } },
            },
            { _id: "review", name: "Review", status: "active", createdAt: 1 },
            {
              _id: "temp",
              name: "Temp migration",
              status: "active",
              createdAt: 1,
              commitAs: "waiting",
            },
            {
              _id: "lunch",
              name: "Team lunch",
              status: "active",
              createdAt: 1,
              commitAs: "local",
            },
          ],
        },
        {
          _id: "home",
          name: "Home",
          color: "#654321",
          status: "active",
          localOnly: true,
          tasks: [
            { _id: "chores", name: "Chores", status: "active", createdAt: 1 },
          ],
        },
      ],
      timers: [
        {
          _id: "timer-1",
          startedAt: NOW - 30 * 60_000,
          localDate: "2026-10-14",
          projectId: "acme",
          taskId: "review",
          accumulatedDurationMs: 15 * 60_000,
        },
      ],
      timesheetEntries: [
        entry({
          _id: "a1",
          localDate: "2026-10-12",
          projectId: "acme",
          taskId: "build",
          note: "Specs",
          committedAt: 1,
        }),
        entry({
          _id: "a2",
          localDate: "2026-10-12",
          projectId: "acme",
          taskId: "build",
          note: "Specs",
          durationMs: HOUR / 2,
          committedAt: 2,
        }),
        entry({
          _id: "a3",
          localDate: "2026-10-12",
          projectId: "acme",
          taskId: "review",
          note: "PR 12",
          durationMs: 45 * 60_000,
          committedAt: 3,
        }),
        entry({
          _id: "a4",
          localDate: "2026-10-13",
          projectId: "acme",
          taskId: "build",
          note: "Deploy",
          durationMs: 2 * HOUR,
          committedAt: 4,
        }),
        entry({
          _id: "a5",
          localDate: "2026-10-13",
          projectId: "acme",
          taskId: "temp",
          durationMs: 3 * HOUR,
          committedAt: 5,
        }),
        entry({
          _id: "a6",
          localDate: "2026-10-13",
          projectId: "acme",
          taskId: "lunch",
          committedAt: 6,
        }),
        entry({
          _id: "a7",
          localDate: "2026-10-14",
          projectId: "home",
          taskId: "chores",
          durationMs: HOUR / 2,
          committedAt: 7,
        }),
        entry({ _id: "next-week", localDate: "2026-10-20", projectId: "acme" }),
      ],
    } as LocalAppState;
  }

  const read = (
    state: LocalAppState,
    groupBy: SubmitGroupBy,
    propertyPlugins: PropertyPlugins = plugins,
  ) =>
    getWeekLinesForAgent(state, {
      weekDates: WEEK,
      groupBy,
      propertyPlugins,
      now: NOW,
    });

  const acme = {
    projectId: "acme",
    projectName: "Acme Corporation",
    projectCode: "ACME-1",
  };

  it("returns the lines, with the time kept out of them beside them", () => {
    expect(read(weekState(), "day-task")).toEqual({
      weekOf: "2026-10-12",
      groupBy: "day-task",
      locked: false,
      sections: [
        {
          localDate: "2026-10-12",
          lines: [
            {
              ...acme,
              taskId: "build",
              taskName: "07 Run",
              hours: 1.5,
              comments: "Specs",
              entryIds: ["a1", "a2"],
            },
            {
              ...acme,
              taskId: "review",
              taskName: "Review",
              hours: 0.75,
              comments: "PR 12",
              entryIds: ["a3"],
            },
          ],
        },
        {
          localDate: "2026-10-13",
          lines: [
            {
              ...acme,
              taskId: "build",
              taskName: "07 Run",
              hours: 2,
              comments: "Deploy",
              entryIds: ["a4"],
            },
          ],
        },
      ],
      notSent: {
        hours: 1.5,
        items: [
          { ...acme, taskId: "lunch", taskName: "Team lunch", hours: 1 },
          { projectId: "home", projectName: "Home", hours: 0.5 },
        ],
      },
      waiting: {
        hours: 3,
        tasks: [
          {
            projectId: "acme",
            taskId: "temp",
            taskName: "Temp migration",
            hours: 3,
          },
        ],
      },
      running: {
        timerId: "timer-1",
        date: "2026-10-14",
        unsavedMinutes: 45,
        projectId: "acme",
        projectName: "Acme",
        projectCode: "ACME-1",
        taskId: "review",
        taskName: "Review",
      },
    });
  });

  /**
   * The fixture's sent entries, worked out by hand: Monday a1 (07 Run, 1:00,
   * Specs), a2 (07 Run, 0:30, Specs), a3 (Review, 0:45, PR 12); Tuesday a4
   * (07 Run, 2:00, Deploy).
   */
  const run = { ...acme, taskId: "build", taskName: "07 Run" };
  const review = { ...acme, taskId: "review", taskName: "Review" };
  it.each<[SubmitGroupBy, DataToolOutput<"get_week_lines">["sections"]]>([
    [
      "day-task",
      [
        {
          localDate: "2026-10-12",
          lines: [
            { ...run, hours: 1.5, comments: "Specs", entryIds: ["a1", "a2"] },
            { ...review, hours: 0.75, comments: "PR 12", entryIds: ["a3"] },
          ],
        },
        {
          localDate: "2026-10-13",
          lines: [{ ...run, hours: 2, comments: "Deploy", entryIds: ["a4"] }],
        },
      ],
    ],
    [
      "day",
      [
        {
          localDate: "2026-10-12",
          lines: [
            { ...run, hours: 1, comments: "Specs", entryIds: ["a1"] },
            { ...run, hours: 0.5, comments: "Specs", entryIds: ["a2"] },
            { ...review, hours: 0.75, comments: "PR 12", entryIds: ["a3"] },
          ],
        },
        {
          localDate: "2026-10-13",
          lines: [{ ...run, hours: 2, comments: "Deploy", entryIds: ["a4"] }],
        },
      ],
    ],
    [
      "task",
      [
        {
          lines: [
            {
              ...run,
              hours: 3.5,
              comments: "Specs | Deploy",
              entryIds: ["a1", "a2", "a4"],
            },
            { ...review, hours: 0.75, comments: "PR 12", entryIds: ["a3"] },
          ],
        },
      ],
    ],
  ])(
    "gives the Commit page's lines when grouping by %s",
    (groupBy, sections) => {
      expect(read(weekState(), groupBy).sections).toEqual(sections);
    },
  );

  it("reports only the running entry's unsaved time when it continues a saved entry", () => {
    const state = {
      ...weekState(),
      timers: [
        {
          _id: "timer-1",
          startedAt: NOW - 15 * 60_000,
          localDate: "2026-10-14",
          projectId: "acme",
          taskId: "review",
          accumulatedDurationMs: HOUR,
          entryId: "today",
        },
      ],
    } as LocalAppState;
    state.timesheetEntries.push(
      entry({
        _id: "today",
        localDate: "2026-10-14",
        projectId: "acme",
        taskId: "review",
        committedAt: 8,
      }),
    );

    const lines = read(state, "day-task");
    expect(lines.sections.at(-1)).toEqual({
      localDate: "2026-10-14",
      lines: [{ ...review, hours: 1, comments: "", entryIds: ["today"] }],
    });
    expect(lines.running).toEqual({
      timerId: "timer-1",
      date: "2026-10-14",
      unsavedMinutes: 15,
      entryId: "today",
      projectId: "acme",
      projectName: "Acme",
      projectCode: "ACME-1",
      taskId: "review",
      taskName: "Review",
    });
  });

  it("groups the week by task in one section without a date", () => {
    const { sections } = read(weekState(), "task");

    expect(sections).toHaveLength(1);
    expect(sections[0]).not.toHaveProperty("localDate");
    expect(
      sections[0]!.lines.map((line) => [line.taskName, line.hours]),
    ).toEqual([
      ["07 Run", 3.5],
      ["Review", 0.75],
    ]);
  });

  it("keeps local, Not known yet and running time out of every line", () => {
    for (const groupBy of ["day-task", "day", "task"] as const) {
      const ids = read(weekState(), groupBy).sections.flatMap((section) =>
        section.lines.flatMap((line) => line.entryIds),
      );
      expect(ids.sort()).toEqual(["a1", "a2", "a3", "a4"]);
    }
  });

  it("names a mapped task by its own name without a plugin that maps it", () => {
    const names = read(
      weekState(),
      "task",
      NO_PROPERTY_PLUGINS,
    ).sections[0]!.lines.map((line) => line.taskName);

    expect(names).toEqual(["Build", "Review"]);
  });

  it("reads a submitted week, and says it is", () => {
    const state = {
      ...weekState(),
      lockedWeeks: [{ weekOf: "2026-10-12", lockedAt: 1 }],
    };

    const lines = read(state, "day-task");
    expect(lines.locked).toBe(true);
    expect(lines.sections).toHaveLength(2);
  });

  it("leaves out a running entry of another week", () => {
    const state = weekState();
    state.timers[0]!.localDate = "2026-10-20";

    expect(read(state, "day-task").running).toBeNull();
  });

  it("returns no sections and zero totals for an empty week", () => {
    const state = { ...weekState(), timesheetEntries: [], timers: [] };

    expect(read(state, "day")).toMatchObject({
      sections: [],
      notSent: { hours: 0, items: [] },
      waiting: { hours: 0, tasks: [] },
      running: null,
    });
  });
});

describe("agent reads for the terminal", () => {
  const ID_A = "timesheet_3f2a9c1e-7b4d-4e8a-9c0b-1d2e3f4a5b6c";
  const ID_B = "timesheet_3f2a0000-1111-4222-8333-444455556666";
  const TIMER_ID = "timer_9d8c7b6a-5f4e-4d3c-8b2a-190817263544";
  const workdayTask = {
    pluginId: "workday-agent",
    capability: {
      section: "Workday",
      fields: [
        { id: "task", label: "Workday task", defaultFrom: "name" as const },
      ],
    },
  };

  /** Entries with real ids, years apart, and a running entry with one. */
  function stateWithUuidIds(): LocalAppState {
    const state = createState();
    return {
      ...state,
      timers: [{ ...state.timers[0]!, _id: TIMER_ID }],
      timesheetEntries: [
        entry({ _id: ID_A, localDate: "2024-03-04" }),
        entry({ _id: ID_B, localDate: "2026-10-13" }),
        entry({ _id: "e-legacy" }),
      ],
    };
  }

  it("gives one target per day of the range, from the weekday targets", () => {
    const state = createState();
    state.userPreferences.weeklyCapacityTargets = {
      ...state.userPreferences.weeklyCapacityTargets,
      monday: 7.5 * HOUR,
      saturday: 2 * HOUR,
    };

    expect(
      listTimeEntriesForAgent(state, { from: WEEK[0]!, to: WEEK[6]! }, NOW)
        .targets,
    ).toEqual([
      { date: "2026-10-12", hours: 7.5 },
      { date: "2026-10-13", hours: 8 },
      { date: "2026-10-14", hours: 8 },
      { date: "2026-10-15", hours: 8 },
      { date: "2026-10-16", hours: 8 },
      { date: "2026-10-17", hours: 2 },
      { date: "2026-10-18", hours: 0 },
    ]);
    expect(
      listTimeEntriesForAgent(
        state,
        { from: "2026-10-17", to: "2026-10-19" },
        NOW,
      ).targets,
    ).toEqual([
      { date: "2026-10-17", hours: 2 },
      { date: "2026-10-18", hours: 0 },
      { date: "2026-10-19", hours: 7.5 },
    ]);
  });

  it("gives every entry and the running entry a short id", () => {
    const state = stateWithUuidIds();
    const result = listTimeEntriesForAgent(
      state,
      { from: "2024-03-04", to: "2024-03-04" },
      NOW,
    );
    expect(result.entries.map((item) => item.shortId)).toEqual([
      "3f2a9c1e7b4d4e8a9c0b1d2e3f4a5b6c",
    ]);
    expect(readRunningTimer(state, NOW)?.shortId).toBe(
      "9d8c7b6a5f4e4d3c8b2a190817263544",
    );
    expect(toAgentEntry(state, state.timesheetEntries[2]!).shortId).toBe(
      "e-legacy",
    );
  });

  it("gives a running entry that continues a saved one the saved one's short id", () => {
    const state = stateWithUuidIds();
    state.timers[0] = { ...state.timers[0]!, entryId: ID_B };
    expect(readRunningTimer(state, NOW)?.shortId).toBe(
      "3f2a0000111142228333444455556666",
    );
  });

  it("finds one entry for a unique prefix, on any day", () => {
    const result = findEntriesForAgent(
      stateWithUuidIds(),
      { idPrefix: "3f2a9" },
      NOW,
    );
    expect(result.entries.map((item) => [item.entryId, item.date])).toEqual([
      [ID_A, "2024-03-04"],
    ]);
    expect(result.entries[0]).toMatchObject({
      shortId: "3f2a9c1e7b4d4e8a9c0b1d2e3f4a5b6c",
      state: "saved",
      minutes: 60,
      projectName: "Acme",
      taskName: "Build",
    });
    expect(result.running).toBeNull();
  });

  it("finds every entry that shares a prefix, oldest day first, and none for an unknown one", () => {
    const state = stateWithUuidIds();
    expect(
      findEntriesForAgent(state, { idPrefix: "3f2a" }, NOW).entries.map(
        (item) => item.entryId,
      ),
    ).toEqual([ID_A, ID_B]);
    expect(findEntriesForAgent(state, { idPrefix: "beef" }, NOW)).toEqual({
      entries: [],
      running: null,
    });
  });

  it("finds the running entry when its short id matches", () => {
    const result = findEntriesForAgent(
      stateWithUuidIds(),
      { idPrefix: "9d8c7b" },
      NOW,
    );
    expect(result.entries).toEqual([]);
    expect(result.running).toMatchObject({
      timerId: TIMER_ID,
      shortId: "9d8c7b6a5f4e4d3c8b2a190817263544",
    });
  });

  it("lists each project's full and display names, and whether it is local only", () => {
    const state = createState();
    state.projects[0] = {
      ...state.projects[0]!,
      name: "Acme Corporation",
      displayName: "Acme",
      localOnly: true,
    };
    expect(
      listProjectsForAgent(state, NO_PROPERTY_PLUGINS).projects[0],
    ).toMatchObject({
      name: "Acme",
      fullName: "Acme Corporation",
      displayName: "Acme",
      localOnly: true,
    });
  });

  it("lists each task's pinned slot and the four kinds of commit-as", () => {
    const state = createState();
    const tasks = state.projects[0]!.tasks;
    state.projects[0]!.tasks = [
      { ...tasks[0]!, pinnedSlot: "1" },
      {
        _id: "task-run",
        name: "Run",
        status: "active",
        createdAt: 1,
        pinnedSlot: "0",
        pluginProperties: { "workday-agent": { task: "07 Run" } },
      },
      {
        _id: "task-new",
        name: "Discovery",
        status: "active",
        createdAt: 1,
        commitAs: "waiting",
      },
      {
        _id: "task-mine",
        name: "Learning",
        status: "active",
        createdAt: 1,
        commitAs: "local",
      },
    ];

    expect(
      listProjectsForAgent(state, { projects: [], tasks: [workdayTask] })
        .projects[0]!.tasks,
    ).toEqual([
      {
        taskId: "task-1",
        name: "Build",
        pinnedSlot: 1,
        commitsAs: { kind: "own" },
      },
      {
        taskId: "task-run",
        name: "Run",
        pinnedSlot: 10,
        commitsAs: { kind: "task", name: "07 Run" },
      },
      {
        taskId: "task-new",
        name: "Discovery",
        commitsAs: { kind: "not-known-yet" },
      },
      {
        taskId: "task-mine",
        name: "Learning",
        commitsAs: { kind: "local-only" },
      },
    ]);
  });

  it("commits every task of a local only project as local only", () => {
    const state = createState();
    state.projects[0] = { ...state.projects[0]!, localOnly: true };
    state.projects[0].tasks[0]!.pluginProperties = {
      "workday-agent": { task: "07 Run" },
    };
    expect(
      listProjectsForAgent(state, { projects: [], tasks: [workdayTask] })
        .projects[0]!.tasks[0]!.commitsAs,
    ).toEqual({ kind: "local-only" });
  });
});
