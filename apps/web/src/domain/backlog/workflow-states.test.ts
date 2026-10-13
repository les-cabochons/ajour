import { describe, expect, it } from "vitest";
import {
  failSourceWrite,
  moveBacklogItemToState,
  restoreBacklogItem,
  settleBacklogItem,
} from "@/domain/backlog/backlog-item-lifecycle";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  addWorkflowState,
  deleteWorkflowState,
  findMappedWorkflowStateId,
  getSourceStatesMappedTo,
  moveWorkflowState,
  normalizeWorkflowStates,
  planWorkflowStateWrite,
  setWorkflowStateWriteRule,
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
    workflowStateWriteRules: [],
    priorityScales: [],
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

  it("preserves parent and carried subitem restores when clearing their done flag", () => {
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
      workItems: [
        createImportedWorkItem({ workflowStateId: "todo" }),
        createImportedWorkItem({
          _id: "child",
          sourceId: "43",
          parentWorkItemId: "work-item-1",
          workflowStateId: "todo",
        }),
        createImportedWorkItem({
          _id: "active",
          sourceId: "44",
          workflowStateId: "done",
        }),
      ],
    });
    const closed = moveBacklogItemToState(
      state,
      "work-item-1",
      "done",
      {
        createId: () => "entry",
        now: () => 500,
      },
      { includeSubitems: true },
    );
    const updated = updateWorkflowState(closed, "done", {
      name: "Done",
      done: false,
    });
    for (const id of ["work-item-1", "child"]) {
      expect(updated.workItems.find((item) => item._id === id)).toMatchObject({
        status: "archived",
        workflowStateId: "shipped",
        workflowStateIdBeforeClose: "todo",
        archivedAt: 500,
      });
    }
    expect(updated.workItems.find((item) => item._id === "active")).toBe(
      closed.workItems[2],
    );
    const restored = restoreBacklogItem(updated, "work-item-1");
    for (const id of ["work-item-1", "child"]) {
      expect(restored.workItems.find((item) => item._id === id)).toMatchObject({
        status: "active",
        workflowStateId: "todo",
        workflowStateIdBeforeClose: undefined,
        settledWithParentId: undefined,
      });
    }
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

  it.each(["todo", "doing"])(
    "does not restore deleted rollback states after a failed settle from %s",
    (workflowStateId) => {
      const state = createState({
        ...workflow(),
        workflowStates: [
          ...workflow().workflowStates,
          { _id: "doing", name: "Doing", color: "#d97706", createdAt: 1 },
        ],
        workItems: [
          createImportedWorkItem({
            workflowStateId,
            importedWorkflowStateId: "todo",
          }),
        ],
      });
      const settled = settleBacklogItem(
        state,
        "work-item-1",
        { createId: (prefix) => prefix, now: () => 100 },
        { state: { name: "Waiting", done: false } },
      );
      const deleted = deleteWorkflowState(settled, "todo");
      const reloaded = JSON.parse(JSON.stringify(deleted)) as LocalAppState;
      const restored = failSourceWrite(reloaded, "work-item-1").workItems[0]!;
      expect(restored.status).toBe("active");
      expect(restored.workflowStateId).toBe(
        workflowStateId === "todo" ? undefined : "doing",
      );
      expect(restored.importedWorkflowStateId).toBeUndefined();
      expect(restored.pendingSourceWrite).toBeUndefined();
    },
  );

  it.each([
    {
      change: "deleting an open state",
      deletedStateId: "todo",
      clearDone: false,
    },
    { change: "deleting Done", deletedStateId: "done", clearDone: false },
    { change: "clearing Done", deletedStateId: "done", clearDone: true },
  ])(
    "recovers carried children after $change during a pending close",
    ({ deletedStateId, clearDone }) => {
      const state = createState({
        ...workflow(),
        workflowStates: [
          ...workflow().workflowStates,
          {
            _id: "done2",
            name: "Other done",
            done: true,
            color: "#000000",
            createdAt: 1,
          },
        ],
        workItems: [
          createImportedWorkItem({
            workflowStateId: "todo",
            importedWorkflowStateId: "todo",
          }),
          createImportedWorkItem({
            _id: "child",
            source: "manual",
            parentWorkItemId: "work-item-1",
            workflowStateId: "todo",
          }),
        ],
      });
      const moved = moveBacklogItemToState(
        state,
        "work-item-1",
        "done",
        {
          createId: (prefix) => prefix,
          now: () => 100,
        },
        { includeSubitems: true, sourceWrites: { "work-item-1": "Closed" } },
      );
      const deleted = clearDone
        ? updateWorkflowState(moved, deletedStateId, {
            name: "Done",
            done: false,
          })
        : deleteWorkflowState(moved, deletedStateId);
      expect(deleted.workItems[1]?.workflowStateId).toBe(
        deletedStateId === "done" ? "done2" : "done",
      );
      const reloaded = JSON.parse(JSON.stringify(deleted)) as LocalAppState;
      const recovered = failSourceWrite(reloaded, "work-item-1");
      expect(recovered.workItems.map((item) => item.status)).toEqual([
        "active",
        "active",
      ]);
      for (const item of recovered.workItems) {
        expect(item.workflowStateId).toBe(
          deletedStateId === "todo" ? undefined : "todo",
        );
        expect(item.workflowStateIdBeforeClose).toBeUndefined();
      }
    },
  );

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

