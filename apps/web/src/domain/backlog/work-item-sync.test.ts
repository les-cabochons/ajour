import { describe, expect, it, vi } from "vitest";
import type {
  BacklogImportCandidate,
  BacklogSyncWorkItemUpdate,
} from "@ajour/shared";
import type { LocalAppState } from "@/domain/local-state";
import {
  applyBacklogSyncWorkItemUpdates,
  archiveDoneSyncedWorkItems,
  importSyncedWorkItems,
  returnItemsWithNewComments,
} from "@/domain/backlog/work-item-sync";
import {
  restoreBacklogItem,
  moveBacklogItemToState,
  archiveBacklogItem,
  settleBacklogItem,
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

function createCandidate(
  overrides: Partial<BacklogImportCandidate> = {},
): BacklogImportCandidate {
  return {
    id: "candidate-1",
    source: "azure_devops",
    connectionId: "connection-1",
    connectionLabel: "Main connection",
    tenantLabel: "Contoso",
    sourceId: "source-1",
    externalId: "42",
    sourceUrl: "https://example.test/items/42",
    title: "Imported task",
    projectName: "Mercury",
    workItemType: "Task",
    state: "Active",
    assignedTo: "Local User",
    priority: "high",
    originalEstimateHours: 8,
    remainingEstimateHours: 5,
    completedEstimateHours: 3,
    depth: 0,
    selectable: true,
    selected: true,
    childCount: 0,
    pushedAt: 1,
    ...overrides,
  };
}

const factories = {
  createId: () => "work-item-1",
  now: () => 500,
};

describe("synced work item imports", () => {
  it.each([false, true])(
    "source state and priority changes honor changesEndSnoozeEarly=%s",
    (enabled) => {
      const original = importSyncedWorkItems(
        createState(),
        [createCandidate()],
        undefined,
        factories,
      ).state;
      const state = {
        ...original,
        userPreferences: {
          ...original.userPreferences,
          changesEndSnoozeEarly: enabled,
        },
        workItems: original.workItems.map((item) => ({
          ...item,
          snoozedUntil: 1000,
        })),
      };
      for (const patch of [
        { state: "Review" },
        { priority: "urgent" as const },
      ]) {
        const result = importSyncedWorkItems(
          state,
          [createCandidate(patch)],
          undefined,
          factories,
        ).state.workItems[0]!;
        expect(result.snoozedUntil).toBe(enabled ? undefined : 1000);
        expect(result.returnedAt).toBe(enabled ? 500 : undefined);
      }
      expect(
        importSyncedWorkItems(
          state,
          [createCandidate({ title: "New title" })],
          undefined,
          factories,
        ).state.workItems[0]?.snoozedUntil,
      ).toBe(1000);
    },
  );

  it("keeps a missing-sync return closed when its unchanged state became Done while absent", () => {
    const initial = createState({
      workflowStates: [
        { _id: "doing", name: "Doing", color: "#d97706", createdAt: 1 },
        {
          _id: "done",
          name: "Done",
          color: "#059669",
          done: true,
          createdAt: 1,
        },
      ],
      workflowStateMappings: [
        {
          source: "azure_devops",
          connectionId: "connection-1",
          sourceStatusKey: "active",
          workflowStateId: "doing",
        },
      ],
    });
    const imported = importSyncedWorkItems(
      initial,
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const missing = importSyncedWorkItems(
      imported,
      [],
      { archiveMissingFromConnectionId: "connection-1" },
      factories,
    ).state;
    expect(missing.workItems[0]).toMatchObject({
      status: "archived",
      archivedByMissingSync: true,
      workflowStateId: "doing",
    });
    const configured = updateWorkflowState(missing, "doing", {
      name: "Doing",
      done: true,
    });
    const returned = importSyncedWorkItems(
      configured,
      [createCandidate()],
      undefined,
      factories,
    ).state;
    expect(returned.workItems[0]).toMatchObject({
      status: "archived",
      archivedByMissingSync: false,
      workflowStateId: "doing",
      returnedAt: undefined,
    });
    expect(
      restoreBacklogItem(returned, "work-item-1").workItems[0],
    ).toMatchObject({ status: "active", workflowStateId: undefined });
  });

  it("closes a carried settled subitem reactivated in its unchanged Done state", () => {
    const imported = importSyncedWorkItems(
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
        workflowStateMappings: [
          {
            source: "azure_devops",
            connectionId: "connection-1",
            sourceStatusKey: "active",
            workflowStateId: "todo",
          },
        ],
      }),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const carried = {
      ...imported,
      workItems: [
        {
          ...imported.workItems[0]!,
          status: "settled" as const,
          settledSourceStatusKey: "active",
          settledImportedPriority: 2 as const,
        },
        {
          _id: "child",
          title: "Child",
          createdAt: 1,
          source: "manual" as const,
          status: "settled" as const,
          parentWorkItemId: "work-item-1",
          settledWithParentId: "work-item-1",
          workflowStateId: "done",
        },
      ],
    };
    const returned = importSyncedWorkItems(
      carried,
      [createCandidate({ priority: "urgent" })],
      undefined,
      factories,
    ).state;
    expect(returned.workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: "todo",
    });
    expect(returned.workItems[1]).toMatchObject({
      status: "archived",
      workflowStateId: "done",
      settledWithParentId: undefined,
    });
  });
  it("keeps the plugin's source URL and refreshes it on the next import", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    expect(imported.workItems[0]?.sourceUrl).toBe(
      "https://example.test/items/42",
    );

    const refreshed = importSyncedWorkItems(
      imported,
      [createCandidate({ sourceUrl: "https://example.test/items/42/moved" })],
      undefined,
      factories,
    ).state;
    expect(refreshed.workItems).toHaveLength(1);
    expect(refreshed.workItems[0]?.sourceUrl).toBe(
      "https://example.test/items/42/moved",
    );
  });

  it("creates mapped work items with estimate baselines", () => {
    const operation = importSyncedWorkItems(
      createState({
        workflowStates: [
          {
            _id: "status-active",
            name: "Active",
            color: "#2563eb",
            createdAt: 1,
          },
        ],
        workflowStateMappings: [
          {
            source: "azure_devops",
            connectionId: "connection-1",
            sourceStatusKey: "active",
            workflowStateId: "status-active",
          },
        ],
      }),
      [createCandidate()],
      undefined,
      factories,
    );

    expect(operation.result).toEqual({
      importedCount: 1,
      updatedCount: 0,
      archivedCount: 0,
    });
    expect(operation.state.workItems[0]).toMatchObject({
      _id: "work-item-1",
      workflowStateId: "status-active",
      importedWorkflowStateId: "status-active",
      remainingEstimateHours: 5,
      estimateSync: {
        remainingEstimateHours: {
          baselineValue: 5,
          remoteValue: 5,
        },
      },
    });
  });

  it("archives missing synced work while respecting explicit retention", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const archived = importSyncedWorkItems(
      imported,
      [],
      { archiveMissingFromConnectionId: "connection-1" },
      factories,
    );
    const retained = importSyncedWorkItems(
      {
        ...imported,
        workItems: [
          {
            ...imported.workItems[0]!,
            keepWhenMissingFromSync: true,
          },
        ],
      },
      [],
      { archiveMissingFromConnectionId: "connection-1" },
      factories,
    );

    expect(archived.result.archivedCount).toBe(1);
    expect(archived.state.workItems[0]).toMatchObject({
      status: "archived",
      archivedAt: 500,
    });
    expect(retained.result.archivedCount).toBe(0);
    expect(retained.state.workItems[0]?.status).toBe("active");
  });

  it("refreshes imported values without overwriting local estimate decisions", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const locallyEdited = {
      ...imported,
      workItems: imported.workItems.map((workItem) => ({
        ...workItem,
        remainingEstimateHours: 4,
      })),
    };
    const refreshed = importSyncedWorkItems(
      locallyEdited,
      [createCandidate({ remainingEstimateHours: 6 })],
      undefined,
      factories,
    );

    expect(refreshed.result.updatedCount).toBe(1);
    expect(refreshed.state.workItems[0]).toMatchObject({
      remainingEstimateHours: 4,
      estimateSync: {
        remainingEstimateHours: {
          baselineValue: 5,
          remoteValue: 6,
        },
      },
    });
  });

  it("keeps connection identities separate and deduplicates one import batch", () => {
    const operation = importSyncedWorkItems(
      createState(),
      [
        createCandidate({ title: "First" }),
        createCandidate({ title: "Latest" }),
        createCandidate({
          connectionId: "connection-2",
          connectionLabel: "Other connection",
        }),
      ],
      undefined,
      {
        createId: (() => {
          let id = 0;
          return () => `work-item-${++id}`;
        })(),
        now: () => 500,
      },
    );

    expect(operation.result.importedCount).toBe(2);
    expect(operation.state.workItems).toHaveLength(2);
    expect(operation.state.workItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Latest",
          sourceConnectionId: "connection-1",
        }),
        expect.objectContaining({
          sourceConnectionId: "connection-2",
        }),
      ]),
    );
  });

  it("preserves local notes while refreshing hierarchy metadata", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate({ note: "Remote note" })],
      undefined,
      factories,
    ).state;
    imported.workItems[0]!.description = "Local note";
    const createId = vi.fn(() => "unused");

    const refreshed = importSyncedWorkItems(
      imported,
      [
        createCandidate({
          note: "Changed remote note",
          depth: 1,
          parentSourceId: "parent-1",
        }),
      ],
      undefined,
      { createId, now: () => 500 },
    );

    expect(createId).not.toHaveBeenCalled();
    expect(refreshed.state.workItems[0]).toMatchObject({
      description: "Local note",
      hierarchyLevel: 1,
      parentSourceId: "parent-1",
    });
  });

  it("preserves a user archive and reactivates only sync-archived items", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const userArchived = {
      ...imported,
      workItems: imported.workItems.map((workItem) => ({
        ...workItem,
        status: "archived" as const,
        archivedAt: 400,
        archivedByMissingSync: false,
      })),
    };
    const refreshed = importSyncedWorkItems(
      userArchived,
      [createCandidate()],
      undefined,
      factories,
    );

    expect(refreshed.state.workItems[0]).toMatchObject({
      status: "archived",
      archivedAt: 400,
    });
  });

  it("returns the same state for an unchanged backlog refresh", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const refreshed = importSyncedWorkItems(
      imported,
      [createCandidate()],
      undefined,
      factories,
    );

    expect(refreshed.state).toBe(imported);
    expect(refreshed.result.updatedCount).toBe(0);
  });

  it("adopts imported estimate clears and later values", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate({ remainingEstimateHours: 5 })],
      undefined,
      factories,
    ).state;
    const cleared = importSyncedWorkItems(
      imported,
      [createCandidate({ remainingEstimateHours: undefined })],
      undefined,
      factories,
    ).state;
    const restored = importSyncedWorkItems(
      cleared,
      [createCandidate({ remainingEstimateHours: 7 })],
      undefined,
      factories,
    ).state;

    expect(cleared.workItems[0]?.remainingEstimateHours).toBeUndefined();
    expect(restored.workItems[0]?.remainingEstimateHours).toBe(7);
  });
});

