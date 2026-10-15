import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalTimesheetEntry } from "@/domain/local-state";
import {
  getSubmitLinesForAgent,
  getWorkItemForAgent,
  listProjectsForAgent,
  listTimeEntriesForAgent,
  listWorkItemsForAgent,
  readRunningTimer,
} from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import { submitLineId } from "@/domain/agents/submit-line-id";

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
      entry({ _id: "e2", note: "Afternoon", committedAt: 10, submittedAt: 5 }),
      entry({ _id: "e3", localDate: "2026-10-20" }),
    ],
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
      ["e2", "submitted"],
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

  it("builds the week's submit lines in decimal hours", () => {
    const result = getSubmitLinesForAgent(createState(), {
      weekDates: WEEK,
      groupBy: "day-task",
      onlyUnsubmitted: false,
      today: "2026-10-14",
      paceTolerancePercent: 20,
      projectPropertyPlugins: [],
    });
    expect(result.sections).toEqual([
      {
        date: "2026-10-13",
        lines: [
          expect.objectContaining({
            projectName: "Acme",
            taskName: "Build",
            hours: 2,
            comments: "Morning | Afternoon",
          }),
        ],
      },
    ]);
    expect(result.summary.targetHours).toBe(40);
    // 2 h logged by Wednesday, when 24 h of the 40 h target is expected.
    expect(result.pace).toEqual({
      loggedHours: 2,
      targetHours: 40,
      expectedHours: 24,
      status: "under",
    });
  });

  it("gives each submit line a stable ID and its project code", () => {
    const result = getSubmitLinesForAgent(stateWithCodedProject(), {
      weekDates: WEEK,
      groupBy: "day-task",
      onlyUnsubmitted: true,
      today: "2026-10-14",
      paceTolerancePercent: 20,
      projectPropertyPlugins: [],
    });
    const line = result.sections[0]!.lines[0]!;
    expect(line.lineId).toBe(submitLineId(line.entryIds));
    expect(line.projectCode).toBe("ACME-1");
  });

  it("sends the full name and resolved plugin properties of active plugins", () => {
    const state = stateWithCodedProject();
    state.projects[0]!.pluginProperties = {
      "workday-agent": { name: "CA004 Tech & Design" },
      inactive: { other: "hidden" },
    };
    const result = getSubmitLinesForAgent(state, {
      weekDates: WEEK,
      groupBy: "day-task",
      onlyUnsubmitted: true,
      today: "2026-10-14",
      paceTolerancePercent: 20,
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
    });
    const line = result.sections[0]!.lines[0]!;
    expect(line.projectFullName).toBe("Acme");
    expect(line.projectProperties).toEqual({
      "workday-agent": { name: "CA004 Tech & Design", code: "ACME-1" },
    });
  });

  it("sends no plugin properties when no plugin adds any", () => {
    const result = getSubmitLinesForAgent(stateWithCodedProject(), {
      weekDates: WEEK,
      groupBy: "day-task",
      onlyUnsubmitted: true,
      today: "2026-10-14",
      paceTolerancePercent: 20,
      projectPropertyPlugins: [],
    });
    const line = result.sections[0]!.lines[0]!;
    expect(line.projectFullName).toBe("Acme");
    expect(line).not.toHaveProperty("projectProperties");
  });
});
