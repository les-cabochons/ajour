import type { LocalWorkItem } from "@/domain/local-state";

type Listener = (items: LocalWorkItem[]) => void;

const listeners = new Set<Listener>();

/**
 * Tells the app about items a sync just put in a description conflict, so it
 * can show a toast that leads to Sync review.
 */
export function announceDescriptionConflicts(items: LocalWorkItem[]) {
  if (items.length === 0) return;
  for (const listener of listeners) listener(items);
}

export function subscribeDescriptionConflicts(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