describe("backlog sync of settled items", () => {
  function importAndSettle() {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    return settleBacklogItem(imported, "work-item-1", factories);
  }

  it("brings a settled item back as returned when its state changed in the source", () => {
    const refreshed = importSyncedWorkItems(
      importAndSettle(),
      [createCandidate({ state: "Ready for QA" })],
      undefined,
      factories,
    ).state;

    expect(refreshed.workItems[0]).toMatchObject({
      status: "active",
      returnedAt: 500,
    });
  });

  it("brings a settled item back as returned when its priority changed in the source", () => {
    const refreshed = importSyncedWorkItems(
      importAndSettle(),
      [createCandidate({ priority: "urgent" })],
      undefined,
      factories,
    ).state;

    expect(refreshed.workItems[0]).toMatchObject({
      status: "active",
      returnedAt: 500,
    });
  });

  it("brings back the subitems a returning parent carried when it was settled", () => {
    let id = 0;
    const idFactories = { createId: () => `work-item-${++id}`, now: () => 500 };
    const parent = createCandidate();
    const child = createCandidate({
      id: "candidate-2",
      sourceId: "source-2",
      externalId: "43",
      depth: 1,
      parentSourceId: "source-1",
      priority: undefined,
    });
    const imported = importSyncedWorkItems(
      createState(),
      [parent, child],
      undefined,
      idFactories,
    ).state;
    const parentId = imported.workItems.find(
      (workItem) => workItem.sourceId === "source-1",
    )!._id;
    const settled = settleBacklogItem(imported, parentId, idFactories);

    const refreshed = importSyncedWorkItems(
      settled,
      [{ ...parent, state: "Active again" }, child],
      undefined,
      idFactories,
    ).state;

    expect(
      refreshed.workItems.find((workItem) => workItem.sourceId === "source-2"),
    ).toMatchObject({ status: "active" });
  });

  it("keeps a settle's values while its write waits, without returning the item", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const settled = settleBacklogItem(imported, "work-item-1", factories, {
      state: { name: "Waiting", done: false },
      priority: 1,
    });

    const refreshed = importSyncedWorkItems(
      settled,
      [createCandidate({ title: "Renamed in the source" })],
      undefined,
      factories,
    ).state;

    expect(refreshed.workItems[0]).toMatchObject({
      status: "settled",
      title: "Renamed in the source",
      sourceStatusLabel: "Waiting",
      importedPriority: 1,
      pendingSourceWrite: { state: "Waiting", priority: 1 },
    });
  });

  it("keeps a settled item settled when nothing changed in the source", () => {
    const refreshed = importSyncedWorkItems(
      importAndSettle(),
      [createCandidate()],
      undefined,
      factories,
    ).state;

    expect(refreshed.workItems[0]?.status).toBe("settled");
  });

  it("keeps a subitem's own priority from the source", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [
        createCandidate({
          depth: 1,
          parentSourceId: "parent-1",
          priority: "high",
        }),
      ],
      undefined,
      factories,
    ).state;

    expect(imported.workItems[0]).toMatchObject({
      priority: 2,
      importedPriority: 2,
    });
  });
});

