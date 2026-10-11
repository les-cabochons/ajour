import { describe, expect, it } from "vitest";
import {
  createTimeEntryEditorFields,
  evaluateTimeEntryEditor,
} from "./time-entry-editor";

describe("time-entry editor", () => {
  it("preserves exact saved duration and note when changing only the project", () => {
    const original = {
      projectId: "project-1",
      note: "  original note  ",
      durationMs: 75_123,
    };
    const fields = {
      ...createTimeEntryEditorFields(original),
      projectId: "project-2",
    };
    expect(evaluateTimeEntryEditor(fields, { original }).values).toEqual({
      projectId: "project-2",
      taskId: undefined,
      note: original.note,
      durationMs: 75_123,
    });
    expect(
      evaluateTimeEntryEditor(createTimeEntryEditorFields(original), {
        original,
      }).hasChanges,
    ).toBe(false);
  });

  it("preserves a positive subminute entry even when its display rounds to zero", () => {
    const original = { durationMs: 12_345 };
    const result = evaluateTimeEntryEditor(
      { ...createTimeEntryEditorFields(original), note: "edited" },
      { original },
    );
    expect(result.values).toMatchObject({ durationMs: 12_345, note: "edited" });
    expect(result.canSave).toBe(true);
    expect(result.isTimerMode).toBe(false);
  });

  it("prepares changed values for save, duplicate, and move through the same seam", () => {
    const original = {
      projectId: "project-1",
      taskId: "task-1",
      durationMs: 75_123,
    };
    const result = evaluateTimeEntryEditor(
      {
        ...createTimeEntryEditorFields(original),
        taskId: "",
        note: "  updated  ",
        durationHours: "1,5",
      },
      { original },
    );
    expect(result.values).toEqual({
      projectId: "project-1",
      taskId: undefined,
      note: "updated",
      durationMs: 5_400_000,
    });
    expect(result.canSave).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.relocationValues("2026-10-12")).toEqual({
      ...result.values,
      localDate: "2026-10-12",
    });
  });

  it("refuses to move or duplicate a draft that cannot be saved", () => {
    const original = { durationMs: 75_123 };
    const fields = createTimeEntryEditorFields(original);
    expect(
      evaluateTimeEntryEditor(
        { ...fields, durationHours: "invalid" },
        { original },
      ).relocationValues("2026-10-12"),
    ).toBeNull();
    expect(
      evaluateTimeEntryEditor(
        { ...fields, durationHours: "0" },
        { original },
      ).relocationValues("2026-10-12"),
    ).toBeNull();
  });

  it("rejects invalid duration and retains the caller's empty-duration policy", () => {
    const fields = {
      ...createTimeEntryEditorFields(),
      note: "draft",
      durationHours: "invalid",
    };
    expect(
      evaluateTimeEntryEditor(fields, { allowEmptyDuration: true }),
    ).toMatchObject({
      values: null,
      canSave: false,
      isTimerMode: false,
      durationError: "Enter a valid duration",
    });
    fields.durationHours = "";
    expect(evaluateTimeEntryEditor(fields).values).toBeNull();
    expect(
      evaluateTimeEntryEditor(fields, { allowEmptyDuration: true }),
    ).toMatchObject({
      values: { note: "draft", durationMs: 0 },
      canSave: false,
      isTimerMode: true,
      hasContent: true,
    });
  });
});
