import type { BacklogSyncRequest } from "@ajour/shared";

export interface BacklogSyncStatus {
  pluginId: string;
  connectionId: string;
  sourceId?: string;
  running: number;
  trigger: BacklogSyncRequest["trigger"];
  lastSuccessAt?: number;
  failedAt?: number;
  error?: string;
}

let snapshot: readonly BacklogSyncStatus[] = [];
let availabilityError: string | undefined;
export const getBacklogSyncAvailability = () => availabilityError;
export function setBacklogSyncAvailability(error?: unknown) {
  const next = error
    ? "Cannot reach the sync service. Data may be out of date."
    : undefined;
  if (next === availabilityError) return;
  availabilityError = next;
  snapshot = [...snapshot];
  for (const notify of listeners) notify();
}
const listeners = new Set<() => void>();
export const getBacklogSyncSnapshot = () => snapshot;
export function subscribeBacklogSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** All entry points, including the scheduler, publish through the same status. */
export function startBacklogSync(status: Omit<BacklogSyncStatus, "running">) {
  const matches = (s: BacklogSyncStatus) =>
    s.pluginId === status.pluginId &&
    s.connectionId === status.connectionId &&
    s.sourceId === status.sourceId;
  const update = (
    change: (previous: BacklogSyncStatus) => BacklogSyncStatus,
  ) => {
    const previous = snapshot.find(matches) ?? { ...status, running: 0 };
    snapshot = [...snapshot.filter((s) => !matches(s)), change(previous)];
    for (const notify of listeners) notify();
  };
  update((s) => ({ ...s, trigger: status.trigger, running: s.running + 1 }));
  return (error?: unknown) =>
    update((s) => ({
      ...s,
      running: Math.max(0, s.running - 1),
      ...(error
        ? {
            failedAt: Date.now(),
            error: error instanceof Error ? error.message : "Sync failed",
          }
        : {
            // An upload brings back no item, so the item is no fresher.
            ...(status.trigger === "source_write"
              ? {}
              : { lastSuccessAt: Date.now() }),
            failedAt: undefined,
            error: undefined,
          }),
    }));
}

/** Resolves at the next change of any backlog sync's status. */
export function nextBacklogSyncChange() {
  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeBacklogSync(() => {
      unsubscribe();
      resolve();
    });
  });
}
