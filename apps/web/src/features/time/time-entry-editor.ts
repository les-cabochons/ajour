import {
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";

export interface TimeEntryEditorFields {
  projectId: string;
  taskId: string;
  note: string;
  durationHours: string;
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
  hasContent: boolean;
  canSave: boolean;
  /** An empty duration on a new entry starts a timer instead of saving. */
  isTimerMode: boolean;
  durationError: string | null;
  /** Values for moving or duplicating to `localDate`, or `null` when the draft cannot be saved. */
  relocationValues(
    localDate: string,
  ): (TimeEntryValues & { localDate: string }) | null;
}

/** Seeds the draft shared by every entry editor host. */
export function createTimeEntryEditorFields(
  entry?: Partial<TimeEntryValues>,
): TimeEntryEditorFields {
  return {
    projectId: entry?.projectId ?? "",
    taskId: entry?.taskId ?? "",
    note: entry?.note ?? "",
    durationHours:
      entry?.durationMs === undefined
        ? ""
        : formatDurationHoursInput(entry.durationMs),
  };
}

/** Resolves draft values without changing precise saved values merely by opening an editor. */
export function evaluateTimeEntryEditor(
  fields: TimeEntryEditorFields,
  options: { original?: TimeEntryValues; allowEmptyDuration?: boolean } = {},
): TimeEntryEditorState {
  const original = options.original;
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
  const values = durationMs === null ? null : { ...metadata, durationMs };
  const hasChanges =
    !original ||
    metadata.projectId !== original.projectId ||
    metadata.taskId !== original.taskId ||
    metadata.note !== original.note ||
    durationMs !== original.durationMs;
  const canSave = durationMs !== null && durationMs > 0;
  return {
    isNew: !original,
    metadata,
    values,
    durationMs,
    hasChanges,
    hasContent: Boolean(
      fields.projectId ||
      fields.taskId ||
      fields.note.trim() ||
      fields.durationHours.trim(),
    ),
    canSave,
    isTimerMode: durationMs === 0,
    durationError:
      durationMs === null
        ? "Enter a valid duration"
        : original && !unchangedDuration && durationMs <= 0
          ? "Enter a positive duration"
          : null,
    relocationValues: (localDate) =>
      canSave && values ? { ...values, localDate } : null,
  };
}

const EMPTY_NEW_ENTRY_ERROR = "Enter hours to save this entry";
const NON_POSITIVE_DURATION_ERROR = "Enter a positive duration";

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
      (editor.isNew ? EMPTY_NEW_ENTRY_ERROR : NON_POSITIVE_DURATION_ERROR),
  };
}