describe("source state mappings per source project", () => {
  const mapping = (
    sourceStatusKey: string,
    workflowStateId: string,
    sourceProjectName?: string,
  ) => ({
    source: "azure_devops" as const,
    connectionId: "c1",
    sourceStatusKey,
    sourceStatusLabel:
      sourceStatusKey[0]!.toUpperCase() + sourceStatusKey.slice(1),
    workflowStateId,
    ...(sourceProjectName ? { sourceProjectName } : {}),
  });
  const item = {
    source: "azure_devops" as const,
    sourceId: "s1",
    sourceConnectionId: "c1",
    sourceProjectName: "Mercury",
  };

  it("prefers the project's own mapping over the connection's", () => {
    const mappings = [
      mapping("resolved", "review"),
      mapping("resolved", "done", "Mercury"),
    ];

    expect(
      findMappedWorkflowStateId(
        mappings,
        "azure_devops",
        "c1",
        "resolved",
        "Mercury",
      ),
    ).toBe("done");
    expect(
      findMappedWorkflowStateId(
        mappings,
        "azure_devops",
        "c1",
        "resolved",
        "Venus",
      ),
    ).toBe("review");
  });

  it("writes the first mapped source state unless a rule says otherwise", () => {
    const state = createState({
      workflowStateMappings: [
        mapping("resolved", "review"),
        mapping("in qa", "review"),
      ],
    });

    expect(
      planWorkflowStateWrite(state, item, "review", ["Resolved", "In qa"]),
    ).toEqual({
      kind: "write",
      sourceStatusLabel: "Resolved",
    });
    expect(
      planWorkflowStateWrite(state, item, "todo", ["Resolved", "In qa"]),
    ).toEqual({
      kind: "none",
    });
    expect(
      planWorkflowStateWrite(
        state,
        { ...item, source: "manual" },
        "review",
        [],
      ),
    ).toEqual({ kind: "none" });

    const asks = setWorkflowStateWriteRule(state, {
      source: "azure_devops",
      connectionId: "c1",
      workflowStateId: "review",
      write: { kind: "ask" },
    });
    expect(
      planWorkflowStateWrite(asks, item, "review", ["Resolved", "In qa"]),
    ).toEqual({
      kind: "ask",
      sourceStatusLabels: ["Resolved", "In qa"],
    });

    const silent = setWorkflowStateWriteRule(asks, {
      source: "azure_devops",
      connectionId: "c1",
      sourceProjectName: "Mercury",
      workflowStateId: "review",
      write: { kind: "none" },
    });
    expect(
      planWorkflowStateWrite(silent, item, "review", ["Resolved", "In qa"]),
    ).toEqual({
      kind: "none",
    });
    expect(
      planWorkflowStateWrite(
        silent,
        { ...item, sourceProjectName: "Venus" },
        "review",
        ["Resolved", "In qa"],
      ).kind,
    ).toBe("ask");
  });

  it("restricts default, Ask and explicit writes to the item's available states", () => {
    const state = createState({
      workflowStateMappings: [
        mapping("resolved", "review"),
        mapping("in qa", "review"),
        mapping("approved", "review", "Venus"),
      ],
    });
    const available = ["In QA"];
    expect(planWorkflowStateWrite(state, item, "review", available)).toEqual({
      kind: "write",
      sourceStatusLabel: "In qa",
    });
    const asks = setWorkflowStateWriteRule(state, {
      source: "azure_devops",
      connectionId: "c1",
      workflowStateId: "review",
      write: { kind: "ask" },
    });
    expect(planWorkflowStateWrite(asks, item, "review", available)).toEqual({
      kind: "write",
      sourceStatusLabel: "In qa",
    });
    expect(planWorkflowStateWrite(asks, item, "review", [])).toEqual({
      kind: "none",
    });
    const explicit = setWorkflowStateWriteRule(state, {
      source: "azure_devops",
      connectionId: "c1",
      workflowStateId: "review",
      write: { kind: "state", sourceStatusLabel: "Resolved" },
    });
    expect(planWorkflowStateWrite(explicit, item, "review", available)).toEqual(
      { kind: "none" },
    );
    expect(
      getSourceStatesMappedTo(
        state.workflowStateMappings,
        {
          source: item.source,
          connectionId: item.sourceConnectionId,
          sourceProjectName: item.sourceProjectName,
        },
        "review",
        available,
      ),
    ).toEqual([{ key: "in qa", label: "In qa" }]);
  });
});

