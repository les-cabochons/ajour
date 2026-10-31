import { describe, expect, it } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  followChangedItem,
  buildBacklogTaskDraft,
  buildBacklogTaskPatch,
  commitBacklogTaskDraft,
  createBacklogTaskEditorFields,
  createBacklogTaskEditorSeed,
  evaluateBacklogTaskEditor,
  parseEstimateInput,
  sumSubitemEstimates,
  validateBacklogTaskEditor,
  type BacklogTaskEditorFields,
  type BacklogTaskEditorTarget,
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

/** Evaluates the target's seed with `changes` typed over it, as the panel would. */
function editDraft(
  target: BacklogTaskEditorTarget,
  changes: Partial<BacklogTaskEditorFields> = {},
) {
  return evaluateBacklogTaskEditor(
    { ...createBacklogTaskEditorSeed(target), ...changes },
    target,
  );
}

describe("backlog task editor", () => {
  it("creates one canonical set of fields from a work item", () => {
    expect(
      createBacklogTaskEditorFields(
        createWorkItem({
          description: "Description",
          priority: 2,
          workflowStateId: "status-1",
          keepWhenMissingFromSync: true,
        }),
      ),
    ).toEqual({
      title: "Original title",
      description: "Description",
      priority: "2",
      workflowStateId: "status-1",
      parentWorkItemId: "",
      projectId: "project-1",
      taskId: "task-1",
      originalEstimateHours: "8",
      remainingEstimateHours: "5",
      completedEstimateHours: "3",
      keepWhenMissingFromSync: true,
    });
  });

  it("patches only the fields the user changed, normalized", () => {
    const workItem = createWorkItem({ description: "Keep my spacing  " });
    const fields = createBacklogTaskEditorFields(workItem, {
      title: "  Updated title  ",
      priority: "4",
      originalEstimateHours: "8.12345",
      remainingEstimateHours: "",
    });

    expect(
      buildBacklogTaskPatch(workItem, fields, { isSubtask: false }),
    ).toEqual({
      title: "Updated title",
      priority: 4,
      originalEstimateHours: 8.1235,
      remainingEstimateHours: undefined,
    });
  });

  it("never writes a read-only description, even when a sync changed it under the draft", () => {
    const synced = createWorkItem({ description: "Changed by a sync" });
    const fields = createBacklogTaskEditorFields(
      createWorkItem({ description: "From before the sync" }),
      { title: "Renamed" },
    );

    expect(
      buildBacklogTaskPatch(synced, fields, {
        isSubtask: false,
        descriptionReadOnly: true,
      }),
    ).toEqual({ title: "Renamed" });
  });

  it("keeps a description a sync replaced under an untouched draft", () => {
    const synced = createWorkItem({ description: "Updated by a colleague" });
    const fields = createBacklogTaskEditorFields(
      createWorkItem({ description: "Before" }),
      { title: "Renamed" },
    );

    expect(
      buildBacklogTaskPatch(synced, fields, {
        isSubtask: false,
        base: createBacklogTaskEditorFields(
          createWorkItem({ description: "Before" }),
        ),
      }),
    ).toEqual({ title: "Renamed" });
    expect(
      buildBacklogTaskPatch(
        synced,
        { ...fields, description: "My edit" },
        {
          isSubtask: false,
          base: createBacklogTaskEditorFields(
            createWorkItem({ description: "Before" }),
          ),
        },
      ),
    ).toEqual({ title: "Renamed", description: "My edit" });
  });

  it("keeps a mapping a sync changed under an untouched draft", () => {
    const before = createWorkItem({ projectId: "project-1", taskId: "task-1" });
    const synced = createWorkItem({ projectId: "project-2", taskId: "task-2" });
    const fields = createBacklogTaskEditorFields(before, { title: "Renamed" });

    expect(
      buildBacklogTaskPatch(synced, fields, {
        isSubtask: false,
        base: createBacklogTaskEditorFields(before),
      }),
    ).toEqual({ title: "Renamed" });
  });

  it("lets untouched fields follow a sync, and moves project and task as a pair", () => {
    const base = createBacklogTaskEditorFields(
      createWorkItem({
        projectId: "project-a",
        taskId: "task-a1",
        description: "Before",
      }),
    );
    const current = createBacklogTaskEditorFields(
      createWorkItem({
        projectId: "project-b",
        taskId: "task-b1",
        description: "After",
      }),
    );

    // The user picked another task: their pair stays whole.
    const pickedTask = { ...base, taskId: "task-a2", title: "Renamed" };
    expect(followChangedItem(pickedTask, base, current)).toEqual({
      ...current,
      projectId: "project-a",
      taskId: "task-a2",
      title: "Renamed",
    });

    // An untouched draft takes the whole new mapping.
    expect(followChangedItem(base, base, current)).toEqual(current);
  });

  it("changes project and task together", () => {
    const workItem = createWorkItem();
    const fields = createBacklogTaskEditorFields(workItem, {
      taskId: "task-2",
    });

    expect(
      buildBacklogTaskPatch(workItem, fields, { isSubtask: false }),
    ).toEqual({ projectId: "project-1", taskId: "task-2" });
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
      priorityError: "Choose a priority",
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
      description: "  Description  ",
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
      description: "  Description",
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

  describe("panel draft", () => {
    it("starts a new subitem under its parent with the parent's project and task", () => {
      const parent = createWorkItem({ workflowStateId: "status-1" });

      expect(
        createBacklogTaskEditorSeed({ kind: "create", parent }),
      ).toMatchObject({
        parentWorkItemId: "work-item-1",
        projectId: "project-1",
        taskId: "task-1",
        workflowStateId: "",
        title: "",
      });
    });

    it("writes nothing for an unchanged saved item, on save or switch", () => {
      const editor = editDraft({ kind: "edit", workItem: createWorkItem() });

      expect(editor.hasChanges).toBe(false);
      expect(commitBacklogTaskDraft(editor, "save")).toEqual({
        kind: "unchanged",
      });
      expect(commitBacklogTaskDraft(editor, "switch")).toEqual({
        kind: "unchanged",
      });
    });

    it("saves an edited item as a patch of its changes", () => {
      const editor = editDraft(
        { kind: "edit", workItem: createWorkItem() },
        { title: "Renamed", description: "New note" },
      );

      expect(commitBacklogTaskDraft(editor, "switch")).toEqual({
        kind: "update",
        patch: { title: "Renamed", description: "New note" },
      });
    });

    it("blocks an invalid edit with the first field error", () => {
      const editor = editDraft(
        { kind: "edit", workItem: createWorkItem() },
        { title: "  ", completedEstimateHours: "x" },
      );

      expect(commitBacklogTaskDraft(editor, "switch")).toEqual({
        kind: "invalid",
        error: "Enter an item name",
      });
    });

    it("drops an untouched new item on switch but asks for a name on save", () => {
      const editor = editDraft({ kind: "create" });

      expect(commitBacklogTaskDraft(editor, "switch")).toEqual({
        kind: "unchanged",
      });
      expect(commitBacklogTaskDraft(editor, "save")).toEqual({
        kind: "invalid",
        error: "Enter an item name",
      });
    });

    it("creates a new subitem without a priority", () => {
      const parent = createWorkItem();
      const editor = editDraft(
        { kind: "create", parent },
        { title: "Child", priority: "7" },
      );

      expect(editor.isSubitem).toBe(true);
      expect(commitBacklogTaskDraft(editor, "save")).toEqual({
        kind: "create",
        draft: expect.objectContaining({
          title: "Child",
          parentWorkItemId: "work-item-1",
          priority: undefined,
          projectId: "project-1",
          taskId: "task-1",
        }),
      });
    });

    it("offers a reset only for estimates that differ from the subitem total", () => {
      const parent = createWorkItem({
        originalEstimateHours: 8,
        remainingEstimateHours: 4,
        completedEstimateHours: undefined,
      });
      const subitems = [
        createWorkItem({
          _id: "child-1",
          parentWorkItemId: parent._id,
          originalEstimateHours: 5,
          remainingEstimateHours: 2,
          completedEstimateHours: undefined,
        }),
        createWorkItem({
          _id: "child-2",
          parentWorkItemId: parent._id,
          originalEstimateHours: 3,
          remainingEstimateHours: 1.5,
          completedEstimateHours: undefined,
        }),
      ];
      const target: BacklogTaskEditorTarget = {
        kind: "edit",
        workItem: parent,
      };
      const editor = evaluateBacklogTaskEditor(
        createBacklogTaskEditorSeed(target),
        target,
        { subitemTotals: sumSubitemEstimates(subitems) },
      );

      expect(editor.estimateResets).toEqual({ remainingEstimateHours: "3.5" });
      expect(editor.hasChanges).toBe(false);
    });

    it("offers synced priority and status resets only for synced items", () => {
      const synced = createWorkItem({
        source: "azure_devops",
        priority: 1,
        importedPriority: 2,
        workflowStateId: "status-1",
        importedWorkflowStateId: "status-1",
      });

      expect(editDraft({ kind: "edit", workItem: synced })).toMatchObject({
        priorityReset: "2",
        statusReset: null,
      });
      expect(
        editDraft(
          { kind: "edit", workItem: synced },
          { workflowStateId: "status-2" },
        ).statusReset,
      ).toBe("status-1");
      expect(
        editDraft({
          kind: "edit",
          workItem: createWorkItem({ priority: 1 }),
        }).priorityReset,
      ).toBeNull();
    });

    it("refuses No priority on a synced item whose source has a priority, and keeps it for manual items", () => {
      const synced = createWorkItem({
        source: "azure_devops",
        priority: 2,
        importedPriority: 2,
      });
      const cleared = editDraft(
        { kind: "edit", workItem: synced },
        { priority: "" },
      );
      expect(cleared.validation).toMatchObject({
        priorityError: "Ajour can't clear the priority in its source.",
        canSave: false,
      });
      expect(commitBacklogTaskDraft(cleared, "save").kind).toBe("invalid");

      expect(
        editDraft(
          { kind: "edit", workItem: createWorkItem({ priority: 2 }) },
          { priority: "" },
        ).patch,
      ).toEqual({ priority: undefined });
      // An item already at No priority keeps saving its other fields.
      expect(
        editDraft(
          {
            kind: "edit",
            workItem: { ...synced, priority: undefined },
          },
          { title: "Renamed" },
        ).patch,
      ).toEqual({ title: "Renamed" });
    });
  });
});
