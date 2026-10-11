import { describe, expect, it } from "vitest";
import {
  commitProjectTaskDraft,
  createProjectTaskEditorFields,
  evaluateProjectTaskEditor,
} from "./project-task-editor";

const HOUR = 3_600_000;

describe("project task editor", () => {
  it("starts a new task blank and billable", () => {
    expect(createProjectTaskEditorFields()).toEqual({
      name: "",
      billable: true,
      budget: "",
      adjustment: "",
    });
  });

  it("seeds a saved task, treating a missing billable flag as billable", () => {
    expect(
      createProjectTaskEditorFields({
        name: "Build",
        budgetMs: 12.5 * HOUR,
        adjustmentMs: -1.5 * HOUR,
      }),
    ).toEqual({
      name: "Build",
      billable: true,
      budget: "12:30",
      adjustment: "-01:30",
    });
  });

  it("keeps the exact saved budget when only the name changes", () => {
    // 75 seconds over 10 hours shows as "10:01" and would round if re-parsed.
    const original = { name: "Build", budgetMs: 10 * HOUR + 75_000 };
    const fields = {
      ...createProjectTaskEditorFields(original),
      name: "Build v2",
    };

    expect(evaluateProjectTaskEditor(fields, original).values).toEqual({
      name: "Build v2",
      billable: true,
      budgetMs: 10 * HOUR + 75_000,
      adjustmentMs: undefined,
    });
  });

  it("clears the budget and adjustment when their fields are emptied", () => {
    const original = { name: "Build", budgetMs: HOUR, adjustmentMs: HOUR };
    const fields = {
      ...createProjectTaskEditorFields(original),
      budget: " ",
      adjustment: "",
    };

    expect(evaluateProjectTaskEditor(fields, original).values).toMatchObject({
      budgetMs: undefined,
      adjustmentMs: undefined,
    });
  });

  it("parses a signed adjustment", () => {
    const fields = {
      ...createProjectTaskEditorFields(),
      name: "Build",
      adjustment: "-0:45",
    };

    expect(evaluateProjectTaskEditor(fields).values?.adjustmentMs).toBe(
      -45 * 60_000,
    );
  });

  it("reports invalid fields and blocks Save", () => {
    const editor = evaluateProjectTaskEditor({
      name: "  ",
      billable: true,
      budget: "-2",
      adjustment: "soon",
      pinnedSlot: undefined,
    });

    expect(editor).toMatchObject({
      values: null,
      canSave: false,
      nameError: "Enter a task name.",
      budgetError: "Enter a valid non-negative duration.",
      adjustmentError: "Enter a valid signed duration.",
    });
  });

  it("disables Save on a saved task until something changes", () => {
    const original = { name: "Build", billable: false };
    const fields = createProjectTaskEditorFields(original);

    expect(evaluateProjectTaskEditor(fields, original).canSave).toBe(false);
    expect(
      evaluateProjectTaskEditor({ ...fields, billable: true }, original)
        .canSave,
    ).toBe(true);
  });

  describe("commit", () => {
    it("writes nothing for an unchanged saved task", () => {
      const original = { name: "Build" };
      const editor = evaluateProjectTaskEditor(
        createProjectTaskEditorFields(original),
        original,
      );

      expect(commitProjectTaskDraft(editor, "save")).toEqual({
        kind: "unchanged",
      });
    });

    it("drops an untouched new task when switching, but asks for a name on Save", () => {
      const editor = evaluateProjectTaskEditor(createProjectTaskEditorFields());

      expect(commitProjectTaskDraft(editor, "switch")).toEqual({
        kind: "unchanged",
      });
      expect(commitProjectTaskDraft(editor, "save")).toEqual({
        kind: "invalid",
        error: "Enter a task name.",
      });
    });

    it("saves valid changes when switching", () => {
      const original = { name: "Build" };
      const editor = evaluateProjectTaskEditor(
        { ...createProjectTaskEditorFields(original), name: " Ship " },
        original,
      );

      expect(commitProjectTaskDraft(editor, "switch")).toEqual({
        kind: "save",
        values: {
          name: "Ship",
          billable: true,
          budgetMs: undefined,
          adjustmentMs: undefined,
        },
      });
    });

    it("blocks a switch while a changed field is invalid", () => {
      const original = { name: "Build" };
      const editor = evaluateProjectTaskEditor(
        { ...createProjectTaskEditorFields(original), budget: "abc" },
        original,
      );

      expect(commitProjectTaskDraft(editor, "switch")).toEqual({
        kind: "invalid",
        error: "Enter a valid non-negative duration.",
      });
    });
  });
});
