import { describe, expect, it, vi } from "vitest";
import type {
  ConnectorImportCandidate,
  ConnectorSyncWorkItemUpdate,
} from "@timetracker/shared";
import type { LocalAppState } from "@/domain/local-state";
import {
  applyConnectorSyncWorkItemUpdates,
  importConnectorWorkItems,
} from "@/domain/backlog/work-item-connector";

function createState(
  overrides: Partial<LocalAppState> = {},
): LocalAppState {
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
    },
    updatedAt: 0,
    ...overrides,
  };
}

function createCandidate(
  overrides: Partial<ConnectorImportCandidate> = {},
): ConnectorImportCandidate {
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
    priority: 2,
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

describe("connector work item imports", () => {
  it("creates mapped work items with estimate baselines", () => {
    const operation = importConnectorWorkItems(
      createState({
        backlogStatuses: [
          {
            _id: "status-active",
            name: "Active",
            color: "#2563eb",
            createdAt: 1,
          },
        ],
        backlogStatusMappings: [
          {
            source: "azure_devops",
            connectionId: "connection-1",
            sourceStatusKey: "active",
            backlogStatusId: "status-active",
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
      backlogStatusId: "status-active",
      importedBacklogStatusId: "status-active",
      remainingEstimateHours: 5,
      estimateSync: {
        remainingEstimateHours: {
          baselineValue: 5,
          remoteValue: 5,
        },
      },
    });
  });

  it("archives missing connector work while respecting explicit retention", () => {
    const imported = importConnectorWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const archived = importConnectorWorkItems(
      imported,
      [],
      { archiveMissingFromConnectionId: "connection-1" },
      factories,
    );
    const retained = importConnectorWorkItems(
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
    const imported = importConnectorWorkItems(
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
    const refreshed = importConnectorWorkItems(
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
    const operation = importConnectorWorkItems(
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
    const imported = importConnectorWorkItems(
      createState(),
      [createCandidate({ note: "Remote note" })],
      undefined,
      factories,
    ).state;
    imported.workItems[0]!.note = "Local note";
    const createId = vi.fn(() => "unused");

    const refreshed = importConnectorWorkItems(
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
      note: "Local note",
      hierarchyLevel: 1,
      parentSourceId: "parent-1",
    });
  });

  it("preserves a user archive and reactivates only sync-archived items", () => {
    const imported = importConnectorWorkItems(
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
    const refreshed = importConnectorWorkItems(
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

  it("returns the same state for an unchanged connector refresh", () => {
    const imported = importConnectorWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const refreshed = importConnectorWorkItems(
      imported,
      [createCandidate()],
      undefined,
      factories,
    );

    expect(refreshed.state).toBe(imported);
    expect(refreshed.result.updatedCount).toBe(0);
  });

  it("adopts imported estimate clears and later values", () => {
    const imported = importConnectorWorkItems(
      createState(),
      [createCandidate({ remainingEstimateHours: 5 })],
      undefined,
      factories,
    ).state;
    const cleared = importConnectorWorkItems(
      imported,
      [createCandidate({ remainingEstimateHours: undefined })],
      undefined,
      factories,
    ).state;
    const restored = importConnectorWorkItems(
      cleared,
      [createCandidate({ remainingEstimateHours: 7 })],
      undefined,
      factories,
    ).state;

    expect(cleared.workItems[0]?.remainingEstimateHours).toBeUndefined();
    expect(restored.workItems[0]?.remainingEstimateHours).toBe(7);
  });
});

describe("connector estimate sync", () => {
  it("records deterministic conflict details", () => {
    const imported = importConnectorWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const updates: ConnectorSyncWorkItemUpdate[] = [
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
    const synced = applyConnectorSyncWorkItemUpdates(
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
    const imported = importConnectorWorkItems(
      createState(),
      [createCandidate()],
      undefined,
      factories,
    ).state;
    const synced = applyConnectorSyncWorkItemUpdates(
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
