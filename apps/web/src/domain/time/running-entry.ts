import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalTimer,
  type LocalWorkItem,
} from "@/domain/local-state";

const HOUR_MS = 3_600_000;

export interface RunningEntrySummary {
  /** The backlog item's title, else the note, the task or the project. */
  title: string;
  /** The project code or name and the task, such as "AJR · Export". */
  meta: string;
  workItem?: LocalWorkItem;
  /**
   * The backlog item's remaining estimate, less any overrun already logged,
   * minus the time running now that is not saved yet. Negative once the item
   * runs past its estimate. Missing without an estimate.
   */
  remainingMs?: number;
  /** How much of that remaining estimate the unsaved time uses, from 0 to 1. */
  estimateUsed?: number;
}

/**
 * What the timer dock and the window title show for the running entry.
 * `unsavedDurationMs` is the running time not yet saved to an entry: saving
 * already takes logged time off the item's remaining estimate, so a continued
 * entry only counts what it added since.
 */
export function summarizeRunningEntry(
  timer: LocalTimer,
  context: {
    projects: readonly LocalProject[];
    workItems: readonly LocalWorkItem[];
    unsavedDurationMs: number;
  },
): RunningEntrySummary {
  const project = context.projects.find(({ _id }) => _id === timer.projectId);
  const task = project?.tasks.find(({ _id }) => _id === timer.taskId);
  const workItem = timer.workItemId
    ? context.workItems.find(({ _id }) => _id === timer.workItemId)
    : undefined;
  const projectLabel = project
    ? project.code?.trim() || getLocalProjectDisplayName(project)
    : undefined;
  // The remaining estimate stops at 0; logged time past it is the overrun.
  const estimateMs =
    workItem?.remainingEstimateHours !== undefined
      ? (workItem.remainingEstimateHours -
          (workItem.remainingEstimateOverrunHours ?? 0)) *
        HOUR_MS
      : undefined;

  return {
    title:
      workItem?.title ||
      timer.note?.trim() ||
      task?.name ||
      (project ? getLocalProjectDisplayName(project) : "") ||
      "Untitled entry",
    meta: [projectLabel, task?.name].filter(Boolean).join(" · "),
    workItem,
    remainingMs:
      estimateMs === undefined
        ? undefined
        : estimateMs - context.unsavedDurationMs,
    estimateUsed:
      estimateMs === undefined
        ? undefined
        : estimateMs <= 0
          ? 1
          : Math.min(1, context.unsavedDurationMs / estimateMs),
  };
}

/** "1.1h left" or "0.4h over", from `RunningEntrySummary.remainingMs`. */
export function formatRemainingEstimate(remainingMs: number) {
  const hours = Math.abs(remainingMs) / HOUR_MS;
  const value = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
  return remainingMs >= 0 ? `${value}h left` : `${value}h over`;
}

/** Elapsed time with seconds, such as "1:24:07" or "0:04:52". */
export function formatElapsedDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
