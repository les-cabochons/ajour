import type { LocalProjectTask } from "@/domain/local-state";
import {
  formatSignedDurationHoursInput,
  parseSignedHoursInput,
} from "@/domain/projects/task-budget";
import {
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import { isProjectTaskBillable } from "@/features/projects/project-task-options";

/** The task editor's draft: what the user typed, before parsing. */
export interface ProjectTaskEditorFields {
  name: string;
  billable: boolean;
  /** Hours text, such as "12:30". Empty means no budget. */
  budget: string;
  /** Signed hours text, such as "-1:30". Empty means no adjustment. */
  adjustment: string;
}

/** What Save writes. `undefined` budget or adjustment clears the saved value. */
export interface ProjectTaskValues {
  name: string;
  billable: boolean;
  budgetMs: number | undefined;
  adjustmentMs: number | undefined;
}

type SavedTask = Pick<
  LocalProjectTask,
  "name" | "billable" | "budgetMs" | "adjustmentMs"
>;

/** What a draft means right now: values to save, field errors, and whether Save is allowed. */
export interface ProjectTaskEditorState {
  /** The draft creates a task instead of editing a saved one. */
  isNew: boolean;
  /** Values to save, or `null` while a field is invalid. */
  values: ProjectTaskValues | null;
  nameError: string | null;
  budgetError: string | null;
  adjustmentError: string | null;
  hasChanges: boolean;
  canSave: boolean;
}

/**
 * Why the draft is being left. `save` is the Save button or its keys. `switch` is the
 * side panel loading another task, where an untouched new task is simply dropped.
 */
export type ProjectTaskDraftCommitReason = "save" | "switch";

export type ProjectTaskDraftCommit =
  | { kind: "unchanged" }
  | { kind: "save"; values: ProjectTaskValues }
  | { kind: "invalid"; error: string };

const NAME_ERROR = "Enter a task name.";
const BUDGET_ERROR = "Enter a valid non-negative duration.";
const ADJUSTMENT_ERROR = "Enter a valid signed duration.";

/** Seeds the draft from a saved task, or blank for a new one. New tasks are billable. */
export function createProjectTaskEditorFields(
  task?: SavedTask,
): ProjectTaskEditorFields {
  return {
    name: task?.name ?? "",
    billable: task ? isProjectTaskBillable(task) : true,
    budget:
      typeof task?.budgetMs === "number"
        ? formatDurationHoursInput(task.budgetMs)
        : "",
    adjustment:
      typeof task?.adjustmentMs === "number"
        ? formatSignedDurationHoursInput(task.adjustmentMs)
        : "",
  };
}

/**
 * Parses an optional duration field. Text left as it was seeded keeps the saved
 * milliseconds, because the hours text is rounded to the minute.
 */
function parseOptionalDuration(
  text: string,
  seededText: string,
  savedMs: number | undefined,
  parse: (value: string) => number | null,
): number | undefined | null {
  if (text.trim() === "") {
    return undefined;
  }

  if (text === seededText && typeof savedMs === "number") {
    return savedMs;
  }

  return parse(text);
}

/** Evaluates a draft against the saved task it edits, if any. */
export function evaluateProjectTaskEditor(
  fields: ProjectTaskEditorFields,
  original?: SavedTask,
): ProjectTaskEditorState {
  const seeded = createProjectTaskEditorFields(original);
  const name = fields.name.trim();
  const budgetMs = parseOptionalDuration(
    fields.budget,
    seeded.budget,
    original?.budgetMs,
    parseHoursInput,
  );
  const adjustmentMs = parseOptionalDuration(
    fields.adjustment,
    seeded.adjustment,
    original?.adjustmentMs,
    parseSignedHoursInput,
  );
  const nameError = name ? null : NAME_ERROR;
  const budgetError = budgetMs === null ? BUDGET_ERROR : null;
  const adjustmentError = adjustmentMs === null ? ADJUSTMENT_ERROR : null;
  const values =
    nameError || budgetMs === null || adjustmentMs === null
      ? null
      : { name, billable: fields.billable, budgetMs, adjustmentMs };
  const hasChanges =
    fields.name.trim() !== seeded.name.trim() ||
    fields.billable !== seeded.billable ||
    fields.budget.trim() !== seeded.budget ||
    fields.adjustment.trim() !== seeded.adjustment;

  return {
    isNew: !original,
    values,
    nameError,
    budgetError,
    adjustmentError,
    hasChanges,
    canSave: values !== null && (hasChanges || !original),
  };
}

/** Decides what leaving the draft writes, the same way for Save and for switching tasks. */
export function commitProjectTaskDraft(
  editor: ProjectTaskEditorState,
  reason: ProjectTaskDraftCommitReason,
): ProjectTaskDraftCommit {
  if (!editor.hasChanges && (!editor.isNew || reason === "switch")) {
    return { kind: "unchanged" };
  }

  if (editor.values) {
    return { kind: "save", values: editor.values };
  }

  return {
    kind: "invalid",
    error:
      editor.nameError ??
      editor.budgetError ??
      editor.adjustmentError ??
      NAME_ERROR,
  };
}
