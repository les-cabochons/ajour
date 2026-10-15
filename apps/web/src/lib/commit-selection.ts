import { useSyncExternalStore } from "react";

/**
 * The changes the user unchecked on the Commit page, by week (its Monday).
 * Memory only: opening a week's Commit page checks every change again, so an
 * unchecked change shows checked the next time. Agent tasks read it through
 * get_week_changes, so they apply only the checked changes.
 */
const uncheckedByWeek = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const NONE: ReadonlySet<string> = new Set();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The week's unchecked changes. The same set until it changes. */
export function getUncheckedChangeIds(weekOf: string): ReadonlySet<string> {
  return uncheckedByWeek.get(weekOf) ?? NONE;
}

/** Checks or unchecks changes of the week. */
export function setChangesChecked(
  weekOf: string,
  entryIds: readonly string[],
  checked: boolean,
) {
  const next = new Set(getUncheckedChangeIds(weekOf));
  for (const entryId of entryIds) {
    if (checked) next.delete(entryId);
    else next.add(entryId);
  }
  uncheckedByWeek.set(weekOf, next);
  notify();
}

/** Checks every change of the week again. */
export function resetCheckedChanges(weekOf: string) {
  if (!uncheckedByWeek.delete(weekOf)) return;
  notify();
}

export function useUncheckedChangeIds(weekOf: string): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => getUncheckedChangeIds(weekOf),
    () => NONE,
  );
}
