import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  applyWorkflowStateLifecycle,
  archiveBacklogItem,
  changeBacklogItemPriority,
  changeBacklogItemSourceState,
  completeSourceWrite,
  failSourceWrite,
  getPriorityRefusal,
  isBacklogItemReturned,
  isBacklogItemSnoozed,
  markBacklogItemOpened,
  markSourceWriteSent,
  moveBacklogItemToState,
  patchBacklogItem,
  pinBacklogItem,
  restoreBacklogItem,
  selectSidebarBacklogItems,
  selectSidebarBacklogItemsAfterReorder,
  splitSidebarBacklogItems,
  groupSidebarBacklogItemsByLevel,
  selectUpNextBacklogItem,
  settleBacklogItem,
  snoozeBacklogItem,
  unpinBacklogItem,
  unsettleBacklogItem,
  unsnoozeBacklogItem,
} from "@/domain/backlog/backlog-item-lifecycle";
import { updateWorkflowState } from "@/domain/backlog/workflow-states";
import { holdSourceWrite } from "@/domain/backlog/held-edits";
import { reorderWorkItems } from "@/domain/backlog/work-item-transitions";

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
    commitPromptedWeeks: [],
    timesheetTombstones: [],
    lockedWeeks: [],
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

describe("settle ids", () => {
  it("gives each settle an id that an archive keeps and a return to active clears", () => {
    let next = 0;
    const counting = {
      createId: (prefix: string) => `${prefix}-${++next}`,
      now: () => 1_000,
    };
    const settled = settleBacklogItem(
      createState({ workItems: [synced("a")] }),
      "a",
      counting,
    );
    expect(find(settled, "a")?.status).toBe("settled");
    const firstId = find(settled, "a")?.settleId;
    expect(firstId).toMatch(/^settle-/);

    const archived = archiveBacklogItem(settled, "a", counting);
    expect(find(archived, "a")).toMatchObject({
      status: "archived",
      settleId: firstId,
    });

    const unsettled = unsettleBacklogItem(settled, "a");
    expect(find(unsettled, "a")?.settleId).toBeUndefined();
    const again = settleBacklogItem(unsettled, "a", counting);
    expect(find(again, "a")?.settleId).not.toBe(firstId);
  });
});

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
    { sourceDone: false, mappedState: "done", expectedStatus: "archived" },
    { sourceDone: true, mappedState: "review", expectedStatus: "settled" },
    { sourceDone: true, mappedState: undefined, expectedStatus: "settled" },
  ])(
    "uses mapping $mappedState rather than source Done $connectorDone for Settle",
    ({ sourceDone, mappedState, expectedStatus }) => {
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
        { state: { name: "Resolved", done: sourceDone } },
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

describe("pinning a backlog item", () => {
  it("pins an active item and unpins it", () => {
    const pinned = pinBacklogItem(
      createState({ workItems: [item("a")] }),
      "a",
      2_000,
    );
    expect(find(pinned, "a")!.pinnedAt).toBe(2_000);

    const unpinned = unpinBacklogItem(pinned, "a");
    expect(find(unpinned, "a")!.pinnedAt).toBeUndefined();
  });

  it("does not pin an item that is not active", () => {
    const state = createState({
      workItems: [synced("settled", { status: "settled" })],
    });

    expect(pinBacklogItem(state, "settled", 2_000)).toEqual(state);
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

  it("puts pinned items first, in list order, and skips them for Up next", () => {
    const state = createState({
      backlogSortMode: "priority_asc",
      workItems: [
        item("p1", { priority: 1 }),
        item("p3-pinned", { priority: 3, pinnedAt: 5 }),
        item("p2", { priority: 2 }),
        item("p4-pinned", { priority: 4, pinnedAt: 1 }),
      ],
    });
    const listed = selectSidebarBacklogItems(state, 1_000);

    expect(ids(listed)).toEqual(["p3-pinned", "p4-pinned", "p1", "p2"]);
    expect(selectUpNextBacklogItem(listed)?._id).toBe("p1");
  });

  it("has no Up next when every listed item is pinned", () => {
    const listed = [item("a", { pinnedAt: 1 })];

    expect(selectUpNextBacklogItem(listed)).toBeUndefined();
  });

  it("splits the list into pinned items and the rest, each in list order", () => {
    const { pinned, others } = splitSidebarBacklogItems([
      item("a"),
      item("pinned-1", { pinnedAt: 5 }),
      item("b"),
      item("pinned-2", { pinnedAt: 1 }),
    ]);

    expect(ids(pinned)).toEqual(["pinned-1", "pinned-2"]);
    expect(ids(others)).toEqual(["a", "b"]);
  });

  it("lists what a reorder would show, each subitem at its parent's new place", () => {
    const state = createState({
      backlogSortMode: "custom",
      workItems: [
        item("a"),
        item("a-sub", {
          parentWorkItemId: "a",
          hierarchyLevel: 1,
          priority: 2,
        }),
        item("pinned", { pinnedAt: 1 }),
        item("b"),
        item("pinned-sub", {
          parentWorkItemId: "pinned",
          hierarchyLevel: 1,
          priority: 2,
        }),
      ],
    });

    // "a" takes its subitem along, and the pinned parent's subitem keeps
    // its parent's place, between "b" and "a" now.
    expect(
      ids(selectSidebarBacklogItemsAfterReorder(state, 1_000, ["b", "a"])),
    ).toEqual(["pinned", "b", "pinned-sub", "a", "a-sub"]);
  });

  it("groups the list by level for a drag under Priority ordering", () => {
    const listed = [
      item("urgent", { priority: 1 }),
      item("high-1", { priority: 2 }),
      item("high-2", { priority: 2 }),
      item("none"),
    ];
    const levels = (sortMode: "priority_asc" | "priority_desc") =>
      groupSidebarBacklogItemsByLevel(listed, sortMode).map(
        ({ priority, items }) => [priority, ids(items)],
      );

    // Every level shows, empty ones included, with its items in list order.
    expect(levels("priority_asc")).toEqual([
      [1, ["urgent"]],
      [2, ["high-1", "high-2"]],
      [3, []],
      [4, []],
      [undefined, ["none"]],
    ]);
    expect(levels("priority_desc").map(([priority]) => priority)).toEqual([
      undefined,
      4,
      3,
      2,
      1,
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

  const orderedState = () => ({
    ...state(),
    workItems: [
      ...state().workItems,
      item("untouched"),
      item("b"),
      item("c"),
      item("d"),
      item("e"),
    ],
  });
  const ids = (value: LocalAppState) => value.workItems.map((item) => item._id);
  const dragToReview = (before = orderedState()) =>
    moveBacklogItemToState(before, "a", "review", factories, {
      sourceWrites: { a: "Resolved" },
      orderedIds: ["b", "c", "a"],
    });

  it.each(["review", "done"])(
    "restores the persisted drag order and lifecycle after a failed move into %s",
    (destination) => {
      const before = orderedState();
      const moved = moveBacklogItemToState(
        before,
        "a",
        destination,
        factories,
        {
          sourceWrites: { a: destination === "done" ? "Closed" : "Resolved" },
          orderedIds: ["b", "c", "a"],
        },
      );
      expect(ids(moved)).toEqual(["b", "untouched", "c", "a", "d", "e"]);
      const reloaded: LocalAppState = JSON.parse(JSON.stringify(moved));
      const failed = failSourceWrite(reloaded, "a");
      expect(ids(failed)).toEqual(ids(before));
      expect(find(failed, "a")).toMatchObject({
        workflowStateId: "doing",
        status: "active",
        sourceStatusKey: "active",
      });
      expect(find(failed, "a")?.pendingSourceWrite).toBeUndefined();
    },
  );

  it("restores the drag without undoing unrelated reorders, inserted items or notes", () => {
    const moved = dragToReview();
    moved.workItems.splice(2, 0, item("new"));
    const edited = reorderWorkItems(moved, ["e", "d"]);
    const a = find(edited, "a")!;
    a.description = "Keep this note";
    const failed = failSourceWrite(edited, "a");
    expect(ids(failed)).toEqual(["a", "untouched", "new", "b", "c", "e", "d"]);
    expect(find(failed, "a")?.description).toBe("Keep this note");
  });

  it("preserves a later explicit reorder of the dragged range", () => {
    const edited = reorderWorkItems(dragToReview(), ["c", "a", "b"]);
    const failed = failSourceWrite(edited, "a");
    expect(ids(failed)).toEqual(ids(edited));
    expect(find(failed, "a")?.workflowStateId).toBe("doing");
  });

  it("recovers the original order after two coalesced drags", () => {
    const before = orderedState();
    const first = dragToReview(before);
    const second = moveBacklogItemToState(first, "a", "done", factories, {
      sourceWrites: { a: "Closed" },
      orderedIds: ["d", "a"],
    });
    expect(ids(second)).toEqual(["b", "untouched", "c", "d", "a", "e"]);
    const failed = failSourceWrite(second, "a");
    expect(ids(failed)).toEqual(ids(before));
    expect(find(failed, "a")?.workflowStateId).toBe("doing");
  });

  it("advances drag recovery to an older successful write's order", () => {
    const first = dragToReview();
    const second = moveBacklogItemToState(
      first,
      "a",
      "done",
      {
        ...factories,
        now: () => 2000,
      },
      {
        sourceWrites: { a: "Closed" },
        orderedIds: ["d", "a"],
      },
    );
    const acknowledged = completeSourceWrite(second, "a", first.workItems);
    expect(ids(acknowledged)).toEqual(ids(second));
    const failed = failSourceWrite(acknowledged, "a");
    expect(ids(failed)).toEqual(ids(first));
    expect(find(failed, "a")).toMatchObject({
      status: "active",
      workflowStateId: "review",
      sourceStatusKey: "resolved",
    });
  });

  it("keeps the dropped order after a successful source write", () => {
    const moved = dragToReview();
    const completed = completeSourceWrite(moved, "a", moved.workItems);
    expect(ids(completed)).toEqual(ids(moved));
    expect(find(completed, "a")?.pendingSourceWrite).toBeUndefined();
  });

  it.each(["doing", undefined])(
    "retains workflow %s when a move extends a priority-only write",
    (workflowStateId) => {
      const before = state();
      before.workItems[0] = {
        ...before.workItems[0]!,
        workflowStateId,
        importedWorkflowStateId: workflowStateId,
        priority: 2,
        importedPriority: 2,
      };
      const priority = settleBacklogItem(before, "a", factories, {
        priority: 1,
      });
      expect(
        find(priority, "a")?.pendingSourceWrite?.previous,
      ).not.toHaveProperty("workflowStateId");
      const moved = moveBacklogItemToState(priority, "a", "review", factories, {
        sourceWrites: { a: "Resolved" },
      });
      const reloaded: LocalAppState = JSON.parse(JSON.stringify(moved));
      expect(find(failSourceWrite(reloaded, "a"), "a")).toMatchObject({
        workflowStateId,
        importedWorkflowStateId: workflowStateId,
        importedPriority: 2,
        priority: 2,
        sourceStatusKey: "active",
      });
    },
  );

  it.each([
    "child succeeds first",
    "parent fails first",
    "child fails first",
    "both fail, parent first",
  ])("recovers independent parent and child source writes when %s", (order) => {
    const before = state();
    before.workItems.push(
      synced("child", {
        parentWorkItemId: "a",
        workflowStateId: "doing",
        importedWorkflowStateId: "doing",
      }),
    );
    const closed = moveBacklogItemToState(before, "a", "done", factories, {
      includeSubitems: true,
      sourceWrites: { a: "Closed", child: "Closed" },
    });
    const sent = closed.workItems;
    let next: LocalAppState;
    if (order === "child succeeds first") {
      const confirmed = completeSourceWrite(closed, "child", sent);
      next = failSourceWrite(JSON.parse(JSON.stringify(confirmed)), "a");
    } else if (order === "parent fails first") {
      next = completeSourceWrite(failSourceWrite(closed, "a"), "child", sent);
    } else if (order === "child fails first") {
      next = failSourceWrite(failSourceWrite(closed, "child"), "a");
    } else {
      next = failSourceWrite(failSourceWrite(closed, "a"), "child");
    }
    const succeeded =
      order === "child succeeds first" || order === "parent fails first";
    expect(find(next, "a")).toMatchObject({
      status: "active",
      workflowStateId: "doing",
      pendingSourceWrite: undefined,
    });
    expect(find(next, "child")).toMatchObject({
      status: succeeded ? "archived" : "active",
      workflowStateId: succeeded ? "done" : "doing",
      sourceStatusLabel: succeeded ? "Closed" : "Active",
      settledWithParentId: undefined,
    });
    expect(find(next, "child")?.pendingSourceWrite).toBeUndefined();
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

  it.each([
    { snoozedUntil: 9000, returnedAt: undefined },
    { snoozedUntil: undefined, returnedAt: 500 },
  ])(
    "restores parent and carried-child visibility markers $snoozedUntil/$returnedAt after a failed close",
    (markers) => {
      const before = state();
      before.workItems[0] = { ...before.workItems[0]!, ...markers };
      before.workItems.push(
        item("child", {
          parentWorkItemId: "a",
          workflowStateId: "doing",
          ...markers,
        }),
      );
      const closed = moveBacklogItemToState(before, "a", "done", factories, {
        includeSubitems: true,
        sourceWrites: { a: "Closed" },
      });
      for (const id of ["a", "child"]) {
        expect(find(closed, id)).toMatchObject({
          status: "archived",
          snoozedUntil: undefined,
          returnedAt: undefined,
        });
      }
      const restored = failSourceWrite(closed, "a");
      for (const id of ["a", "child"]) {
        expect(find(restored, id)).toMatchObject({
          status: "active",
          workflowStateId: "doing",
          ...markers,
        });
      }
      expect(isBacklogItemSnoozed(find(restored, "a")!, 1000)).toBe(
        markers.snoozedUntil !== undefined,
      );
      expect(isBacklogItemReturned(find(restored, "child")!, 1000)).toBe(
        markers.returnedAt !== undefined,
      );
    },
  );

  it("preserves a carried child's independent snooze during failed-close recovery", () => {
    const before = state();
    before.workItems.push(
      item("child", { parentWorkItemId: "a", workflowStateId: "doing" }),
    );
    const closed = moveBacklogItemToState(before, "a", "done", factories, {
      includeSubitems: true,
      sourceWrites: { a: "Closed" },
    });
    const changed = {
      ...closed,
      workItems: closed.workItems.map((child) =>
        child._id === "child" ? { ...child, snoozedUntil: 9000 } : child,
      ),
    };
    expect(find(failSourceWrite(changed, "a"), "child")).toMatchObject({
      status: "archived",
      snoozedUntil: 9000,
    });
  });

  it("reopens carried subitems when a parent's closing move write fails", () => {
    const before = state();
    before.workItems.push(
      item("child", { parentWorkItemId: "a", workflowStateId: "doing" }),
    );
    const closed = moveBacklogItemToState(before, "a", "done", factories, {
      includeSubitems: true,
      sourceWrites: { a: "Closed" },
    });
    expect(find(closed, "child")?.status).toBe("archived");
    expect(find(failSourceWrite(closed, "a"), "child")).toMatchObject({
      status: "active",
      workflowStateId: "doing",
    });
  });

  it("restores carried children when the parent's reopen write fails", () => {
    const before = state();
    before.workItems.push(
      item("child", { parentWorkItemId: "a", workflowStateId: "doing" }),
    );
    const closed = completeSourceWrite(
      moveBacklogItemToState(before, "a", "done", factories, {
        includeSubitems: true,
        sourceWrites: { a: "Closed" },
      }),
      "a",
    );
    const reopened = moveBacklogItemToState(closed, "a", "doing", factories, {
      sourceWrites: { a: "Active" },
    });
    expect(find(reopened, "child")?.status).toBe("active");
    const edited = {
      ...reopened,
      workItems: reopened.workItems.map((child) =>
        child._id === "child" ? { ...child, note: "Keep this edit" } : child,
      ),
    };
    const failed = failSourceWrite(edited, "a");
    expect(find(failed, "a")?.status).toBe("archived");
    expect(find(failed, "child")).toMatchObject({
      status: "archived",
      workflowStateId: "done",
      settledWithParentId: "a",
      note: "Keep this edit",
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

describe("changing a backlog item's priority", () => {
  const writes = { writesToSource: true, now: 1_000 };
  const state = () =>
    createState({
      workflowStates: [
        { _id: "doing", name: "In progress", color: "#d97706", createdAt: 1 },
        { _id: "review", name: "In review", color: "#7c3aed", createdAt: 1 },
      ],
      workflowStateMappings: [
        {
          source: "azure_devops",
          connectionId: "connection-1",
          sourceStatusKey: "resolved",
          sourceStatusLabel: "Resolved",
          workflowStateId: "review",
        },
      ],
      workItems: [
        synced("a", {
          priority: 2,
          importedPriority: 2,
          workflowStateId: "doing",
          importedWorkflowStateId: "doing",
        }),
      ],
    });

  it("writes a changed level to the source after the Undo window", () => {
    const next = changeBacklogItemPriority(state(), "a", 3, writes);

    expect(find(next, "a")).toMatchObject({
      priority: 3,
      importedPriority: 3,
      pendingSourceWrite: {
        readyAt: 9_000,
        state: undefined,
        priority: 3,
        previous: { priority: 2, importedPriority: 2 },
      },
    });
  });

  it("writes at once when the change has no Undo, as the editor's save", () => {
    const next = changeBacklogItemPriority(state(), "a", 3, {
      ...writes,
      undoWindow: false,
    });

    expect(find(next, "a")?.pendingSourceWrite?.readyAt).toBe(1_000);
  });

  it("drops the write when the level goes back to the source's", () => {
    const changed = changeBacklogItemPriority(state(), "a", 3, writes);
    const back = changeBacklogItemPriority(changed, "a", 2, writes);

    expect(find(back, "a")).toMatchObject({ priority: 2, importedPriority: 2 });
    expect(find(back, "a")?.pendingSourceWrite).toBeUndefined();
  });

  it("keeps a move's pending state, and the move keeps a pending priority", () => {
    const moved = moveBacklogItemToState(state(), "a", "review", factories, {
      sourceWrites: { a: "Resolved" },
    });
    const changed = changeBacklogItemPriority(moved, "a", 3, writes);
    expect(find(changed, "a")?.pendingSourceWrite).toMatchObject({
      state: "Resolved",
      priority: 3,
      previous: { sourceStatusKey: "active", workflowStateId: "doing" },
    });
    // Back to the source's level: the move's state still goes.
    expect(
      find(changeBacklogItemPriority(changed, "a", 2, writes), "a")
        ?.pendingSourceWrite,
    ).toMatchObject({ state: "Resolved", priority: undefined });

    const prioritized = changeBacklogItemPriority(state(), "a", 1, writes);
    const thenMoved = moveBacklogItemToState(
      prioritized,
      "a",
      "review",
      factories,
      { sourceWrites: { a: "Resolved" } },
    );
    expect(find(thenMoved, "a")?.pendingSourceWrite).toMatchObject({
      state: "Resolved",
      priority: 1,
      previous: { importedPriority: 2, workflowStateId: "doing" },
    });
  });

  it("keeps a pending priority when a settle writes a state", () => {
    const changed = changeBacklogItemPriority(state(), "a", 3, writes);
    const settled = settleBacklogItem(changed, "a", factories, {
      state: { name: "Waiting", done: false },
      priority: 3,
    });

    expect(find(settled, "a")).toMatchObject({
      status: "settled",
      settledImportedPriority: 3,
      pendingSourceWrite: {
        state: "Waiting",
        priority: 3,
        previous: { importedPriority: 2, workflowStateId: "doing" },
      },
    });
  });

  it("refuses No priority on a synced item whose source has a priority", () => {
    expect(changeBacklogItemPriority(state(), "a", undefined, writes)).toEqual(
      state(),
    );
    expect(getPriorityRefusal(find(state(), "a")!, undefined)).toBeDefined();
    expect(getPriorityRefusal(find(state(), "a")!, 4)).toBeUndefined();

    const manual = createState({ workItems: [item("m", { priority: 2 })] });
    expect(getPriorityRefusal(item("m", { priority: 2 }), undefined)).toBe(
      undefined,
    );
    expect(
      find(changeBacklogItemPriority(manual, "m", undefined, writes), "m")
        ?.priority,
    ).toBeUndefined();

    // A source without a priority takes No priority back.
    const unset = createState({ workItems: [synced("u")] });
    const raised = changeBacklogItemPriority(unset, "u", 2, writes);
    const cleared = changeBacklogItemPriority(raised, "u", undefined, writes);
    expect(find(cleared, "u")).toMatchObject({
      priority: undefined,
      importedPriority: undefined,
      pendingSourceWrite: undefined,
    });
  });

  it("routes a patch's priority through the same write, and refuses the whole patch with No priority", () => {
    const patched = patchBacklogItem(
      state(),
      "a",
      { priority: 3, title: "Renamed" },
      writes,
    );
    expect(find(patched, "a")).toMatchObject({
      title: "Renamed",
      priority: 3,
      pendingSourceWrite: { priority: 3 },
    });

    expect(
      patchBacklogItem(
        state(),
        "a",
        { priority: undefined, title: "Renamed" },
        writes,
      ),
    ).toEqual(state());
  });

  it("keeps the change in Ajour when the plugin can't write", () => {
    const next = changeBacklogItemPriority(state(), "a", 3, {
      ...writes,
      writesToSource: false,
    });

    expect(find(next, "a")).toMatchObject({ priority: 3, importedPriority: 2 });
    expect(find(next, "a")?.pendingSourceWrite).toBeUndefined();
  });

  it("follows the source again once the write is sent", () => {
    const sent = completeSourceWrite(
      changeBacklogItemPriority(state(), "a", 3, writes),
      "a",
    );

    expect(find(sent, "a")).toMatchObject({ priority: 3, importedPriority: 3 });
    expect(find(sent, "a")?.pendingSourceWrite).toBeUndefined();
  });

  it("puts the previous priority back when the write fails, and leaves the item where it is", () => {
    const failed = failSourceWrite(
      changeBacklogItemPriority(state(), "a", 3, writes),
      "a",
    );
    expect(find(failed, "a")).toMatchObject({
      status: "active",
      priority: 2,
      importedPriority: 2,
      workflowStateId: "doing",
    });
    expect(find(failed, "a")?.pendingSourceWrite).toBeUndefined();

    // A settled item stays settled, with the priority it was settled with.
    const settled = settleBacklogItem(state(), "a", factories);
    const failedSettled = failSourceWrite(
      changeBacklogItemPriority(settled, "a", 1, writes),
      "a",
    );
    expect(find(failedSettled, "a")).toMatchObject({
      status: "settled",
      priority: 2,
      importedPriority: 2,
      settledImportedPriority: 2,
    });
  });

  it("keeps a settled item settled after its write, so the next sync doesn't return it", () => {
    const settled = settleBacklogItem(state(), "a", factories);
    const changed = changeBacklogItemPriority(settled, "a", 1, writes);

    expect(find(changed, "a")).toMatchObject({
      status: "settled",
      importedPriority: 1,
      settledImportedPriority: 1,
    });
  });

  it("keeps a held priority held when a move joins it, and lets a move replace a held write without one", () => {
    const held = holdSourceWrite(
      changeBacklogItemPriority(state(), "a", 3, writes),
      "a",
      2_000,
    );
    const moved = moveBacklogItemToState(held, "a", "review", factories, {
      sourceWrites: { a: "Resolved" },
    });
    expect(find(moved, "a")?.pendingSourceWrite).toMatchObject({
      heldAt: 2_000,
      state: "Resolved",
      priority: 3,
    });

    const heldMove = holdSourceWrite(
      moveBacklogItemToState(state(), "a", "review", factories, {
        sourceWrites: { a: "Resolved" },
      }),
      "a",
      2_000,
    );
    const movedBack = moveBacklogItemToState(
      heldMove,
      "a",
      "doing",
      factories,
      {
        sourceWrites: { a: "Active" },
      },
    );
    expect(find(movedBack, "a")?.pendingSourceWrite).toMatchObject({
      state: "Active",
    });
    expect(find(movedBack, "a")?.pendingSourceWrite?.heldAt).toBeUndefined();
  });

  it("keeps a held priority held when a settle joins it", () => {
    const held = holdSourceWrite(
      changeBacklogItemPriority(state(), "a", 3, writes),
      "a",
      2_000,
    );
    const settled = settleBacklogItem(held, "a", factories, {
      state: { name: "Resolved", done: false },
    });

    expect(find(settled, "a")?.pendingSourceWrite).toMatchObject({
      heldAt: 2_000,
      state: "Resolved",
      priority: 3,
    });
  });

  it("writes the source's level back while a sent request may still set another", () => {
    const sent = markSourceWriteSent(
      changeBacklogItemPriority(state(), "a", 3, writes),
      "a",
    );
    const back = changeBacklogItemPriority(sent, "a", 2, writes);
    expect(find(back, "a")).toMatchObject({
      priority: 2,
      importedPriority: 2,
      pendingSourceWrite: { readyAt: 9_000, priority: 2 },
    });

    // The sent level landed: the follow-up still goes, and a failure of it
    // puts back the level the source has now.
    const landed = completeSourceWrite(back, "a", sent.workItems);
    expect(find(landed, "a")?.pendingSourceWrite).toMatchObject({
      priority: 2,
      previous: { importedPriority: 3 },
    });
    expect(
      find(changeBacklogItemPriority(landed, "a", 3, writes), "a")
        ?.pendingSourceWrite,
    ).toBeUndefined();

    // A request the source refused set nothing.
    const refused = holdSourceWrite(sent, "a", 2_000);
    expect(
      find(changeBacklogItemPriority(refused, "a", 2, writes), "a")
        ?.pendingSourceWrite,
    ).toBeUndefined();
  });

  it("refuses No priority while a sent request may set a level on a source without one", () => {
    const unset = createState({ workItems: [synced("u")] });
    const sent = markSourceWriteSent(
      changeBacklogItemPriority(unset, "u", 2, writes),
      "u",
    );

    expect(getPriorityRefusal(find(sent, "u")!, undefined)).toBeDefined();
  });

  it("puts a settled item back as it was when a move joined its priority write and the write fails", () => {
    const withDone = {
      ...state(),
      workflowStates: [
        ...state().workflowStates,
        {
          _id: "done",
          name: "Done",
          color: "#059669",
          done: true,
          createdAt: 1,
        },
      ],
    };
    const settled = settleBacklogItem(withDone, "a", factories);
    const changed = changeBacklogItemPriority(settled, "a", 3, writes);
    // The move closes the item, which clears what its settle remembered.
    const moved = moveBacklogItemToState(changed, "a", "done", factories, {
      sourceWrites: { a: "Closed" },
    });
    expect(find(moved, "a")?.status).toBe("archived");
    const failed = failSourceWrite(moved, "a");

    expect(find(failed, "a")).toMatchObject({
      status: "settled",
      settledAt: 1_000,
      settleId: "settle-1",
      settledSourceStatusKey: "active",
      settledImportedPriority: 2,
      priority: 2,
      importedPriority: 2,
      sourceStatusKey: "active",
      workflowStateId: "doing",
      importedWorkflowStateId: "doing",
    });
  });

  it("removes a pending priority when a settle picks the source's level", () => {
    const changed = changeBacklogItemPriority(state(), "a", 3, writes);
    const settled = settleBacklogItem(changed, "a", factories, { priority: 2 });
    expect(find(settled, "a")).toMatchObject({
      status: "settled",
      priority: 2,
      importedPriority: 2,
      settledImportedPriority: 2,
    });
    expect(find(settled, "a")?.pendingSourceWrite).toBeUndefined();

    // With a new state, only the state goes.
    const withState = settleBacklogItem(changed, "a", factories, {
      state: { name: "Resolved", done: false },
      priority: 2,
    });
    expect(find(withState, "a")).toMatchObject({
      importedPriority: 2,
      pendingSourceWrite: { state: "Resolved", priority: undefined },
    });

    // A sent level may still land, so the source's level goes after it.
    const sent = markSourceWriteSent(changed, "a");
    expect(
      find(settleBacklogItem(sent, "a", factories, { priority: 2 }), "a")
        ?.pendingSourceWrite,
    ).toMatchObject({ priority: 2 });
  });

  it("keeps a moved item's workflow state when a settle changes only its priority", () => {
    const moved = moveBacklogItemToState(state(), "a", "review", factories, {
      sourceWrites: { a: "Resolved" },
    });
    const settled = settleBacklogItem(moved, "a", factories, { priority: 3 });

    expect(find(settled, "a")).toMatchObject({
      status: "settled",
      workflowStateId: "review",
      importedWorkflowStateId: "review",
      pendingSourceWrite: { state: "Resolved", priority: 3 },
    });
  });
});
