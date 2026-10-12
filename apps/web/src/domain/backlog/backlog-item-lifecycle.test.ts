import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  archiveBacklogItem,
  isBacklogItemReturned,
  isBacklogItemSnoozed,
  markBacklogItemOpened,
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
    backlogStatuses: [],
    backlogStatusMappings: [],
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

  it("carries subitems without their own priority and leaves the others", () => {
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

    const next = settleBacklogItem(state, "parent", factories);

    expect(find(next, "follows")).toMatchObject({
      status: "settled",
      settledWithParentId: "parent",
    });
    expect(find(next, "own")?.status).toBe("active");
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
