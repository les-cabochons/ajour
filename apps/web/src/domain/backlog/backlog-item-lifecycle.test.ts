import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  applyWorkflowStateLifecycle,
  archiveBacklogItem,
  changeBacklogItemSourceState,
  completeSourceWrite,
  failSourceWrite,
  isBacklogItemReturned,
  isBacklogItemSnoozed,
  markBacklogItemOpened,
  moveBacklogItemToState,
  restoreBacklogItem,
  selectSidebarBacklogItems,
  settleBacklogItem,
  snoozeBacklogItem,
  unsettleBacklogItem,
  unsnoozeBacklogItem,
} from "@/domain/backlog/backlog-item-lifecycle";
import { updateWorkflowState } from "@/domain/backlog/workflow-states";

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

function item(
  id: string,
  overrides: Partial<LocalWorkItem> = {},
): LocalWorkItem {
  return {
    _id: id,
    title: `Item ${id}`,
    status: "active",
    source: "manual",
    createdAt: 1,
    ...overrides,
  };
}

function synced(
  id: string,
  overrides: Partial<LocalWorkItem> = {},
): LocalWorkItem {
  return item(id, {
    source: "azure_devops",
    sourceId: `source-${id}`,
    sourceConnectionId: "connection-1",
    sourceStatusKey: "active",
    sourceStatusLabel: "Active",
    ...overrides,
  });
}

const factories = {
  createId: (prefix: string) => `${prefix}-1`,
  now: () => 1_000,
};

function find(state: LocalAppState, id: string) {
  return state.workItems.find((workItem) => workItem._id === id);
}

describe("enabling Done on an occupied workflow state", () => {
  it.each(["archived", "settled", "active"] as const)(
    "closes a reactivated or legacy %s item without a workflow change",
    (status) => {
      const previous = createState({
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
        workItems: [
          item("a", {
            status,
            workflowStateId: "done",
            workflowStateIdBeforeClose:
              status === "archived" ? "todo" : undefined,
          }),
        ],
      });
      const next = {
        ...previous,
        workItems: [
          {
            ...previous.workItems[0]!,
            status: "active" as const,
            returnedAt: 500,
          },
        ],
      };
      const closed = applyWorkflowStateLifecycle(previous, next, factories);
      expect(find(closed, "a")).toMatchObject({
        status: "archived",
        workflowStateId: "done",
        archivedAt: 1000,
      });
      expect(find(restoreBacklogItem(closed, "a"), "a")).toMatchObject({
        status: "active",
        workflowStateId: status === "archived" ? "todo" : undefined,
      });
    },
  );
  it.each(["active", "settled"] as const)(
    "closes %s items, saves their running entry and preserves other items",
    (status) => {
      const state = createState({
        workflowStates: [
          { _id: "doing", name: "Doing", color: "#d97706", createdAt: 1 },
          { _id: "todo", name: "To do", color: "#64748b", createdAt: 1 },
          {
            _id: "done",
            name: "Done",
            color: "#059669",
            done: true,
            createdAt: 1,
          },
        ],
        workItems: [
          synced("a", {
            workflowStateId: "doing",
            status,
            settledAt: status === "settled" ? 200 : undefined,
          }),
          item("other", { workflowStateId: "todo" }),
          item("archived", {
            status: "archived",
            archivedAt: 100,
            workflowStateId: "done",
            workflowStateIdBeforeClose: "doing",
          }),
        ],
        timers: [
          {
            _id: "timer-a",
            workItemId: "a",
            startedAt: 400,
            accumulatedDurationMs: 0,
            localDate: "2026-10-12",
          },
        ],
      });
      const changed = updateWorkflowState(state, "doing", {
        name: "Doing",
        done: true,
      });
      const closed = applyWorkflowStateLifecycle(state, changed, factories);
      expect(find(closed, "a")).toMatchObject({
        status: "archived",
        archivedAt: 1000,
        workflowStateId: "doing",
        workflowStateIdBeforeClose: undefined,
        settledAt: undefined,
      });
      expect(closed.timers).toEqual([]);
      expect(closed.timesheetEntries).toEqual([
        expect.objectContaining({ workItemId: "a", durationMs: 600 }),
      ]);
      expect(find(closed, "other")).toBe(state.workItems[1]);
      expect(find(closed, "archived")).toBe(state.workItems[2]);
      expect(find(restoreBacklogItem(closed, "a"), "a")).toMatchObject({
        status: "active",
        workflowStateId: undefined,
      });
      expect(
        find(restoreBacklogItem(closed, "archived"), "archived"),
      ).toMatchObject({
        status: "active",
        workflowStateId: undefined,
        workflowStateIdBeforeClose: undefined,
      });
      expect(applyWorkflowStateLifecycle(closed, closed, factories)).toBe(
        closed,
      );
    },
  );
});

