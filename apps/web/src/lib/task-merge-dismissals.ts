import { useSyncExternalStore } from "react";

/**
 * Merge suggestions the user answered "Not the same" (#507), per device. They
 * live outside the local app state: an answer never syncs, never reaches a
 * team and is never exported, and a suggestion is computed, never stored.
 */
export const TASK_MERGE_DISMISSALS_STORAGE_KEY = "ajour.task-merge-dismissed";

/** The most pairs remembered; the oldest answers are forgotten first. */
export const TASK_MERGE_DISMISSALS_LIMIT = 500;

/** A suggested pair, as `findTaskMergeSuggestions` gives it. */
export interface TaskMergePair {
  fromTaskId: string;
  intoTaskId: string;
}

function keyOf(projectId: string, pair: TaskMergePair) {
  return `${projectId}:${pair.fromTaskId}:${pair.intoTaskId}`;
}

/** Broken values are dropped. */
export function parseTaskMergeDismissals(value: string | null): string[] {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

/** Adds a pair as the newest answer, keeping at most `limit`. */
export function withTaskMergeDismissal(
  dismissed: readonly string[],
  projectId: string,
  pair: TaskMergePair,
  limit = TASK_MERGE_DISMISSALS_LIMIT,
): string[] {
  const key = keyOf(projectId, pair);
  return [...dismissed.filter((item) => item !== key), key].slice(-limit);
}

export function isTaskMergeDismissed(
  dismissed: readonly string[],
  projectId: string,
  pair: TaskMergePair,
) {
  return dismissed.includes(keyOf(projectId, pair));
}

function read(): string[] {
  try {
    return parseTaskMergeDismissals(
      window.localStorage.getItem(TASK_MERGE_DISMISSALS_STORAGE_KEY),
    );
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return [];
  }
}

let current: string[] | undefined;
const listeners = new Set<() => void>();

function getDismissals() {
  current ??= read();
  return current;
}

/** "Not the same": the pair's suggestion no longer shows on this device. */
export function dismissTaskMergeSuggestion(
  projectId: string,
  pair: TaskMergePair,
) {
  current = withTaskMergeDismissal(getDismissals(), projectId, pair);
  try {
    window.localStorage.setItem(
      TASK_MERGE_DISMISSALS_STORAGE_KEY,
      JSON.stringify(current),
    );
  } catch {
    // The answer then lasts until the window reloads.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const NONE: string[] = [];

/** The pairs dismissed on this device, shared by every Projects page. */
export function useTaskMergeDismissals(): readonly string[] {
  return useSyncExternalStore(subscribe, getDismissals, () => NONE);
}
