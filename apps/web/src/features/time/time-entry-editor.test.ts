import { describe, expect, it } from "vitest";
import {
  commitTimeEntryDraft,
  createTimeEntryEditorFields,
  evaluateTimeEntryEditor,
} from "./time-entry-editor";

const DAY = "2026-10-05";

describe("time-entry editor", () => {
  it("preserves exact saved duration and note when changing only the project", () => {
    const original = {
      localDate: DAY,
      projectId: "project-1",
      note: "  original note  ",
      durationMs: 75_123,
    };
    const fields = {
      ...createTimeEntryEditorFields(DAY, original),
      projectId: "project-2",
    };
    expect(evaluateTimeEntryEditor(fields, { original }).values).toEqual({
      projectId: "project-2",
      taskId: undefined,
      note: original.note,
      durationMs: 75_123,
      localDate: DAY,
    });
    expect(
      evaluateTimeEntryEditor(createTimeEntryEditorFields(DAY, original), {
        original,
      }).hasChanges,
    ).toBe(false);
  });

  it("preserves a positive subminute entry even when its display rounds to zero", () => {
    const original = { durationMs: 12_345, localDate: DAY };
    const result = evaluateTimeEntryEditor(
      { ...createTimeEntryEditorFields(DAY, original), note: "edited" },
      { original },
    );
    expect(result.values).toMatchObject({ durationMs: 12_345, note: "edited" });
    expect(result.canSave).toBe(true);
    expect(result.isTimerMode).toBe(false);
  });

  it("prepares changed values for save, duplicate, and move through the same seam", () => {
    const original = {
      localDate: DAY,
      projectId: "project-1",
      taskId: "task-1",
      durationMs: 75_123,
    };
    const result = evaluateTimeEntryEditor(
      {
        ...createTimeEntryEditorFields(DAY, original),
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
      localDate: DAY,
    });
    expect(result.canSave).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.relocationValues("2026-10-12")).toEqual({
      ...result.values,
      localDate: "2026-10-12",
    });
  });

  it("refuses to move or duplicate a draft that cannot be saved", () => {
    const original = { durationMs: 75_123, localDate: DAY };
    const fields = createTimeEntryEditorFields(DAY, original);
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
      ...createTimeEntryEditorFields(DAY),
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

  describe("leaving a draft", () => {
    const original = {
      localDate: DAY,
      projectId: "project-1",
      note: "note",
      durationMs: 75_123,
    };

    it("writes nothing for an unchanged saved entry, on save or switch", () => {
      const editor = evaluateTimeEntryEditor(
        createTimeEntryEditorFields(DAY, original),
        { original },
      );
      expect(commitTimeEntryDraft(editor, "save")).toEqual({
        kind: "unchanged",
      });
      expect(commitTimeEntryDraft(editor, "switch")).toEqual({
        kind: "unchanged",
      });
    });

    it("saves a valid edited draft before switching", () => {
      const editor = evaluateTimeEntryEditor(
        { ...createTimeEntryEditorFields(DAY, original), note: "changed" },
        { original },
      );
      expect(commitTimeEntryDraft(editor, "switch")).toEqual({
        kind: "save",
        values: {
          projectId: "project-1",
          note: "changed",
          durationMs: 75_123,
          localDate: DAY,
        },
      });
    });

    it("blocks the switch when an edited draft is invalid", () => {
      const fields = createTimeEntryEditorFields(DAY, original);
      expect(
        commitTimeEntryDraft(
          evaluateTimeEntryEditor(
            { ...fields, durationHours: "abc" },
            { original },
          ),
          "switch",
        ),
      ).toEqual({ kind: "invalid", error: "Enter a valid duration" });
      expect(
        commitTimeEntryDraft(
          evaluateTimeEntryEditor(
            { ...fields, durationHours: "0" },
            { original },
          ),
          "switch",
        ),
      ).toEqual({ kind: "invalid", error: "Enter a positive duration" });
    });

    it("drops an untouched new entry on switch but asks for hours on save", () => {
      const editor = evaluateTimeEntryEditor(createTimeEntryEditorFields(DAY), {
        allowEmptyDuration: true,
      });
      expect(commitTimeEntryDraft(editor, "switch")).toEqual({
        kind: "unchanged",
      });
      expect(commitTimeEntryDraft(editor, "save")).toEqual({
        kind: "invalid",
        error: "Enter hours, or press Start",
      });
    });

    it("blocks the switch for a new entry with content but no hours", () => {
      const editor = evaluateTimeEntryEditor(
        { ...createTimeEntryEditorFields(DAY), note: "draft" },
        { allowEmptyDuration: true },
      );
      expect(commitTimeEntryDraft(editor, "switch")).toEqual({
        kind: "invalid",
        error: "Enter hours, or press Start",
      });
    });

    it("drops a prefilled new entry on switch until the user changes it", () => {
      const prefill = createTimeEntryEditorFields(DAY, {
        projectId: "project-1",
        taskId: "task-1",
      });
      const untouched = evaluateTimeEntryEditor(prefill, {
        allowEmptyDuration: true,
        prefill,
      });
      expect(commitTimeEntryDraft(untouched, "switch")).toEqual({
        kind: "unchanged",
      });

      const withNote = evaluateTimeEntryEditor(
        { ...prefill, note: "draft" },
        { allowEmptyDuration: true, prefill },
      );
      expect(commitTimeEntryDraft(withNote, "switch")).toEqual({
        kind: "invalid",
        error: "Enter hours, or press Start",
      });
    });

    it("saves a new entry with hours", () => {
      const editor = evaluateTimeEntryEditor(
        { ...createTimeEntryEditorFields(DAY), durationHours: "1:30" },
        { allowEmptyDuration: true },
      );
      expect(commitTimeEntryDraft(editor, "save")).toEqual({
        kind: "save",
        values: {
          projectId: undefined,
          taskId: undefined,
          note: undefined,
          durationMs: 5_400_000,
          localDate: DAY,
        },
      });
    });
  });

  describe("date and running rules", () => {
    const original = { localDate: DAY, note: "note", durationMs: 75_123 };

    it("saves a changed date as a change", () => {
      const editor = evaluateTimeEntryEditor(
        {
          ...createTimeEntryEditorFields(DAY, original),
          localDate: "2026-10-06",
        },
        { original },
      );
      expect(commitTimeEntryDraft(editor, "save")).toEqual({
        kind: "save",
        values: { note: "note", durationMs: 75_123, localDate: "2026-10-06" },
      });
    });

    it("blocks a cleared date", () => {
      const editor = evaluateTimeEntryEditor(
        { ...createTimeEntryEditorFields(DAY, original), localDate: "" },
        { original },
      );
      expect(commitTimeEntryDraft(editor, "save")).toEqual({
        kind: "invalid",
        error: "Enter a date",
      });
    });

    it("blocks a date that is not a calendar day", () => {
      const editor = evaluateTimeEntryEditor(
        {
          ...createTimeEntryEditorFields(DAY, original),
          localDate: "2026-02-30",
        },
        { original },
      );
      expect(editor.dateError).toBe("Enter a date");
      expect(commitTimeEntryDraft(editor, "save")).toEqual({
        kind: "invalid",
        error: "Enter a date",
      });
    });

    it("never offers Save for a new entry with 0h", () => {
      const editor = evaluateTimeEntryEditor(
        { ...createTimeEntryEditorFields(DAY), durationHours: "0" },
        { allowEmptyDuration: true },
      );
      expect(editor).toMatchObject({ canSave: false, isTimerMode: true });
    });

    it("lets the running entry keep a 0h count", () => {
      const running = { localDate: DAY, durationMs: 0 };
      const editor = evaluateTimeEntryEditor(
        { ...createTimeEntryEditorFields(DAY, running), note: "renamed" },
        { original: running, isRunning: true },
      );
      expect(editor).toMatchObject({
        canSave: true,
        isTimerMode: false,
        durationError: null,
      });
    });
  });
  describe("submitted weeks", () => {
    const reason =
      "The week of 2026-10-05 is submitted. Reopen it to change it.";
    const lockReasonFor = (localDate: string) =>
      localDate >= "2026-10-05" && localDate <= "2026-10-11"
        ? reason
        : undefined;

    it("blocks a new entry on a day of a submitted week, with the reason under Date", () => {
      const editor = evaluateTimeEntryEditor(
        { ...createTimeEntryEditorFields(DAY), durationHours: "1:00" },
        { allowEmptyDuration: true, lockReasonFor },
      );

      expect(editor.dateError).toBe(reason);
      expect(editor.canSave).toBe(false);
      expect(commitTimeEntryDraft(editor, "save")).toEqual({
        kind: "invalid",
        error: reason,
      });
    });

    it("refuses to move an entry into a submitted week", () => {
      const original = { localDate: "2026-10-13", durationMs: 3_600_000 };
      const editor = evaluateTimeEntryEditor(
        {
          ...createTimeEntryEditorFields("2026-10-13", original),
          localDate: DAY,
        },
        { original, lockReasonFor },
      );

      expect(editor.canSave).toBe(false);
      expect(editor.dateError).toBe(reason);
    });

    it("leaves an untouched entry of a submitted week alone when switching", () => {
      const original = { localDate: DAY, durationMs: 3_600_000 };
      const editor = evaluateTimeEntryEditor(
        createTimeEntryEditorFields(DAY, original),
        { original, lockReasonFor },
      );

      expect(commitTimeEntryDraft(editor, "switch")).toEqual({
        kind: "unchanged",
      });
    });
  });
});