describe("settling a backlog item", () => {
  it("archives a manual item", () => {
    const state = createState({ workItems: [item("a")] });

    const next = settleBacklogItem(state, "a", factories);

    expect(find(next, "a")).toMatchObject({
      status: "archived",
      archivedAt: 1_000,
    });
  });

  it("settles a synced item and remembers its source state and priority", () => {
    const state = createState({
      workItems: [synced("a", { importedPriority: 2, priority: 2 })],
    });

    const next = settleBacklogItem(state, "a", factories);

    expect(find(next, "a")).toMatchObject({
      status: "settled",
      settledAt: 1_000,
      settledSourceStatusKey: "active",
      settledImportedPriority: 2,
    });
  });

  it("carries its active subitems only when asked", () => {
    const state = createState({
      workItems: [
        synced("parent"),
        synced("follows", {
          parentSourceId: "source-parent",
          hierarchyLevel: 1,
        }),
        synced("own", {
          parentSourceId: "source-parent",
          hierarchyLevel: 1,
          priority: 1,
        }),
      ],
    });

    const alone = settleBacklogItem(state, "parent", factories);
    expect(find(alone, "follows")?.status).toBe("active");
    expect(find(alone, "own")?.status).toBe("active");

    const next = settleBacklogItem(state, "parent", factories, undefined, {
      includeSubitems: true,
    });
    expect(find(next, "follows")).toMatchObject({
      status: "settled",
      settledWithParentId: "parent",
    });
    expect(find(next, "own")).toMatchObject({
      status: "settled",
      settledWithParentId: "parent",
    });
  });

  it("stops and saves the running entry on the item", () => {
    const state = createState({
      workItems: [item("a")],
      timers: [
        {
          _id: "timer-1",
          startedAt: 400,
          localDate: "2026-10-11",
          workItemId: "a",
          accumulatedDurationMs: 0,
        },
      ],
    });

    const next = settleBacklogItem(state, "a", factories);

    expect(next.timers).toEqual([]);
    expect(next.timesheetEntries).toEqual([
      expect.objectContaining({ workItemId: "a", durationMs: 600 }),
    ]);
  });
});

