import { useSyncExternalStore } from "react";
import type { Handoff } from "@ajour/shared/handoffs";
import {
  getHandoffMarks,
  sameHandoffMarks,
  type HandoffMark,
} from "@/domain/handoffs/handoffs";
import { listHandoffs, isPluginApiMissing } from "./app-api";

const EMPTY: readonly Handoff[] = [];
let current: readonly Handoff[] = EMPTY;
let byItem = new Map<string, readonly Handoff[]>();
let marks: ReadonlyMap<string, HandoffMark> = new Map();
const listeners = new Set<() => void>();
const markListeners = new Set<() => void>();
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
  // Backlog rows read one map: it changes only when a row's mark does.
  const nextMarks = getHandoffMarks(stable);
  if (!sameHandoffMarks(marks, nextMarks)) {
    marks = nextMarks;
    markListeners.forEach((listener) => listener());
  }
}

/** Adds or replaces one record, such as a handoff just started. */
export function upsertHandoff(record: Handoff) {
  setHandoffs([...current.filter((old) => old.id !== record.id), record]);
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

/**
 * Every backlog row's handoff mark, keyed by work item id, for lists to
 * subscribe to once. It asks the API for nothing: the window's bridge sends
 * snapshots, and the item page's card loads the list.
 */
export function useHandoffMarks(): ReadonlyMap<string, HandoffMark> {
  return useSyncExternalStore(subscribeMarks, getMarks);
}
function subscribeMarks(listener: () => void) {
  markListeners.add(listener);
  return () => {
    markListeners.delete(listener);
  };
}
const getMarks = () => marks;
