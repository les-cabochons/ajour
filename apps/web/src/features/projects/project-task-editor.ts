import type {
  LocalProjectTask,
  PinnedTaskSlot,
  TaskCommitAs,
} from "@/domain/local-state";
import {
  normalizePluginProperties,
  samePluginProperties,
  type PluginProperties,
} from "@/domain/projects/plugin-properties";
import { formatSignedDurationHoursInput } from "@/domain/projects/task-budget";
import {
  formatDurationHoursInput,
  PLANNED_HOURS_LIMIT,
  readDurationInput,
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
  /** The pinned task slot. Undefined means no number key. */
  pinnedSlot: PinnedTaskSlot | undefined;
  /** Plugin task property overrides, of every plugin, active or not. */
  pluginProperties: PluginProperties | undefined;
  /** Not known yet or Local only. Undefined commits under a name. */
  commitAs: TaskCommitAs | undefined;
  /**
   * Another task… is picked in Commits as, for this plugin's name field, and
   * waits for a task. Save stays blocked until the field has one, so the
   * draft never saves something other than what Commits as shows.
   */
  choosingAnotherTask?: { pluginId: string; fieldId: string };
}

/**
 * What Save writes. `undefined` budget, adjustment or slot clears the saved
 * value. A slot another task holds moves to this one.
 */
export interface ProjectTaskValues {
  name: string;
  billable: boolean;
  budgetMs: number | undefined;
  adjustmentMs: number | undefined;
  pinnedSlot: PinnedTaskSlot | undefined;
  pluginProperties: PluginProperties | undefined;
  commitAs: TaskCommitAs | undefined;
}

type SavedTask = Pick<
  LocalProjectTask,
  | "name"
  | "billable"
  | "budgetMs"
  | "adjustmentMs"
  | "pinnedSlot"
  | "pluginProperties"
  | "commitAs"
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
  /** Another task… is picked in Commits as, with no task yet. */
  commitsAsError: string | null;
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
const COMMITS_AS_ERROR = "Pick the task it commits as.";

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
    pinnedSlot: task?.pinnedSlot,
    pluginProperties: task?.pluginProperties,
    commitAs: task?.commitAs,
  };
}

/**
 * Reads an optional duration field, up to 100,000 hours. Text left as it was
 * seeded keeps the saved milliseconds, because the hours text is rounded to
 * the minute.
 */
function readOptionalDuration(
  text: string,
  seededText: string,
  savedMs: number | undefined,
  signed: boolean,
): { durationMs: number | undefined; error: string | null } {
  if (text.trim() === "") {
    return { durationMs: undefined, error: null };
  }

  if (text === seededText && typeof savedMs === "number") {
    return { durationMs: savedMs, error: null };
  }

  const typed = readDurationInput(text, PLANNED_HOURS_LIMIT, { signed });
  return typed.ok
    ? { durationMs: typed.durationMs, error: null }
    : { durationMs: undefined, error: typed.error };
}

/** Evaluates a draft against the saved task it edits, if any. */
export function evaluateProjectTaskEditor(
  fields: ProjectTaskEditorFields,
  original?: SavedTask,
): ProjectTaskEditorState {
  const seeded = createProjectTaskEditorFields(original);
  const name = fields.name.trim();
  const budget = readOptionalDuration(
    fields.budget,
    seeded.budget,
    original?.budgetMs,
    false,
  );
  const adjustment = readOptionalDuration(
    fields.adjustment,
    seeded.adjustment,
    original?.adjustmentMs,
    true,
  );
  const budgetMs = budget.durationMs;
  const adjustmentMs = adjustment.durationMs;
  const nameError = name ? null : NAME_ERROR;
  const budgetError = budget.error;
  const adjustmentError = adjustment.error;
  const choosing = fields.choosingAnotherTask;
  const commitsAsError =
    choosing &&
    !fields.pluginProperties?.[choosing.pluginId]?.[choosing.fieldId]?.trim()
      ? COMMITS_AS_ERROR
      : null;
  const values =
    nameError || budgetError || adjustmentError || commitsAsError
      ? null
      : {
          name,
          billable: fields.billable,
          budgetMs,
          adjustmentMs,
          pinnedSlot: fields.pinnedSlot,
          pluginProperties: normalizePluginProperties(fields.pluginProperties),
          commitAs: fields.commitAs,
        };
  const hasChanges =
    fields.name.trim() !== seeded.name.trim() ||
    fields.billable !== seeded.billable ||
    fields.budget.trim() !== seeded.budget ||
    fields.adjustment.trim() !== seeded.adjustment ||
    fields.pinnedSlot !== seeded.pinnedSlot ||
    fields.commitAs !== seeded.commitAs ||
    Boolean(commitsAsError) ||
    !samePluginProperties(
      normalizePluginProperties(fields.pluginProperties),
      normalizePluginProperties(seeded.pluginProperties),
    );

  return {
    isNew: !original,
    values,
    nameError,
    budgetError,
    adjustmentError,
    commitsAsError,
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
      editor.commitsAsError ??
      NAME_ERROR,
  };
}
