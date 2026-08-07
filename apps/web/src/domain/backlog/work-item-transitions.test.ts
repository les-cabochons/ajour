import { describe, expect, it } from "vitest";
import type { LocalAppState } from "@/domain/local-state";
import {
  acceptRemoteEstimateValue,
  addWorkItem,
  deleteWorkItem,
  dismissEstimateIssue,
  keepLocalEstimateConflict,
  normalizePersistedWorkItem,
  setWorkItemStatus,
  updateWorkItem,
} from "@/domain/backlog/work-item-transitions";

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

function createFactories() {
  let nextId = 1;

  return {
    createId: () => `work-item-${nextId++}`,
    now: () => 100,
  };
}

describe("work item transitions", () => {
  it("keeps retired built-in connector work as manual local data", () => {
    const workItem = normalizePersistedWorkItem(
      {
        _id: "legacy-item",
        title: "Imported meeting task",
        status: "active",
        source: "outlook",
        sourceId: "event-1",
        sourceConnectionId: "legacy-connection",
        sourceConnectionLabel: "Calendar",
        parentSourceId: "legacy-parent",
        keepWhenMissingFromSync: true,
        createdAt: 1,
      },
      () => 100,
    );

    expect(workItem).toMatchObject({
      _id: "legacy-item",
      title: "Imported meeting task",
      source: "manual",
      keepWhenMissingFromSync: false,
      archivedByMissingSync: false,
    });
    expect(workItem.sourceId).toBeUndefined();
    expect(workItem.sourceConnectionId).toBeUndefined();
    expect(workItem.sourceConnectionLabel).toBeUndefined();
    expect(workItem.parentSourceId).toBeUndefined();
  });

  it("creates a subtask that follows its parent mapping", () => {
    const factories = createFactories();
    const parent = addWorkItem(
      createState(),
      {
        title: "Parent",
        projectId: "project-1",
        taskId: "task-1",
      },
      factories,
    );
    const child = addWorkItem(
      parent.state,
      {
        title: "Child",
        parentWorkItemId: parent.result,
      },
      factories,
    );

    expect(child.state.workItems[0]).toMatchObject({
      _id: child.result,
      parentWorkItemId: parent.result,
      hierarchyLevel: 1,
      projectId: "project-1",
      taskId: "task-1",
      inheritsParentMapping: true,
      priority: undefined,
    });
  });

  it("propagates parent mapping changes only to inheriting children", () => {
    const factories = createFactories();
    const parent = addWorkItem(
      createState(),
      {
        title: "Parent",
        projectId: "project-1",
        taskId: "task-1",
      },
      factories,
    );
    const inheritedChild = addWorkItem(
      parent.state,
      {
        title: "Inherited child",
        parentWorkItemId: parent.result,
      },
      factories,
    );
    const independentChild = addWorkItem(
      inheritedChild.state,
      {
        title: "Independent child",
        parentWorkItemId: parent.result,
        projectId: "project-2",
        taskId: "task-2",
      },
      factories,
    );
    const updated = updateWorkItem(
      independentChild.state,
      parent.result,
      {
        projectId: "project-3",
        taskId: "task-3",
      },
    );

    expect(
      updated.workItems.find((item) => item._id === inheritedChild.result),
    ).toMatchObject({
      projectId: "project-3",
      taskId: "task-3",
      inheritsParentMapping: true,
    });
    expect(
      updated.workItems.find((item) => item._id === independentChild.result),
    ).toMatchObject({
      projectId: "project-2",
      taskId: "task-2",
      inheritsParentMapping: false,
    });
  });

  it("honors an explicit independent mapping when mapping fields also change", () => {
    const factories = createFactories();
    const parent = addWorkItem(
      createState(),
      { title: "Parent", projectId: "project-1", taskId: "task-1" },
      factories,
    );
    const child = addWorkItem(
      parent.state,
      { title: "Child", parentWorkItemId: parent.result },
      factories,
    );
    const updated = updateWorkItem(child.state, child.result, {
      projectId: "project-2",
      taskId: "task-2",
      inheritsParentMapping: false,
    });

    expect(updated.workItems[0]).toMatchObject({
      projectId: "project-2",
      taskId: "task-2",
      inheritsParentMapping: false,
    });
  });

  it("rejects an empty edited title", () => {
    const created = addWorkItem(
      createState(),
      { title: "Task" },
      createFactories(),
    );

    expect(() =>
      updateWorkItem(created.state, created.result, { title: "  " }),
    ).toThrow("Work item title is required.");
  });

  it("rejects nesting a task that already owns a subtask", () => {
    const factories = createFactories();
    const parent = addWorkItem(
      createState(),
      { title: "Parent" },
      factories,
    );
    const child = addWorkItem(
      parent.state,
      {
        title: "Child",
        parentWorkItemId: parent.result,
      },
      factories,
    );
    const otherParent = addWorkItem(
      child.state,
      { title: "Other parent" },
      factories,
    );

    expect(() =>
      updateWorkItem(otherParent.state, parent.result, {
        parentWorkItemId: otherParent.result,
      }),
    ).toThrow("Tasks with subtasks cannot be nested.");
  });

  it("archives deterministically and deletes a task with its direct children", () => {
    const factories = createFactories();
    const parent = addWorkItem(
      createState(),
      { title: "Parent" },
      factories,
    );
    const child = addWorkItem(
      parent.state,
      {
        title: "Child",
        parentWorkItemId: parent.result,
      },
      factories,
    );
    const archived = setWorkItemStatus(
      child.state,
      parent.result,
      "archived",
      () => 500,
    );
    const deleted = deleteWorkItem(archived, parent.result);

    expect(
      archived.workItems.find((item) => item._id === parent.result),
    ).toMatchObject({
      status: "archived",
      archivedAt: 500,
    });
    expect(deleted.workItems).toEqual([]);
  });

  it("resolves and dismisses estimate conflicts without persistence concerns", () => {
    const factories = createFactories();
    const created = addWorkItem(
      createState(),
      {
        title: "Estimated task",
        remainingEstimateHours: 4,
      },
      factories,
    );
    const withConflict = {
      ...created.state,
      workItems: created.state.workItems.map((workItem) => ({
        ...workItem,
        estimateSync: {
          remainingEstimateHours: {
            baselineValue: 5,
            remoteValue: 6,
            conflict: {
              detectedAt: 200,
              localValue: 4,
              remoteValue: 6,
              baselineValue: 5,
            },
          },
        },
      })),
    };
    const kept = keepLocalEstimateConflict(
      withConflict,
      created.result,
      "remainingEstimateHours",
    );
    const accepted = acceptRemoteEstimateValue(
      withConflict,
      created.result,
      "remainingEstimateHours",
    );
    const dismissed = dismissEstimateIssue(
      withConflict,
      created.result,
      "remainingEstimateHours",
    );

    expect(
      kept.workItems[0]?.estimateSync?.remainingEstimateHours,
    ).toMatchObject({
      resolution: "keep_local",
    });
    expect(accepted.workItems[0]).toMatchObject({
      remainingEstimateHours: 6,
      estimateSync: {
        remainingEstimateHours: {
          baselineValue: 6,
          remoteValue: 6,
          conflict: undefined,
        },
      },
    });
    expect(
      dismissed.workItems[0]?.estimateSync?.remainingEstimateHours,
    ).toMatchObject({
      baselineValue: 5,
      conflict: undefined,
    });
  });

  it("does not erase an estimate when no remote field state exists", () => {
    const created = addWorkItem(
      createState(),
      { title: "Estimated task", remainingEstimateHours: 4 },
      createFactories(),
    );
    const accepted = acceptRemoteEstimateValue(
      created.state,
      created.result,
      "remainingEstimateHours",
    );

    expect(accepted.workItems[0]?.remainingEstimateHours).toBe(4);
  });
});
