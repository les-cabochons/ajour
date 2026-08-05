import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  addBacklogStatus,
  deleteBacklogStatus,
  normalizeBacklogStatuses,
  setBacklogStatusMapping,
  updateBacklogStatus,
} from "@/domain/backlog/backlog-status";

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

describe("backlog status normalization", () => {
  it("hydrates names, colors, and timestamps for legacy records", () => {
    expect(
      normalizeBacklogStatuses(
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
    ]);
  });
});

describe("backlog status operations", () => {
  it("adds and updates a status with normalized values", () => {
    const added = addBacklogStatus(
      createState(),
      "  In   Progress ",
      "#ABCDEF",
      {
        createId: () => "status-1",
        now: () => 100,
      },
    );
    const updated = updateBacklogStatus(
      added.state,
      added.result,
      "Ready",
    );

    expect(added.result).toBe("status-1");
    expect(updated.backlogStatuses).toEqual([
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
    const mapped = setBacklogStatusMapping(
      createState({
        backlogStatuses: statuses,
        workItems: [createImportedWorkItem()],
      }),
      {
        source: "azure_devops",
        connectionId: "connection-1",
        sourceStatusKey: " Active ",
        backlogStatusId: "status-active",
      },
    );

    expect(mapped.workItems[0]).toMatchObject({
      backlogStatusId: "status-active",
      importedBacklogStatusId: "status-active",
    });

    const deleted = deleteBacklogStatus(
      {
        ...mapped,
        workItems: [
          {
            ...mapped.workItems[0]!,
            backlogStatusId: "status-local",
          },
        ],
      },
      "status-active",
    );

    expect(deleted.backlogStatusMappings).toEqual([]);
    expect(deleted.workItems[0]).toMatchObject({
      backlogStatusId: "status-local",
      importedBacklogStatusId: undefined,
    });
  });
});