describe("settling with a change to the source", () => {
  const state = () =>
    createState({
      workflowStates: [
        {
          _id: "done",
          name: "Done",
          done: true,
          color: "#000000",
          createdAt: 1,
        },
      ],
      workflowStateMappings: [
        {
          source: "azure_devops",
          connectionId: "connection-1",
          sourceStatusKey: "closed",
          workflowStateId: "done",
        },
      ],
      workItems: [
        synced("parent", { importedPriority: 2, priority: 2 }),
        synced("follows", {
          parentSourceId: "source-parent",
          hierarchyLevel: 1,
        }),
      ],
    });

  it("shows the new state and priority at once and keeps a pending write", () => {
    const next = settleBacklogItem(state(), "parent", factories, {
      state: { name: "Waiting for client", done: false },
      priority: 1,
    });

    expect(find(next, "parent")).toMatchObject({
      status: "settled",
      sourceStatusKey: "waiting for client",
      sourceStatusLabel: "Waiting for client",
      importedPriority: 1,
      priority: 1,
      settledSourceStatusKey: "waiting for client",
      settledImportedPriority: 1,
      pendingSourceWrite: {
        state: "Waiting for client",
        priority: 1,
        previous: {
          sourceStatusKey: "active",
          sourceStatusLabel: "Active",
          importedPriority: 2,
          priority: 2,
        },
      },
    });
  });

  it("keeps only the fields that changed, and nothing to write stays local", () => {
    const onlyPriority = settleBacklogItem(state(), "parent", factories, {
      state: { name: "ACTIVE", done: false },
      priority: 3,
    });
    expect(find(onlyPriority, "parent")?.pendingSourceWrite).toMatchObject({
      state: undefined,
      priority: 3,
    });

    const unchanged = settleBacklogItem(state(), "parent", factories, {
      state: { name: "Active", done: false },
      priority: 2,
    });
    expect(find(unchanged, "parent")).toMatchObject({ status: "settled" });
    expect(find(unchanged, "parent")?.pendingSourceWrite).toBeUndefined();
  });

  it("keeps a local priority the user set, while writing the new one to the source", () => {
    const next = settleBacklogItem(
      createState({
        workItems: [synced("a", { importedPriority: 2, priority: 4 })],
      }),
      "a",
      factories,
      { priority: 1 },
    );

    expect(find(next, "a")).toMatchObject({ importedPriority: 1, priority: 4 });
  });

  it("archives the item and its carried subitems when the state is done", () => {
    const next = settleBacklogItem(
      state(),
      "parent",
      factories,
      { state: { name: "Closed", done: true } },
      { includeSubitems: true },
    );

    expect(find(next, "parent")).toMatchObject({
      status: "archived",
      sourceStatusLabel: "Closed",
      pendingSourceWrite: { state: "Closed" },
    });
    expect(find(next, "follows")?.status).toBe("archived");
  });

  it("ignores the change on a manual item", () => {
    const next = settleBacklogItem(
      createState({ workItems: [item("a")] }),
      "a",
      factories,
      { priority: 1 },
    );

    expect(find(next, "a")?.pendingSourceWrite).toBeUndefined();
  });

  it.each([
    { connectorDone: false, mappedState: "done", expectedStatus: "archived" },
    { connectorDone: true, mappedState: "review", expectedStatus: "settled" },
    { connectorDone: true, mappedState: undefined, expectedStatus: "settled" },
  ])(
    "uses mapping $mappedState rather than connector Done $connectorDone for Settle",
    ({ connectorDone, mappedState, expectedStatus }) => {
      const before = createState({
        workflowStates: [
          { _id: "doing", name: "Doing", color: "#000000", createdAt: 1 },
          { _id: "review", name: "Review", color: "#000000", createdAt: 1 },
          {
            _id: "done",
            name: "Done",
            done: true,
            color: "#000000",
            createdAt: 1,
          },
        ],
        workflowStateMappings: mappedState
          ? [
              {
                source: "azure_devops",
                connectionId: "connection-1",
                sourceStatusKey: "resolved",
                workflowStateId: mappedState,
              },
            ]
          : [],
        workItems: [
          synced("a", {
            workflowStateId: "doing",
            importedWorkflowStateId: "doing",
          }),
          item("child", { parentWorkItemId: "a", workflowStateId: "review" }),
        ],
      });
      const next = settleBacklogItem(
        before,
        "a",
        factories,
        { state: { name: "Resolved", done: connectorDone } },
        { includeSubitems: true },
      );
      expect(find(next, "a")).toMatchObject({
        status: expectedStatus,
        workflowStateId: mappedState,
        importedWorkflowStateId: mappedState,
      });
      expect(find(next, "child")?.status).toBe(expectedStatus);
      if (expectedStatus === "archived")
        expect(find(next, "a")?.workflowStateIdBeforeClose).toBe("doing");
      const failed = failSourceWrite(next, "a");
      expect(find(failed, "a")).toMatchObject({
        status: "active",
        workflowStateId: "doing",
        importedWorkflowStateId: "doing",
        sourceStatusKey: "active",
      });
      expect(find(failed, "child")).toMatchObject({
        status: "active",
        workflowStateId: "review",
      });
    },
  );
});