describe("backlog sync of comments on settled items", () => {
  const settledAt = Date.parse("2026-10-18T10:00:00Z");
  const viewer = { id: "me", displayName: "Alex" };
  const ana = { id: "ana", displayName: "Ana Silva" };
  const atSettle = { createId: () => "work-item-1", now: () => settledAt };
  // The settle time the sync asked about, and when it asked.
  const sync = {
    settledSince: new Map([["work-item-1", settledAt]]),
    returnedBySync: new Set(["work-item-1"]),
  };

  function settledItem() {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      atSettle,
    ).state;
    return settleBacklogItem(imported, "work-item-1", atSettle);
  }

  const comment = (
    id: string,
    author: { id: string; displayName: string },
    createdAt: string,
  ) => ({ id, author, createdAt });

  it("brings a settled item back when someone else commented after it was settled", () => {
    const returned = returnItemsWithNewComments(
      settledItem(),
      [
        {
          localWorkItemId: "work-item-1",
          comments: [
            comment(
              "c1",
              { id: "bo", displayName: "Bo" },
              "2026-10-18T11:00:00Z",
            ),
            comment("c2", ana, "2026-10-18T12:00:00Z"),
          ],
        },
      ],
      viewer,
      sync,
      () => 900,
    );

    expect(returned.workItems[0]).toMatchObject({
      status: "active",
      settledAt: undefined,
      returnedAt: 900,
      returnedByComment: { author: "Ana Silva", at: 900 },
    });
  });

  it("keeps the item settled for the user's own comments and earlier ones", () => {
    const state = settledItem();
    const returned = returnItemsWithNewComments(
      state,
      [
        {
          localWorkItemId: "work-item-1",
          comments: [
            comment("c1", viewer, "2026-10-18T11:00:00Z"),
            comment("c2", ana, "2026-10-18T09:00:00Z"),
          ],
        },
      ],
      viewer,
      sync,
      () => 900,
    );

    expect(returned).toBe(state);
  });

  it("leaves active items and unknown ids alone", () => {
    const active = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      atSettle,
    ).state;
    const facts = [
      {
        localWorkItemId: "work-item-1",
        comments: [comment("c1", ana, "2026-10-18T11:00:00Z")],
      },
      {
        localWorkItemId: "missing",
        comments: [comment("c2", ana, "2026-10-18T11:00:00Z")],
      },
    ];

    expect(
      returnItemsWithNewComments(
        active,
        facts,
        viewer,
        { settledSince: new Map(), returnedBySync: new Set<string>() },
        () => 900,
      ),
    ).toBe(active);
  });

  it("leaves an item alone while its settle write waits, so Undo still works", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      atSettle,
    ).state;
    const settled = settleBacklogItem(imported, "work-item-1", atSettle, {
      state: { name: "Waiting", done: false },
    });
    expect(settled.workItems[0]?.pendingSourceWrite).toBeDefined();

    expect(
      returnItemsWithNewComments(
        settled,
        [
          {
            localWorkItemId: "work-item-1",
            comments: [comment("c1", ana, "2026-10-18T10:00:05Z")],
          },
        ],
        viewer,
        sync,
        () => 900,
      ),
    ).toBe(settled);
  });

  it("names who commented on an item the same sync brought back for a source change", () => {
    const changed = importSyncedWorkItems(
      settledItem(),
      [createCandidate({ priority: "urgent" })],
      undefined,
      { ...atSettle, now: () => 800 },
    ).state;
    expect(changed.workItems[0]).toMatchObject({
      status: "active",
      returnedAt: 800,
    });

    const returned = returnItemsWithNewComments(
      changed,
      [
        {
          localWorkItemId: "work-item-1",
          comments: [comment("c1", ana, "2026-10-18T11:00:00Z")],
        },
      ],
      viewer,
      sync,
      () => 900,
    );

    expect(returned.workItems[0]).toMatchObject({
      status: "active",
      returnedAt: 800,
      returnedByComment: { author: "Ana Silva", at: 800 },
    });
  });

  it("keeps an item settled again since the sync asked: the comment predates it", () => {
    const resettled = settleBacklogItem(
      { ...settledItem() },
      "work-item-1",
      atSettle,
    );
    const later = {
      ...resettled,
      workItems: resettled.workItems.map((workItem) => ({
        ...workItem,
        settledAt: settledAt + 180_000,
      })),
    };

    expect(
      returnItemsWithNewComments(
        later,
        [
          {
            localWorkItemId: "work-item-1",
            comments: [comment("c1", ana, "2026-10-18T10:01:00Z")],
          },
        ],
        viewer,
        sync,
        () => 900,
      ),
    ).toBe(later);
  });

  it("leaves a subitem alone while the parent's settle that carried it waits to write", () => {
    let id = 0;
    const idFactories = {
      createId: () => `work-item-${++id}`,
      now: () => settledAt,
    };
    const imported = importSyncedWorkItems(
      createState(),
      [
        createCandidate(),
        createCandidate({
          id: "candidate-2",
          sourceId: "source-2",
          externalId: "43",
          depth: 1,
          parentSourceId: "source-1",
          priority: undefined,
        }),
      ],
      undefined,
      idFactories,
    ).state;
    const parentId = imported.workItems.find(
      (workItem) => workItem.sourceId === "source-1",
    )!._id;
    const childId = imported.workItems.find(
      (workItem) => workItem.sourceId === "source-2",
    )!._id;
    const settled = settleBacklogItem(
      imported,
      parentId,
      idFactories,
      { state: { name: "Waiting", done: false } },
      { includeSubitems: true },
    );
    expect(
      settled.workItems.find((workItem) => workItem._id === childId),
    ).toMatchObject({ status: "settled", settledWithParentId: parentId });

    expect(
      returnItemsWithNewComments(
        settled,
        [
          {
            localWorkItemId: childId,
            comments: [comment("c1", ana, "2026-10-18T10:00:05Z")],
          },
        ],
        viewer,
        {
          settledSince: new Map([[childId, settledAt]]),
          returnedBySync: new Set<string>(),
        },
        () => 900,
      ),
    ).toBe(settled);
  });

  it("leaves the name another sync's answer gave", () => {
    // A later sync returned the item and named Ana; this older answer
    // didn't return it, so its earlier comment by Bob names no one.
    const named = {
      ...createState(),
      workItems: importSyncedWorkItems(
        createState(),
        [createCandidate()],
        undefined,
        atSettle,
      ).state.workItems.map((workItem) => ({
        ...workItem,
        returnedAt: 950,
        returnedByComment: { author: "Ana Silva", at: 950 },
      })),
    };

    expect(
      returnItemsWithNewComments(
        named,
        [
          {
            localWorkItemId: "work-item-1",
            comments: [
              comment(
                "c1",
                { id: "bo", displayName: "Bob" },
                "2026-10-18T10:30:00Z",
              ),
            ],
          },
        ],
        viewer,
        {
          settledSince: new Map([["work-item-1", settledAt]]),
          returnedBySync: new Set<string>(),
        },
        () => 900,
      ),
    ).toBe(named);
  });

  it("names no one for an item returned before the sync asked", () => {
    const returnedEarlier = {
      ...createState(),
      workItems: importSyncedWorkItems(
        createState(),
        [createCandidate()],
        undefined,
        atSettle,
      ).state.workItems.map((workItem) => ({ ...workItem, returnedAt: 600 })),
    };

    expect(
      returnItemsWithNewComments(
        returnedEarlier,
        [
          {
            localWorkItemId: "work-item-1",
            comments: [comment("c1", ana, "2026-10-18T11:00:00Z")],
          },
        ],
        viewer,
        { ...sync, returnedBySync: new Set<string>() },
        () => 900,
      ),
    ).toBe(returnedEarlier);
  });

  it("names someone when the source has no display name", () => {
    const returned = returnItemsWithNewComments(
      settledItem(),
      [
        {
          localWorkItemId: "work-item-1",
          comments: [
            comment("c1", { id: "x", displayName: "" }, "2026-10-18T11:00:00Z"),
          ],
        },
      ],
      viewer,
      sync,
      () => 900,
    );

    expect(returned.workItems[0]?.returnedByComment?.author).toBe("Someone");
  });
});

