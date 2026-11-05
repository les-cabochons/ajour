import { useSyncExternalStore } from "react";
import { createDeviceQueue } from "@/lib/device-queue";

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

const queue = createDeviceQueue(TASK_MERGE_DISMISSALS_STORAGE_KEY, (value) =>
  typeof value === "string" ? value : undefined,
);

/** Broken values are dropped. */
export const parseTaskMergeDismissals = queue.parse;

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
  dismissed: ReadonlySet<string>,
  projectId: string,
  pair: TaskMergePair,
) {
  return dismissed.has(keyOf(projectId, pair));
}

let current: ReadonlySet<string> | undefined;
const listeners = new Set<() => void>();

/** The pairs dismissed on this device. */
export function getTaskMergeDismissals(): ReadonlySet<string> {
  current ??= new Set(queue.read());
  return current;
}

/** "Not the same": the pair's suggestion no longer shows on this device. */
export function dismissTaskMergeSuggestion(
  projectId: string,
  pair: TaskMergePair,
) {
  const next = withTaskMergeDismissal(
    [...getTaskMergeDismissals()],
    projectId,
    pair,
  );
  queue.write(next);
  current = new Set(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const NONE: ReadonlySet<string> = new Set();

/** The pairs dismissed on this device, shared by every Projects page. */
export function useTaskMergeDismissals(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getTaskMergeDismissals, () => NONE);
}