it("distinguishes a project-level No state override from inheritance", () => {
  const state = createState({
    workflowStates: [
      { _id: "review", name: "In review", color: "#000000", createdAt: 1 },
    ],
    workflowStateMappings: [
      {
        source: "azure_devops",
        connectionId: "c",
        sourceStatusKey: "resolved",
        workflowStateId: "review",
      },
    ],
  });
  const key = {
    source: "azure_devops" as const,
    connectionId: "c",
    sourceStatusKey: "resolved",
    sourceProjectName: "Mercury",
  };
  const unmapped = setWorkflowStateMapping(state, {
    ...key,
    workflowStateId: null,
  });
  expect(
    findMappedWorkflowStateId(
      unmapped.workflowStateMappings,
      "azure_devops",
      "c",
      "resolved",
      "Mercury",
    ),
  ).toBeUndefined();
  expect(
    findMappedWorkflowStateId(
      unmapped.workflowStateMappings,
      "azure_devops",
      "c",
      "resolved",
      "Venus",
    ),
  ).toBe("review");
  const inherited = setWorkflowStateMapping(unmapped, {
    ...key,
    workflowStateId: undefined,
  });
  expect(
    findMappedWorkflowStateId(
      inherited.workflowStateMappings,
      "azure_devops",
      "c",
      "resolved",
      "Mercury",
    ),
  ).toBe("review");
});

it("does not write a source state remapped away from the destination", () => {
  const state = createState({
    workflowStates: [
      { _id: "review", name: "In review", color: "#000000", createdAt: 1 },
      { _id: "doing", name: "In progress", color: "#000000", createdAt: 1 },
    ],
    workflowStateMappings: [
      {
        source: "azure_devops",
        connectionId: "c",
        sourceStatusKey: "resolved",
        sourceStatusLabel: "Resolved",
        workflowStateId: "review",
      },
    ],
    workflowStateWriteRules: [
      {
        source: "azure_devops",
        connectionId: "c",
        workflowStateId: "review",
        write: { kind: "state", sourceStatusLabel: "Resolved" },
      },
    ],
  });
  const item = {
    source: "azure_devops" as const,
    sourceId: "1",
    sourceConnectionId: "c",
  };
  const remapped = setWorkflowStateMapping(state, {
    source: "azure_devops",
    connectionId: "c",
    sourceStatusKey: "resolved",
    sourceStatusLabel: "Resolved",
    workflowStateId: "doing",
  });
  expect(remapped.workflowStateWriteRules).toEqual([]);
  expect(
    planWorkflowStateWrite(remapped, item, "review", ["Resolved"]),
  ).toEqual({
    kind: "none",
  });
  const projectOverride = setWorkflowStateMapping(state, {
    source: "azure_devops",
    connectionId: "c",
    sourceProjectName: "Mercury",
    sourceStatusKey: "resolved",
    sourceStatusLabel: "Resolved",
    workflowStateId: "doing",
  });
  expect(
    planWorkflowStateWrite(
      projectOverride,
      { ...item, sourceProjectName: "Mercury" },
      "review",
      ["Resolved"],
    ),
  ).toEqual({ kind: "none" });
});
