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
  const previous = new Map(current.map((record) => [record.id, record]));
  const stable = records.map((record) => {
    const old = previous.get(record.id);
    const visible = ({ checkedAt: _checkedAt, ...value }: Handoff) =>
      JSON.stringify(value);
    return old && visible(old) === visible(record) ? old : record;
  });
  if (
    stable.length === current.length &&
    stable.every((record, i) => record === current[i])
  )
    return;
  current = stable;
  const next = new Map<string, readonly Handoff[]>();
  for (const record of stable) {
    const group = next.get(record.workItemId) ?? [];
    next.set(record.workItemId, [...group, record]);
  }
  for (const [id, group] of next) {
    const old = byItem.get(id);
    if (
      old &&
      old.length === group.length &&
      group.every((record, i) => record === old[i])
    )
      next.set(id, old);
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
