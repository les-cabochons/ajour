import { useSyncExternalStore } from "react";
import type { Handoff } from "@ajour/shared/handoffs";
import { listHandoffs, isPluginApiMissing } from "./app-api";

const EMPTY: readonly Handoff[] = [];
let current: readonly Handoff[] = EMPTY;
let byItem = new Map<string, readonly Handoff[]>();
const listeners = new Set<() => void>();
let loaded = false;
let revision = 0;
export function setHandoffs(records: Handoff[]) {
  revision++;
  loaded = true;
  current = records;
  const next = new Map<string, Handoff[]>();
  for (const record of records) {
    const group = next.get(record.workItemId) ?? [];
    group.push(record);
    next.set(record.workItemId, group);
  }
  byItem = next;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    const startedAt = revision;
    void listHandoffs()
      .then((records) => {
        if (revision === startedAt) setHandoffs(records);
      })
      .catch((error) => {
        if (isPluginApiMissing(error)) setHandoffs([]);
        else loaded = false;
      });
  }
  return () => {
    listeners.delete(listener);
  };
}
export function useHandoffs(workItemId?: string): readonly Handoff[] {
  return useSyncExternalStore(subscribe, () =>
    workItemId === undefined ? current : (byItem.get(workItemId) ?? EMPTY),
  );
}
