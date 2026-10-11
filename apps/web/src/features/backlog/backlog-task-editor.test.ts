import { describe, expect, it } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  buildBacklogTaskDraft,
  buildBacklogTaskPatch,
  collectBlockedParentIds,
  createBacklogTaskEditorFields,
  validateBacklogTaskEditor,
  parseEstimateInput,
} from "@/features/backlog/backlog-task-editor";

function createWorkItem(overrides: Partial<LocalWorkItem> = {}): LocalWorkItem {
  return {
    _id: "work-item-1",
    title: "Original title",
    status: "active",
    source: "manual",
    projectId: "project-1",
    taskId: "task-1",
    originalEstimateHours: 8,
    remainingEstimateHours: 5,
    completedEstimateHours: 3,
    createdAt: 1,
    ...overrides,
  };
}

describe("backlog task editor", () => {
  it("creates one canonical set of fields from a work item", () => {
    expect(
      createBacklogTaskEditorFields(
        createWorkItem({
          note: "Description",
          priority: 2,
          backlogStatusId: "status-1",
          keepWhenMissingFromSync: true,
        }),
      ),
    ).toEqual({
      title: "Original title",
      note: "Description",
      priority: "2",
      backlogStatusId: "status-1",
      parentWorkItemId: "",
      projectId: "project-1",
      taskId: "task-1",
      originalEstimateHours: "8",
      remainingEstimateHours: "5",
      completedEstimateHours: "3",
      keepWhenMissingFromSync: true,
    });
  });

  it("builds the same normalized patch for every editor surface", () => {
    const workItem = createWorkItem();
    const fields = createBacklogTaskEditorFields(workItem, {
      title: "  Updated title  ",
      note: "  Updated description  ",
      priority: "4",
      originalEstimateHours: "8.12345",
      remainingEstimateHours: "",
      completedEstimateHours: "4.5",
      keepWhenMissingFromSync: true,
    });

    expect(
      buildBacklogTaskPatch(workItem, fields, {
        isSubtask: false,
        includeRetention: true,
      }),
    ).toEqual({
      title: "Updated title",
      note: "Updated description",
      priority: 4,
      backlogStatusId: undefined,
      projectId: "project-1",
      taskId: "task-1",
      originalEstimateHours: 8.1235,
      remainingEstimateHours: undefined,
      completedEstimateHours: 4.5,
      keepWhenMissingFromSync: true,
    });
  });

  it("rejects invalid root values while allowing a subtask without priority", () => {
    const fields = createBacklogTaskEditorFields(undefined, {
      title: "Child",
      parentWorkItemId: "parent-1",
      priority: "1.5",
      remainingEstimateHours: "-1",
    });

    expect(
      validateBacklogTaskEditor(fields, { isSubtask: false }),
    ).toMatchObject({
      priorityError: "Enter a whole number",
      remainingEstimateError: "Enter a non-negative number",
      canSave: false,
    });
    expect(
      validateBacklogTaskEditor(
        {
          ...fields,
          priority: "",
          remainingEstimateHours: "",
        },
        { isSubtask: true, requireParent: true },
      ).canSave,
    ).toBe(true);
  });

  it("rejects estimate values that overflow during normalization", () => {
    expect(parseEstimateInput("1e308")).toBeNull();
  });

  it("builds trimmed root and subtask drafts through one path", () => {
    const rootFields = createBacklogTaskEditorFields(undefined, {
      title: "  Root task  ",
      note: "  Description  ",
      priority: "3",
    });
    const childFields = createBacklogTaskEditorFields(undefined, {
      title: "  Child task  ",
      parentWorkItemId: "parent-1",
      projectId: "project-1",
      taskId: "task-1",
    });

    expect(
      buildBacklogTaskDraft(rootFields, { isSubtask: false }),
    ).toMatchObject({
      title: "Root task",
      note: "Description",
      priority: 3,
      parentWorkItemId: undefined,
    });
    expect(
      buildBacklogTaskDraft(childFields, {
        isSubtask: true,
        requireParent: true,
      }),
    ).toMatchObject({
      title: "Child task",
      parentWorkItemId: "parent-1",
      priority: undefined,
      projectId: "project-1",
      taskId: "task-1",
    });
  });

  it("blocks the edited task and all descendants from parent selection", () => {
    const root = createWorkItem();
    const child = createWorkItem({
      _id: "work-item-2",
      parentWorkItemId: root._id,
      hierarchyLevel: 1,
    });

    expect([...collectBlockedParentIds(root, [root, child])]).toEqual([
      "work-item-1",
      "work-item-2",
    ]);
  });
});