describe("backlog sync of done items", () => {
  const done = (overrides: { sourceId?: string; state?: string } = {}) => ({
    source: "azure_devops",
    connectionId: "connection-1",
    sourceId: "source-1",
    state: "Closed",
    ...overrides,
  });

  function importOne() {
    return importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
  }

  it("archives an active item that reached a done category", () => {
    const result = archiveDoneSyncedWorkItems(importOne(), [done()], factories);

    expect(result.archivedCount).toBe(1);
    expect(result.state.workItems[0]).toMatchObject({
      status: "archived",
      archivedAt: 500,
      archivedByMissingSync: false,
      sourceStatusKey: "closed",
      sourceStatusLabel: "Closed",
    });
  });

  it("archives a settled item with the subitems its settle carried", () => {
    let id = 0;
    const idFactories = { createId: () => `work-item-${++id}`, now: () => 500 };
    const imported = importSyncedWorkItems(
      createState(),
      [
        createCandidate(),
        createCandidate({
          id: "candidate-2",
          sourceId: "source-2",
          externalId: "43",
          depth: 1,
          parentSourceId: "source-1",
          priority: undefined,
        }),
      ],
      undefined,
      idFactories,
    ).state;
    const parentId = imported.workItems.find(
      (workItem) => workItem.sourceId === "source-1",
    )!._id;
    const settled = settleBacklogItem(
      imported,
      parentId,
      idFactories,
      undefined,
      {
        includeSubitems: true,
      },
    );

    const result = archiveDoneSyncedWorkItems(settled, [done()], idFactories);

    expect(result.state.workItems.map((workItem) => workItem.status)).toEqual([
      "archived",
      "archived",
    ]);
  });

  it("ignores done items Ajour never imported, from another connection, or already archived", () => {
    const state = importOne();

    expect(
      archiveDoneSyncedWorkItems(
        state,
        [
          done({ sourceId: "unknown" }),
          { ...done(), connectionId: "connection-2" },
        ],
        factories,
      ),
    ).toEqual({ state, archivedCount: 0 });

    const archived = archiveDoneSyncedWorkItems(
      state,
      [done()],
      factories,
    ).state;
    expect(
      archiveDoneSyncedWorkItems(archived, [done()], {
        ...factories,
        now: () => 900,
      }),
    ).toEqual({ state: archived, archivedCount: 0 });
  });
});