describe("sending a settle's write", () => {
  it.each([false, true])(
    "restores No state after persisting a settle mapped to Done=%s",
    (done) => {
      const state = createState({
        workItems: [synced("a")],
        workflowStates: [
          {
            _id: "destination",
            name: "Destination",
            done,
            color: "#000000",
            createdAt: 1,
          },
        ],
        workflowStateMappings: [
          {
            source: "azure_devops",
            connectionId: "connection-1",
            sourceStatusKey: "resolved",
            workflowStateId: "destination",
          },
        ],
      });
      const next = settleBacklogItem(state, "a", factories, {
        state: { name: "Resolved", done: !done },
      });
      const reloaded: LocalAppState = JSON.parse(JSON.stringify(next));
      expect(find(reloaded, "a")?.workflowStateId).toBe("destination");
      expect(
        find(reloaded, "a")?.pendingSourceWrite?.previous,
      ).not.toHaveProperty("workflowStateId");
      expect(find(failSourceWrite(reloaded, "a"), "a")).toMatchObject({
        status: "active",
        workflowStateId: undefined,
        importedWorkflowStateId: undefined,
        sourceStatusKey: "active",
      });
    },
  );
  const settled = () =>
    settleBacklogItem(
      createState({
        workItems: [
          synced("parent", { importedPriority: 2, priority: 2 }),
          synced("follows", {
            parentSourceId: "source-parent",
            hierarchyLevel: 1,
          }),
        ],
      }),
      "parent",
      factories,
      { state: { name: "Waiting", done: false }, priority: 1 },
      { includeSubitems: true },
    );

  it("keeps the settle's values once the write is sent", () => {
    const next = completeSourceWrite(settled(), "parent");

    expect(find(next, "parent")).toMatchObject({
      status: "settled",
      sourceStatusLabel: "Waiting",
      importedPriority: 1,
    });
    expect(find(next, "parent")?.pendingSourceWrite).toBeUndefined();
  });

  it("puts the item and its carried subitems back to active with their old values when the write fails", () => {
    const next = failSourceWrite(settled(), "parent");

    expect(find(next, "parent")).toMatchObject({
      status: "active",
      sourceStatusKey: "active",
      sourceStatusLabel: "Active",
      importedPriority: 2,
      priority: 2,
      settledAt: undefined,
    });
    expect(find(next, "parent")?.pendingSourceWrite).toBeUndefined();
    expect(find(next, "follows")?.status).toBe("active");
  });

  it("brings back an item a done state archived when the write fails", () => {
    const archived = settleBacklogItem(
      createState({ workItems: [synced("a")] }),
      "a",
      factories,
      { state: { name: "Closed", done: true } },
    );

    expect(find(failSourceWrite(archived, "a"), "a")).toMatchObject({
      status: "active",
      archivedAt: undefined,
      sourceStatusLabel: "Active",
    });
  });

  it("changes nothing for an item without a pending write", () => {
    const state = createState({ workItems: [synced("a")] });

    expect(completeSourceWrite(state, "a")).toBe(state);
    expect(failSourceWrite(state, "a")).toBe(state);
  });
});

describe("settling a snoozed item", () => {
  it("drops the snooze, so the item never comes back as returned", () => {
    const snoozed = snoozeBacklogItem(
      createState({ workItems: [synced("a")] }),
      "a",
      5_000,
    );

    const next = unsettleBacklogItem(
      settleBacklogItem(snoozed, "a", factories),
      "a",
    );

    expect(isBacklogItemReturned(find(next, "a")!, 6_000)).toBe(false);
  });
});

describe("archiving a settled backlog item", () => {
  it("archives the subitems its settle carried, and Restore brings them back", () => {
    const settled = settleBacklogItem(
      createState({
        workItems: [
          synced("parent"),
          synced("follows", {
            parentSourceId: "source-parent",
            hierarchyLevel: 1,
          }),
        ],
      }),
      "parent",
      factories,
      undefined,
      { includeSubitems: true },
    );

    const archived = archiveBacklogItem(settled, "parent", factories);

    expect(find(archived, "follows")?.status).toBe("archived");
    expect(
      find(restoreBacklogItem(archived, "parent"), "follows")?.status,
    ).toBe("active");
  });
});

describe("unsettling and restoring a backlog item", () => {
  it("puts a settled item and the subitems it carried back to active", () => {
    const settled = settleBacklogItem(
      createState({
        workItems: [
          synced("parent"),
          synced("follows", {
            parentSourceId: "source-parent",
            hierarchyLevel: 1,
          }),
        ],
      }),
      "parent",
      factories,
      undefined,
      { includeSubitems: true },
    );

    const next = unsettleBacklogItem(settled, "parent");

    expect(find(next, "parent")).toMatchObject({ status: "active" });
    expect(find(next, "parent")?.settledAt).toBeUndefined();
    expect(find(next, "follows")).toMatchObject({ status: "active" });
    expect(find(next, "follows")?.settledWithParentId).toBeUndefined();
  });

  it("restores an archived manual item with the subitems it carried", () => {
    const archived = settleBacklogItem(
      createState({
        workItems: [
          item("parent"),
          item("child", { parentWorkItemId: "parent", hierarchyLevel: 1 }),
        ],
      }),
      "parent",
      factories,
      undefined,
      { includeSubitems: true },
    );

    const next = restoreBacklogItem(archived, "parent");

    expect(find(next, "parent")).toMatchObject({ status: "active" });
    expect(find(next, "parent")?.archivedAt).toBeUndefined();
    expect(find(next, "child")).toMatchObject({ status: "active" });
  });
});

