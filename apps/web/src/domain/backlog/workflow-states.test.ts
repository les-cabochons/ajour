import { describe, expect, it } from "vitest";
import {
  moveBacklogItemToState,
  restoreBacklogItem,
} from "@/domain/backlog/backlog-item-lifecycle";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  addWorkflowState,
  deleteWorkflowState,
  moveWorkflowState,
  normalizeWorkflowStates,
  setWorkflowStateMapping,
  updateWorkflowState,
} from "@/domain/backlog/workflow-states";

function createState(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    user: {
      _id: "local-user",
      name: "Local User",
      email: "local@example.com",
    },
    projects: [],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [],
    timesheetImportDrafts: [],
    workItems: [],
    workflowStates: [],
    workflowStateMappings: [],
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

function createImportedWorkItem(
  overrides: Partial<LocalWorkItem> = {},
): LocalWorkItem {
  return {
    _id: "work-item-1",
    title: "Imported task",
    status: "active",
    source: "azure_devops",
    sourceId: "42",
    sourceConnectionId: "connection-1",
    sourceStatusKey: "active",
    createdAt: 1,
    ...overrides,
  };
}

describe("workflow state normalization", () => {
  it("hydrates names, colors, and timestamps for legacy records", () => {
    expect(
      normalizeWorkflowStates(
        [
          {
            _id: "status-1",
            name: "  In   Progress ",
          },
        ],
        () => 100,
      ),
    ).toEqual([
      {
        _id: "status-1",
        name: "In Progress",
        color: "#64748b",
        createdAt: 100,
      },
      {
        _id: "workflow_state_done",
        name: "Done",
        color: "#059669",
        done: true,
        createdAt: 100,
      },
    ]);
  });

  it("starts an empty workflow with the default states", () => {
    expect(
      normalizeWorkflowStates([], () => 100).map((state) => [
        state.name,
        state.done === true,
      ]),
    ).toEqual([
      ["To do", false],
      ["In progress", false],
      ["In review", false],
      ["Done", true],
    ]);
  });

  it("keeps the done flag of persisted states", () => {
    const states = normalizeWorkflowStates(
      [
        { _id: "a", name: "Doing" },
        { _id: "b", name: "Shipped", done: true },
      ],
      () => 100,
    );

    expect(states.map((state) => state._id)).toEqual(["a", "b"]);
    expect(states[1]?.done).toBe(true);
  });
});

describe("the done flag", () => {
  const workflow = () =>
    createState({
      workflowStates: [
        { _id: "todo", name: "To do", color: "#64748b", createdAt: 1 },
        {
          _id: "done",
          name: "Done",
          color: "#059669",
          done: true,
          createdAt: 1,
        },
      ],
    });

  it("refuses to delete the last done state", () => {
    expect(() => deleteWorkflowState(workflow(), "done")).toThrow(
      "The workflow needs at least one done state.",
    );
  });

  it("restores the pre-close state after deleting the occupied done state", () => {
    const state = createState({
      ...workflow(),
      workflowStates: [
        ...workflow().workflowStates,
        {
          _id: "shipped",
          name: "Shipped",
          color: "#059669",
          done: true,
          createdAt: 1,
        },
      ],
      workItems: [createImportedWorkItem({ workflowStateId: "todo" })],
    });
    const closed = moveBacklogItemToState(state, "work-item-1", "done", {
      createId: () => "entry",
      now: () => 500,
    });
    const deleted = deleteWorkflowState(closed, "done");
    expect(deleted.workItems[0]).toMatchObject({
      status: "archived",
      workflowStateId: "shipped",
      workflowStateIdBeforeClose: "todo",
    });
    expect(
      restoreBacklogItem(deleted, "work-item-1").workItems[0],
    ).toMatchObject({
      status: "active",
      workflowStateId: "todo",
      workflowStateIdBeforeClose: undefined,
    });
  });

  it("refuses to clear the done flag of the last done state", () => {
    expect(() =>
      updateWorkflowState(workflow(), "done", { name: "Done", done: false }),
    ).toThrow("The workflow needs at least one done state.");
  });

  it("lets another state become done, then the first one stop being done", () => {
    const twoDone = updateWorkflowState(workflow(), "todo", {
      name: "To do",
      done: true,
    });
    const next = updateWorkflowState(twoDone, "done", {
      name: "Done",
      done: false,
    });

    expect(next.workflowStates.map((state) => state.done === true)).toEqual([
      true,
      false,
    ]);
  });

  it("clears a deleted state from where closed items came from", () => {
    const state = {
      ...workflow(),
      workflowStates: [
        ...workflow().workflowStates,
        { _id: "doing", name: "Doing", color: "#d97706", createdAt: 1 },
      ],
      workItems: [
        {
          _id: "a",
          title: "A",
          status: "archived" as const,
          source: "manual" as const,
          createdAt: 1,
          workflowStateId: "done",
          workflowStateIdBeforeClose: "doing",
        },
      ],
    };

    expect(
      deleteWorkflowState(state, "doing").workItems[0]
        ?.workflowStateIdBeforeClose,
    ).toBeUndefined();
  });

  it("keeps archived items in their done state when a mapping changes", () => {
    const state = {
      ...workflow(),
      workItems: [
        {
          _id: "a",
          title: "A",
          status: "archived" as const,
          source: "azure_devops" as const,
          sourceConnectionId: "c1",
          sourceStatusKey: "closed",
          createdAt: 1,
          workflowStateId: "done",
          importedWorkflowStateId: "done",
        },
      ],
    };

    const next = setWorkflowStateMapping(state, {
      source: "azure_devops",
      connectionId: "c1",
      sourceStatusKey: "closed",
      workflowStateId: "todo",
    });
    expect(next.workItems[0]).toMatchObject({
      workflowStateId: "done",
      importedWorkflowStateId: "todo",
    });
  });

  it("moves a state up and down, and stops at the ends", () => {
    const moved = moveWorkflowState(workflow(), "done", -1);
    expect(moved.workflowStates.map((state) => state._id)).toEqual([
      "done",
      "todo",
    ]);
    expect(moveWorkflowState(moved, "done", -1)).toBe(moved);
  });
});

describe("workflow state operations", () => {
  it("adds and updates a status with normalized values", () => {
    const added = addWorkflowState(
      createState(),
      "  In   Progress ",
      "#ABCDEF",
      {
        createId: () => "status-1",
        now: () => 100,
      },
    );
    const updated = updateWorkflowState(added.state, added.result, "Ready");

    expect(added.result).toBe("status-1");
    expect(updated.workflowStates).toEqual([
      {
        _id: "status-1",
        name: "Ready",
        color: "#abcdef",
        createdAt: 100,
      },
    ]);
  });

  it("reconciles imported mappings while preserving local overrides", () => {
    const statuses = [
      {
        _id: "status-active",
        name: "Active",
        color: "#2563eb",
        createdAt: 1,
      },
      {
        _id: "status-local",
        name: "Local",
        color: "#059669",
        createdAt: 2,
      },
    ];
    const mapped = setWorkflowStateMapping(
      createState({
        workflowStates: statuses,
        workItems: [createImportedWorkItem()],
      }),
      {
        source: "azure_devops",
        connectionId: "connection-1",
        sourceStatusKey: " Active ",
        workflowStateId: "status-active",
      },
    );

    expect(mapped.workItems[0]).toMatchObject({
      workflowStateId: "status-active",
      importedWorkflowStateId: "status-active",
    });

    const deleted = deleteWorkflowState(
      {
        ...mapped,
        workItems: [
          {
            ...mapped.workItems[0]!,
            workflowStateId: "status-local",
          },
        ],
      },
      "status-active",
    );

    expect(deleted.workflowStateMappings).toEqual([]);
    expect(deleted.workItems[0]).toMatchObject({
      workflowStateId: "status-local",
      importedWorkflowStateId: undefined,
    });
  });
});
