import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalTimer,
  type LocalWorkItem,
} from "@/domain/local-state";
import { formatCompactDuration } from "@/domain/time/duration";

const HOUR_MS = 3_600_000;

/**
 * Finds the running entry linked to a backlog item. Action sets and runners
 * use the same lookup so Start entry and Stop agree about ownership.
 */
export function findWorkItemTimer(
  timers: readonly LocalTimer[],
  workItemId: string,
): LocalTimer | undefined {
  return timers.find((timer) => timer.workItemId === workItemId);
}

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
  const remainingMs =
    estimateMs === undefined
      ? undefined
      : estimateMs - context.unsavedDurationMs;

  return {
    title:
      workItem?.title ||
      timer.note?.trim() ||
      task?.name ||
      (project ? getLocalProjectDisplayName(project) : "") ||
      "Untitled entry",
    meta: [projectLabel, task?.name].filter(Boolean).join(" · "),
    workItem,
    remainingMs,
    estimateUsed:
      estimateMs === undefined || remainingMs === undefined
        ? undefined
        : remainingMs <= 0
          ? 1
          : // A correction below the saved time can clear an overrun, or use
            // none of the estimate yet: the bar stays empty.
            estimateMs <= 0
            ? 0
            : Math.min(1, Math.max(0, context.unsavedDurationMs / estimateMs)),
  };
}

/**
 * What the desktop tray icon shows for the running entry: its title, as the
 * dock and the window title show it, and the times the main process counts
 * from, so the window sends it only when the entry changes.
 */
export interface RunningEntryTrayState {
  timerId: string;
  title: string;
  startedAt: number;
  accumulatedMs: number;
}

export function getRunningEntryTrayState(
  timer: LocalTimer | null,
  context: {
    projects: readonly LocalProject[];
    workItems: readonly LocalWorkItem[];
  },
): RunningEntryTrayState | null {
  if (!timer) return null;
  return {
    timerId: timer._id,
    // The title does not depend on the time counted.
    title: summarizeRunningEntry(timer, { ...context, unsavedDurationMs: 0 })
      .title,
    startedAt: timer.startedAt,
    accumulatedMs: timer.accumulatedDurationMs,
  };
}

/** "1h05 left" or "25m over", from `RunningEntrySummary.remainingMs`. */
export function formatRemainingEstimate(remainingMs: number) {
  const value = formatCompactDuration(Math.abs(remainingMs));
  return remainingMs >= 0 ? `${value} left` : `${value} over`;
}

/** Elapsed time with seconds, such as "1:24:07" or "0:04:52". */
export function formatElapsedDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