describe("snoozing a backlog item", () => {
  it("hides the item until the chosen time, then marks it returned until opened", () => {
    const snoozed = snoozeBacklogItem(
      createState({ workItems: [item("a")] }),
      "a",
      5_000,
    );
    const snoozedItem = find(snoozed, "a")!;

    expect(isBacklogItemSnoozed(snoozedItem, 4_999)).toBe(true);
    expect(isBacklogItemReturned(snoozedItem, 4_999)).toBe(false);
    expect(isBacklogItemSnoozed(snoozedItem, 5_000)).toBe(false);
    expect(isBacklogItemReturned(snoozedItem, 5_000)).toBe(true);

    const opened = markBacklogItemOpened(snoozed, "a", 5_000);

    expect(isBacklogItemReturned(find(opened, "a")!, 5_000)).toBe(false);
  });

  it("keeps a future snooze when the item is opened", () => {
    const snoozed = snoozeBacklogItem(
      createState({ workItems: [item("a")] }),
      "a",
      5_000,
    );

    const opened = markBacklogItemOpened(snoozed, "a", 1_000);

    expect(isBacklogItemSnoozed(find(opened, "a")!, 1_000)).toBe(true);
  });

  it("ends a snooze early without marking the item returned", () => {
    const snoozed = snoozeBacklogItem(
      createState({ workItems: [item("a")] }),
      "a",
      5_000,
    );

    const next = unsnoozeBacklogItem(snoozed, "a");

    expect(isBacklogItemSnoozed(find(next, "a")!, 1_000)).toBe(false);
    expect(isBacklogItemReturned(find(next, "a")!, 6_000)).toBe(false);
  });
});

describe("the sidebar's backlog items", () => {
  const ids = (items: LocalWorkItem[]) => items.map((workItem) => workItem._id);

  it("lists active top-level items in custom order, with subitems that have their own priority below their parent", () => {
    const state = createState({
      backlogSortMode: "custom",
      workItems: [
        item("first"),
        item("follows", { parentWorkItemId: "first", hierarchyLevel: 1 }),
        item("own", {
          parentWorkItemId: "first",
          hierarchyLevel: 1,
          priority: 1,
        }),
        item("snoozed", { snoozedUntil: 9_000 }),
        synced("settled", { status: "settled" }),
        item("archived", { status: "archived" }),
        item("second"),
      ],
    });

    expect(ids(selectSidebarBacklogItems(state, 1_000))).toEqual([
      "first",
      "own",
      "second",
    ]);
  });

  it("puts a subitem with its own priority in its parent's place when the parent is not listed", () => {
    const state = createState({
      backlogSortMode: "custom",
      workItems: [
        item("first"),
        item("parent", { snoozedUntil: 9_000 }),
        item("own", {
          parentWorkItemId: "parent",
          hierarchyLevel: 1,
          priority: 3,
        }),
        item("last"),
      ],
    });

    expect(ids(selectSidebarBacklogItems(state, 1_000))).toEqual([
      "first",
      "own",
      "last",
    ]);
  });

  it("mixes subitems with their own priority among top-level items in priority order", () => {
    const state = createState({
      backlogSortMode: "priority_asc",
      workItems: [
        item("none"),
        item("p2", { priority: 2 }),
        item("p3", { priority: 3 }),
        item("sub-p1", {
          parentWorkItemId: "p3",
          hierarchyLevel: 1,
          priority: 1,
        }),
      ],
    });

    expect(ids(selectSidebarBacklogItems(state, 1_000))).toEqual([
      "sub-p1",
      "p2",
      "p3",
      "none",
    ]);
  });
});