describe("backlog sync of workflow states", () => {
  const workflow = () =>
    createState({
      workflowStates: [
        { _id: "doing", name: "In progress", color: "#d97706", createdAt: 1 },
        { _id: "review", name: "In review", color: "#7c3aed", createdAt: 1 },
        {
          _id: "done",
          name: "Done",
          color: "#059669",
          done: true,
          createdAt: 1,
        },
      ],
      workflowStateMappings: [
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
          workflowStateId: "review",
        },
      ],
    });
  const sync = (state: LocalAppState, overrides = {}) =>
    importSyncedWorkItems(
      state,
      [createCandidate(overrides)],
      undefined,
      factories,
    ).state;

  it("keeps carried subitems closed through source changes mapped Done, then returns them with an open parent", () => {
    const mapped = {
      ...workflow(),
      workflowStateMappings: [
        ...workflow().workflowStateMappings,
        ...["ready a", "ready b"].map((sourceStatusKey) => ({
          source: "azure_devops" as const,
          connectionId: "connection-1",
          sourceStatusKey,
          workflowStateId: "done",
        })),
      ],
    };
    const imported = sync(mapped);
    const parent = imported.workItems[0]!;
    const closed = moveBacklogItemToState(
      {
        ...imported,
        workItems: [
          parent,
          {
            ...parent,
            _id: "child",
            sourceId: "child-source",
            parentWorkItemId: parent._id,
            workflowStateId: "review",
          },
        ],
      },
      parent._id,
      "done",
      factories,
      { includeSubitems: true },
    );
    const baseline = {
      ...closed,
      workItems: closed.workItems.map((item) =>
        item._id === parent._id
          ? {
              ...item,
              sourceStatusKey: "ready a",
              sourceStatusLabel: "Ready A",
              archivedSourceStatusKey: "ready a",
              importedWorkflowStateId: "done",
            }
          : item,
      ),
    };
    const changed = sync(baseline, { state: "Ready B" });
    expect(changed.workItems[0]).toMatchObject({
      status: "archived",
      workflowStateId: "done",
      workflowStateIdBeforeClose: "doing",
    });
    expect(changed.workItems[1]).toBe(baseline.workItems[1]);
    expect(changed.workItems[1]).toMatchObject({
      status: "archived",
      workflowStateId: "done",
      workflowStateIdBeforeClose: "review",
      settledWithParentId: parent._id,
    });
    const reopened = sync(changed, { state: "Active" });
    expect(reopened.workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: "doing",
    });
    expect(reopened.workItems[1]).toMatchObject({
      status: "active",
      workflowStateId: "review",
      settledWithParentId: undefined,
    });
  });

  it("restores the former open workflow after a missing item returns in a source state mapped Done", () => {
    const mapped = {
      ...workflow(),
      workflowStateMappings: [
        ...workflow().workflowStateMappings,
        {
          source: "azure_devops" as const,
          connectionId: "connection-1",
          sourceStatusKey: "ready",
          workflowStateId: "done",
        },
      ],
    };
    const imported = sync(mapped);
    const missing = importSyncedWorkItems(
      imported,
      [],
      { archiveMissingFromConnectionId: "connection-1" },
      factories,
    ).state;
    expect(missing.workItems[0]).toMatchObject({
      status: "archived",
      archivedByMissingSync: true,
      workflowStateId: "doing",
    });
    expect(missing.workItems[0]?.workflowStateIdBeforeClose).toBeUndefined();
    const returned = sync(missing, { state: "Ready" });
    expect(returned.workItems[0]).toMatchObject({
      status: "archived",
      workflowStateId: "done",
      workflowStateIdBeforeClose: "doing",
      archivedByMissingSync: false,
    });
    expect(
      restoreBacklogItem(returned, "work-item-1").workItems[0],
    ).toMatchObject({
      status: "active",
      workflowStateId: "doing",
      workflowStateIdBeforeClose: undefined,
    });
  });

  it("keeps a local move until the source shows a different state", () => {
    const imported = sync(workflow());
    const moved = {
      ...imported,
      workItems: imported.workItems.map((workItem) => ({
        ...workItem,
        workflowStateId: "review",
      })),
    };

    expect(sync(moved).workItems[0]?.workflowStateId).toBe("review");
    expect(
      sync(sync(moved), { state: "Resolved" }).workItems[0]?.workflowStateId,
    ).toBe("review");
    expect(
      sync(moved, { state: "Resolved" }).workItems[0]?.importedWorkflowStateId,
    ).toBe("review");
  });

  it("follows the mapping again when the source state changes", () => {
    const imported = sync(workflow(), { state: "Resolved" });
    const moved = {
      ...imported,
      workItems: imported.workItems.map((workItem) => ({
        ...workItem,
        workflowStateId: "done",
      })),
    };

    expect(sync(moved, { state: "Active" }).workItems[0]?.workflowStateId).toBe(
      "doing",
    );
  });

  it("reopens an archived item that the source shows open in another state", () => {
    const closed = archiveDoneSyncedWorkItems(
      sync(workflow()),
      [
        {
          source: "azure_devops",
          connectionId: "connection-1",
          sourceId: "source-1",
          state: "Closed",
        },
      ],
      factories,
    ).state;
    expect(closed.workItems[0]).toMatchObject({
      status: "archived",
      workflowStateId: "done",
    });

    const reopened = sync(closed, { state: "Active" });
    expect(reopened.workItems[0]).toMatchObject({
      status: "active",
      returnedAt: 500,
      workflowStateId: "doing",
    });
  });

  it("closes an item whose source state now maps to a done state", () => {
    const withDoneMapping = {
      ...workflow(),
      workflowStateMappings: [
        ...workflow().workflowStateMappings,
        {
          source: "azure_devops" as const,
          connectionId: "connection-1",
          sourceStatusKey: "closed",
          workflowStateId: "done",
        },
      ],
    };
    const imported = sync(withDoneMapping);
    const running = {
      ...imported,
      timers: [
        {
          _id: "timer-1",
          startedAt: 100,
          localDate: "2026-10-11",
          workItemId: imported.workItems[0]!._id,
          accumulatedDurationMs: 0,
        },
      ],
    };

    const closed = sync(running, { state: "Closed" });
    expect(closed.workItems[0]).toMatchObject({
      status: "archived",
      workflowStateId: "done",
      workflowStateIdBeforeClose: "doing",
    });
    expect(closed.timers).toEqual([]);

    const fresh = sync(
      { ...withDoneMapping, workItems: [] },
      { state: "Closed" },
    );
    expect(fresh.workItems[0]?.status).toBe("archived");
  });

  it("reopens archived children carried by a parent reopened in the source", () => {
    const imported = sync(workflow());
    const parent = imported.workItems[0]!;
    const closed = {
      ...imported,
      workItems: [
        {
          ...parent,
          status: "archived" as const,
          workflowStateId: "done",
          archivedSourceStatusKey: "closed",
        },
        {
          ...parent,
          _id: "child",
          sourceId: "child-source",
          status: "archived" as const,
          workflowStateId: "done",
          workflowStateIdBeforeClose: "review",
          settledWithParentId: parent._id,
        },
      ],
    };
    const reopened = sync(closed, { state: "Active" });
    expect(
      reopened.workItems.find((item) => item._id === "child"),
    ).toMatchObject({ status: "active", workflowStateId: "review" });
  });

  it("returns a settled item when a changed done source state maps to an open state", () => {
    const mapped = {
      ...workflow(),
      workflowStateMappings: [
        ...workflow().workflowStateMappings,
        {
          source: "azure_devops" as const,
          connectionId: "connection-1",
          sourceStatusKey: "closed",
          workflowStateId: "review",
        },
      ],
    };
    const imported = sync(mapped);
    const settled = {
      ...imported,
      workItems: imported.workItems.map((item) => ({
        ...item,
        status: "settled" as const,
        settledSourceStatusKey: "active",
      })),
    };
    const result = archiveDoneSyncedWorkItems(
      settled,
      [
        {
          source: "azure_devops",
          connectionId: "connection-1",
          sourceId: "source-1",
          state: "Closed",
        },
      ],
      factories,
    );
    expect(result.state.workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: "review",
      returnedAt: 500,
    });
  });

  it("keeps a done source state open when the user mapped it to a state that isn't done", () => {
    const mapped = {
      ...workflow(),
      workflowStateMappings: [
        ...workflow().workflowStateMappings,
        {
          source: "azure_devops" as const,
          connectionId: "connection-1",
          sourceStatusKey: "closed",
          workflowStateId: "review",
        },
      ],
    };
    const result = archiveDoneSyncedWorkItems(
      sync(mapped),
      [
        {
          source: "azure_devops",
          connectionId: "connection-1",
          sourceId: "source-1",
          state: "Closed",
        },
      ],
      factories,
    );

    expect(result.archivedCount).toBe(0);
    expect(result.state.workItems[0]).toMatchObject({
      status: "active",
      workflowStateId: "review",
      sourceStatusLabel: "Closed",
    });
  });

  it("keeps a local Archive when the source still shows the same state", () => {
    const imported = sync(workflow());
    const archived = archiveBacklogItem(
      imported,
      imported.workItems[0]!._id,
      factories,
    );

    expect(sync(archived).workItems[0]?.status).toBe("archived");
  });
  it("keeps an archived pending source write when sync still reports its old open mapping", () => {
    const mapped = workflow();
    mapped.workflowStateMappings.push({
      source: "azure_devops",
      connectionId: "connection-1",
      sourceStatusKey: "closed",
      workflowStateId: "done",
    });
    const imported = sync(mapped, { state: "Resolved" });
    const pending = settleBacklogItem(
      imported,
      imported.workItems[0]!._id,
      factories,
      { state: { name: "Closed", done: true } },
    );
    expect(pending.workItems[0]?.status).toBe("archived");
    expect(
      archiveDoneSyncedWorkItems(
        pending,
        [
          {
            source: "azure_devops",
            connectionId: "connection-1",
            sourceId: "source-1",
            state: "Resolved",
          },
        ],
        factories,
      ),
    ).toEqual({ state: pending, archivedCount: 0 });
  });

  it.each(["changed", "unchanged", "missing"])(
    "handles an archived done item mapped open when its source is %s",
    (sourceChange) => {
      const mapped = workflow();
      const imported = sync(mapped, { state: "Resolved" });
      const parent = imported.workItems[0]!;
      const closed = archiveBacklogItem(
        {
          ...imported,
          workItems: [
            parent,
            {
              ...parent,
              _id: "child",
              sourceId: "child",
              parentWorkItemId: parent._id,
              status: "archived",
              workflowStateId: "done",
              workflowStateIdBeforeClose: "doing",
              settledWithParentId: parent._id,
            },
          ],
        },
        parent._id,
        factories,
      );
      const state =
        sourceChange === "missing"
          ? {
              ...closed,
              workItems: closed.workItems.map((item) =>
                item._id === parent._id
                  ? { ...item, archivedByMissingSync: true }
                  : item,
              ),
            }
          : closed;
      const result = archiveDoneSyncedWorkItems(
        state,
        [
          {
            source: "azure_devops",
            connectionId: "connection-1",
            sourceId: "source-1",
            state: sourceChange === "changed" ? "Active" : "Resolved",
          },
        ],
        factories,
      );
      expect(result.archivedCount).toBe(0);
      const reopened = sourceChange !== "unchanged";
      expect(result.state.workItems[0]).toMatchObject(
        reopened
          ? {
              status: "active",
              workflowStateId: sourceChange === "changed" ? "doing" : "review",
              importedWorkflowStateId:
                sourceChange === "changed" ? "doing" : "review",
              archivedAt: undefined,
              archivedSourceStatusKey: undefined,
              archivedByMissingSync: false,
              workflowStateIdBeforeClose: undefined,
              returnedAt: 500,
            }
          : { status: "archived", workflowStateId: "done" },
      );
      expect(result.state.workItems[1]).toMatchObject(
        reopened
          ? {
              status: "active",
              workflowStateId: "doing",
              settledWithParentId: undefined,
            }
          : { status: "archived" },
      );
      if (!reopened) expect(result.state).toBe(state);
    },
  );

  it.each(["doing", "done"])(
    "refreshes the imported baseline when a changed done source state maps to %s",
    (destination) => {
      const mapped = {
        ...workflow(),
        workflowStateMappings: [
          ...workflow().workflowStateMappings,
          {
            source: "azure_devops" as const,
            connectionId: "connection-1",
            sourceStatusKey: "closed",
            workflowStateId: destination,
          },
        ],
      };
      const imported = sync(mapped);
      const moved = {
        ...imported,
        workItems: imported.workItems.map((item) => ({
          ...item,
          workflowStateId: "review",
        })),
      };
      const result = archiveDoneSyncedWorkItems(
        moved,
        [
          {
            source: "azure_devops",
            connectionId: "connection-1",
            sourceId: "source-1",
            state: "Closed",
          },
        ],
        factories,
      );
      expect(result.state.workItems[0]).toMatchObject({
        workflowStateId: destination,
        importedWorkflowStateId: destination,
        status: destination === "done" ? "archived" : "active",
      });
      if (destination === "done")
        expect(result.state.workItems[0]?.workflowStateIdBeforeClose).toBe(
          "review",
        );
    },
  );
});

