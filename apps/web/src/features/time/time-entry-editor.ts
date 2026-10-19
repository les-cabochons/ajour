import { isValidLocalDate } from "@/domain/time/local-date";
import {
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";

export interface TimeEntryEditorFields {
  projectId: string;
  taskId: string;
  note: string;
  durationHours: string;
  /** The entry's date, `YYYY-MM-DD`. The running entry hides it: it is always today. */
  localDate: string;
}

/** Project, task, and note as stored on an entry. Empty draft fields become `undefined`. */
export interface TimeEntryMetadata {
  projectId?: string;
  taskId?: string;
  note?: string;
}

/** The saved values a draft is compared against and written back to. */
export interface TimeEntryValues extends TimeEntryMetadata {
  durationMs: number;
  localDate: string;
}

/**
 * What leaving a draft writes. `unchanged` writes nothing, `save` writes `values`,
 * and `invalid` keeps the editor open with `error` shown.
 */
export type TimeEntryDraftCommit =
  | { kind: "unchanged" }
  | { kind: "save"; values: TimeEntryValues }
  | { kind: "invalid"; error: string };

/**
 * Why the draft is being left. `save` is the Save button or its keys. `switch` is the
 * side panel loading another entry, where an empty new entry is simply dropped.
 */
export type TimeEntryDraftCommitReason = "save" | "switch";

/** What a draft means right now: command values, validation, and the actions it allows. */
export interface TimeEntryEditorState {
  /** The draft creates an entry instead of editing a saved one. */
  isNew: boolean;
  metadata: TimeEntryMetadata;
  /** Values to save, or `null` while the duration does not parse. */
  values: TimeEntryValues | null;
  /** Parsed duration. `0` only when the caller allows an empty duration. */
  durationMs: number | null;
  hasChanges: boolean;
  /** The draft has something typed, beyond what a new entry opened with. */
  hasContent: boolean;
  canSave: boolean;
  /**
   * A new entry with no hours. It can only start: Save is disabled, and Enter
   * presses Start. Ajour never saves a 0h entry.
   */
  isTimerMode: boolean;
  durationError: string | null;
  dateError: string | null;
  /** Values for moving or duplicating to `localDate`, or `null` when the draft cannot be saved. */
  relocationValues(localDate: string): TimeEntryValues | null;
}

/** Shown under Hours, and as the blocked Save reason, for a new entry with no hours. */
export const START_OR_ENTER_HOURS_HINT = "Enter hours, or press Start";
const NON_POSITIVE_DURATION_ERROR = "Enter a positive duration";

/** Seeds the draft shared by every entry editor host. */
export function createTimeEntryEditorFields(
  localDate: string,
  entry?: Partial<Omit<TimeEntryValues, "localDate">>,
): TimeEntryEditorFields {
  return {
    projectId: entry?.projectId ?? "",
    taskId: entry?.taskId ?? "",
    note: entry?.note ?? "",
    durationHours:
      entry?.durationMs === undefined
        ? ""
        : formatDurationHoursInput(entry.durationMs),
    localDate,
  };
}

/**
 * Resolves draft values without changing precise saved values merely by opening an editor.
 * `allowEmptyDuration` lets a new entry leave Hours empty to Start it. `isRunning`
 * accepts 0h, because the running entry keeps counting from the time it shows.
 * `prefill` is what a new entry opened with, such as a Week Grid cell's task; a
 * switch drops a new entry left as it opened. `lockReasonFor` blocks a draft on
 * a day of a submitted week.
 */
export function evaluateTimeEntryEditor(
  fields: TimeEntryEditorFields,
  options: {
    original?: TimeEntryValues;
    allowEmptyDuration?: boolean;
    isRunning?: boolean;
    prefill?: TimeEntryEditorFields;
    /**
     * Why entries on a day cannot change, from `getDateLockReason`. A draft on
     * such a day shows it under Date and cannot be saved.
     */
    lockReasonFor?: (localDate: string) => string | undefined;
  } = {},
): TimeEntryEditorState {
  const { original, isRunning = false, prefill } = options;
  const unchangedDuration =
    original !== undefined &&
    fields.durationHours === formatDurationHoursInput(original.durationMs);
  const durationMs = unchangedDuration
    ? original.durationMs
    : options.allowEmptyDuration && !fields.durationHours.trim()
      ? 0
      : parseHoursInput(fields.durationHours);
  const metadata: TimeEntryMetadata = {
    projectId: fields.projectId || undefined,
    taskId: fields.taskId || undefined,
    note:
      original && fields.note === (original.note ?? "")
        ? original.note
        : fields.note.trim() || undefined,
  };
  const values =
    durationMs === null
      ? null
      : { ...metadata, durationMs, localDate: fields.localDate };
  const hasChanges =
    !original ||
    metadata.projectId !== original.projectId ||
    metadata.taskId !== original.taskId ||
    metadata.note !== original.note ||
    durationMs !== original.durationMs ||
    fields.localDate !== original.localDate;
  const dateError = !isValidLocalDate(fields.localDate)
    ? "Enter a date"
    : (options.lockReasonFor?.(fields.localDate) ?? null);
  const canSave =
    durationMs !== null &&
    (durationMs > 0 || (isRunning && durationMs === 0)) &&
    dateError === null;
  return {
    isNew: !original,
    metadata,
    values,
    durationMs,
    hasChanges,
    hasContent: prefill
      ? fields.projectId !== prefill.projectId ||
        fields.taskId !== prefill.taskId ||
        fields.note.trim() !== prefill.note.trim() ||
        fields.durationHours.trim() !== prefill.durationHours.trim() ||
        fields.localDate !== prefill.localDate
      : Boolean(
          fields.projectId ||
          fields.taskId ||
          fields.note.trim() ||
          fields.durationHours.trim(),
        ),
    canSave,
    isTimerMode: !original && durationMs === 0,
    durationError:
      durationMs === null
        ? "Enter a valid duration"
        : original && !isRunning && !unchangedDuration && durationMs <= 0
          ? NON_POSITIVE_DURATION_ERROR
          : null,
    dateError,
    relocationValues: (localDate) =>
      canSave && values ? { ...values, localDate } : null,
  };
}

/**
 * Decides what Save, or switching to another entry, does with a draft. An unchanged
 * saved entry writes nothing. A valid draft is saved. Anything else blocks with an error,
 * except an untouched new entry, which a switch drops.
 */
export function commitTimeEntryDraft(
  editor: TimeEntryEditorState,
  reason: TimeEntryDraftCommitReason,
): TimeEntryDraftCommit {
  if (!editor.isNew && !editor.hasChanges) {
    return { kind: "unchanged" };
  }

  if (editor.isNew && !editor.hasContent && reason === "switch") {
    return { kind: "unchanged" };
  }

  if (editor.canSave && editor.values) {
    return { kind: "save", values: editor.values };
  }

  return {
    kind: "invalid",
    error:
      editor.durationError ??
      editor.dateError ??
      (editor.isNew ? START_OR_ENTER_HOURS_HINT : NON_POSITIVE_DURATION_ERROR),
  };
}