describe("moving a backlog item between workflow states", () => {
  const workflowStates: LocalAppState["workflowStates"] = [
    { _id: "todo", name: "To do", color: "#64748b", createdAt: 1 },
    { _id: "doing", name: "In progress", color: "#d97706", createdAt: 1 },
    { _id: "done", name: "Done", color: "#059669", done: true, createdAt: 1 },
    {
      _id: "canceled",
      name: "Canceled",
      color: "#dc2626",
      done: true,
      createdAt: 1,
    },
  ];
  const withItems = (
    workItems: LocalWorkItem[],
    extra: Partial<LocalAppState> = {},
  ) => createState({ workflowStates, workItems, ...extra });

  it("changes only the state between states that aren't done", () => {
    const next = moveBacklogItemToState(
      withItems([synced("a", { status: "settled", workflowStateId: "todo" })]),
      "a",
      "doing",
      factories,
    );

    expect(find(next, "a")).toMatchObject({
      status: "settled",
      workflowStateId: "doing",
    });
  });

  it("closes an item moved into a done state and remembers where it was", () => {
    const next = moveBacklogItemToState(
      withItems(
        [item("a", { workflowStateId: "doing", snoozedUntil: 5_000 })],
        {
          timers: [
            {
              _id: "timer-1",
              startedAt: 400,
              localDate: "2026-10-11",
              workItemId: "a",
              accumulatedDurationMs: 0,
            },
          ],
        },
      ),
      "a",
      "done",
      factories,
    );

    expect(find(next, "a")).toMatchObject({
      status: "archived",
      archivedAt: 1_000,
      workflowStateId: "done",
      workflowStateIdBeforeClose: "doing",
    });
    expect(find(next, "a")?.snoozedUntil).toBeUndefined();
    expect(next.timers).toEqual([]);
  });

  it("closes open subitems only when asked, and reopens them with the parent", () => {
    const state = withItems([
      synced("parent", { workflowStateId: "doing" }),
      synced("open", {
        parentSourceId: "source-parent",
        hierarchyLevel: 1,
        workflowStateId: "todo",
      }),
      synced("waiting", {
        parentSourceId: "source-parent",
        hierarchyLevel: 1,
        status: "settled",
        workflowStateId: "doing",
        settledAt: 200,
        settledSourceStatusKey: "waiting",
      }),
      synced("already-closed", {
        parentSourceId: "source-parent",
        hierarchyLevel: 1,
        status: "archived",
        workflowStateId: "done",
        archivedAt: 100,
      }),
    ]);

    const alone = moveBacklogItemToState(state, "parent", "done", factories);
    expect(find(alone, "open")?.status).toBe("active");

    const closed = moveBacklogItemToState(state, "parent", "done", factories, {
      includeSubitems: true,
    });
    expect(find(closed, "open")).toMatchObject({
      status: "archived",
      workflowStateId: "done",
      settledWithParentId: "parent",
    });
    expect(find(closed, "waiting")).toBe(find(state, "waiting"));
    expect(find(closed, "already-closed")).toBe(find(state, "already-closed"));

    const reopened = moveBacklogItemToState(
      closed,
      "parent",
      "todo",
      factories,
    );
    expect(find(reopened, "parent")).toMatchObject({
      status: "active",
      workflowStateId: "todo",
    });
    expect(find(reopened, "open")).toMatchObject({
      status: "active",
      workflowStateId: "todo",
    });
    expect(find(reopened, "waiting")).toMatchObject({
      status: "settled",
      workflowStateId: "doing",
      settledAt: 200,
      settledSourceStatusKey: "waiting",
    });
    expect(find(reopened, "already-closed")).toBe(
      find(state, "already-closed"),
    );
  });

  it("moves an archived item between done states without reopening it", () => {
    const next = moveBacklogItemToState(
      withItems([item("a", { status: "archived", workflowStateId: "done" })]),
      "a",
      "canceled",
      factories,
    );

    expect(find(next, "a")).toMatchObject({
      status: "archived",
      workflowStateId: "canceled",
    });
  });

  it("reopens a done item when its workflow state is cleared", () => {
    const next = moveBacklogItemToState(
      withItems([item("a", { status: "archived", workflowStateId: "done" })]),
      "a",
      undefined,
      factories,
    );
    expect(find(next, "a")?.status).toBe("active");
    expect(find(next, "a")?.workflowStateId).toBeUndefined();
  });

  it("archives into the first done state, and Restore puts the item back", () => {
    const archived = archiveBacklogItem(
      withItems([item("a", { workflowStateId: "doing" })]),
      "a",
      factories,
    );
    expect(find(archived, "a")).toMatchObject({
      status: "archived",
      workflowStateId: "done",
    });

    expect(find(restoreBacklogItem(archived, "a"), "a")).toMatchObject({
      status: "active",
      workflowStateId: "doing",
    });
  });

  it("closes a settle into a done source state in the state it maps to", () => {
    const next = settleBacklogItem(
      withItems([synced("a", { workflowStateId: "doing" })], {
        workflowStateMappings: [
          {
            source: "azure_devops",
            connectionId: "connection-1",
            sourceStatusKey: "removed",
            workflowStateId: "canceled",
          },
        ],
      }),
      "a",
      factories,
      { state: { name: "Removed", done: true } },
    );

    expect(find(next, "a")).toMatchObject({
      status: "archived",
      workflowStateId: "canceled",
      archivedSourceStatusKey: "removed",
    });
  });
});