describe("backlog estimate sync", () => {
  it("records deterministic conflict details", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const updates: BacklogSyncWorkItemUpdate[] = [
      {
        localWorkItemId: "work-item-1",
        sourceId: "source-1",
        fields: {
          remainingEstimateHours: {
            status: "conflict",
            localValue: 4,
            remoteValue: 6,
            baselineValue: 5,
          },
        },
      },
    ];
    const synced = applyBacklogSyncWorkItemUpdates(
      imported,
      updates,
      () => 700,
    );

    expect(
      synced.workItems[0]?.estimateSync?.remainingEstimateHours?.conflict,
    ).toEqual({
      detectedAt: 700,
      localValue: 4,
      remoteValue: 6,
      baselineValue: 5,
    });
  });

  it("folds split updates and ignores stale source identities", () => {
    const imported = importSyncedWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const synced = applyBacklogSyncWorkItemUpdates(
      imported,
      [
        {
          localWorkItemId: "work-item-1",
          sourceId: "stale-source",
          fields: {
            originalEstimateHours: {
              status: "pulled",
              remoteValue: 99,
            },
          },
        },
        {
          localWorkItemId: "work-item-1",
          sourceId: "source-1",
          fields: {
            remainingEstimateHours: {
              status: "pulled",
              remoteValue: 6,
            },
          },
        },
        {
          localWorkItemId: "work-item-1",
          sourceId: "source-1",
          fields: {
            completedEstimateHours: {
              status: "pulled",
              remoteValue: 4,
            },
          },
        },
      ],
      () => 700,
    );

    expect(synced.workItems[0]).toMatchObject({
      originalEstimateHours: 8,
      remainingEstimateHours: 6,
      completedEstimateHours: 4,
    });
  });
});
