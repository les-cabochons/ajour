import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  archiveBacklogItem,
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
        workItems: [synced("a", { importedPriority: 2, priority: 5 })],
      }),
      "a",
      factories,
      { priority: 1 },
    );

    expect(find(next, "a")).toMatchObject({ importedPriority: 1, priority: 5 });
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
});

describe("sending a settle's write", () => {
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