describe("writing a move to the source", () => {
  const workflowStates: LocalAppState["workflowStates"] = [
    { _id: "doing", name: "In progress", color: "#d97706", createdAt: 1 },
    { _id: "review", name: "In review", color: "#7c3aed", createdAt: 1 },
    { _id: "done", name: "Done", color: "#059669", done: true, createdAt: 1 },
  ];
  const workflowStateMappings: LocalAppState["workflowStateMappings"] = [
    {
      source: "azure_devops",
      connectionId: "connection-1",
      sourceStatusKey: "active",
      workflowStateId: "doing",
    },
    {
      source: "azure_devops",
      connectionId: "connection-1",
      sourceStatusKey: "resolved",
      sourceStatusLabel: "Resolved",
      workflowStateId: "review",
    },
    {
      source: "azure_devops",
      connectionId: "connection-1",
      sourceStatusKey: "in qa",
      sourceStatusLabel: "In QA",
      workflowStateId: "review",
    },
    {
      source: "azure_devops",
      connectionId: "connection-1",
      sourceStatusKey: "closed",
      sourceStatusLabel: "Closed",
      workflowStateId: "done",
    },
  ];
  const state = () =>
    createState({
      workflowStates,
      workflowStateMappings,
      workItems: [
        synced("a", {
          workflowStateId: "doing",
          importedWorkflowStateId: "doing",
        }),
      ],
    });

  it("shows the new source state at once and keeps a write for later", () => {
    const next = moveBacklogItemToState(state(), "a", "review", factories, {
      sourceWrites: { a: "Resolved" },
    });

    expect(find(next, "a")).toMatchObject({
      workflowStateId: "review",
      importedWorkflowStateId: "review",
      sourceStatusLabel: "Resolved",
      pendingSourceWrite: {
        state: "Resolved",
        previous: { sourceStatusKey: "active", workflowStateId: "doing" },
      },
    });
  });

  it("puts a closed item back where it was when the write fails", () => {
    const closed = moveBacklogItemToState(state(), "a", "done", factories, {
      sourceWrites: { a: "Closed" },
    });
    expect(find(closed, "a")).toMatchObject({
      status: "archived",
      archivedSourceStatusKey: "closed",
    });

    expect(find(failSourceWrite(closed, "a"), "a")).toMatchObject({
      status: "active",
      workflowStateId: "doing",
      sourceStatusKey: "active",
    });
  });

  it("preserves a settled lifecycle when a move write fails", () => {
    const before = state();
    before.workItems[0] = {
      ...before.workItems[0]!,
      status: "settled",
      settledAt: 100,
      settledSourceStatusKey: "active",
    };
    const moved = moveBacklogItemToState(before, "a", "review", factories, {
      sourceWrites: { a: "Resolved" },
    });
    expect(find(failSourceWrite(moved, "a"), "a")).toMatchObject({
      status: "settled",
      settledAt: 100,
      workflowStateId: "doing",
    });
  });

  it("changes the source state and leaves the item in its workflow state", () => {
    const inReview = moveBacklogItemToState(state(), "a", "review", factories, {
      sourceWrites: { a: "Resolved" },
    });
    const next = changeBacklogItemSourceState(
      completeSourceWrite(inReview, "a"),
      "a",
      "In QA",
    );

    expect(find(next, "a")).toMatchObject({
      workflowStateId: "review",
      sourceStatusLabel: "In QA",
      pendingSourceWrite: { state: "In QA" },
    });
  });
});
