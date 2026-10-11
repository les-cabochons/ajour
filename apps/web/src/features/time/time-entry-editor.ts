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

/** What a draft means right now: command values, validation, and the actions it allows. */
export interface TimeEntryEditorState {
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

/** Seeds the same draft for inline and dialog time-entry editing. */
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
