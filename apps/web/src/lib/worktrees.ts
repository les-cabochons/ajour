import { useSyncExternalStore } from "react";
import type { Worktree, WorktreeStartIn } from "@ajour/shared/worktrees";
import { listWorktrees } from "./app-api";

/**
 * The worktrees Ajour made for backlog items on this computer (#860), by
 * id, so a handoff can name the one it runs in. The list loads from the
 * local API the first time a handoff with a worktree shows, and a hand off
 * adds the worktree it started in.
 */

let byId: ReadonlyMap<string, Worktree> = new Map();
const listeners = new Set<() => void>();
let loaded = false;

function publish(next: ReadonlyMap<string, Worktree>) {
  byId = next;
  listeners.forEach((listener) => listener());
}

/** Adds or replaces one worktree, such as the one a hand off just started in. */
export function upsertWorktree(record: Worktree) {
  publish(new Map([...byId, [record.id, record]]));
}

/** Forgets the list, so the next handoff with a worktree loads it again. */
export function resetWorktrees() {
  loaded = false;
  publish(new Map());
}

function listen(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function listenAndLoad(listener: () => void) {
  if (!loaded) {
    loaded = true;
    void listWorktrees()
      .then((records) =>
        // A worktree a hand off added meanwhile is newer than the answer.
        publish(new Map([...records.map((r) => [r.id, r] as const), ...byId])),
      )
      .catch(() => {
        // The next handoff with a worktree asks again.
        loaded = false;
      });
  }
  return listen(listener);
}

/**
 * The worktree of that id, once the list has it. Without an id it asks the
 * local API for nothing, so an item whose threads run in the main folder
 * costs no call.
 */
export function useWorktree(id: string | undefined): Worktree | undefined {
  return useSyncExternalStore(id ? listenAndLoad : listen, () =>
    id ? byId.get(id) : undefined,
  );
}

const defaultStartInListeners = new Set<(startIn: WorktreeStartIn) => void>();

/**
 * Says the default Start in of Settings › Worktrees changed (#864), so a
 * project page open under the Settings window names the new one in its
 * "Settings (<default>)" choice.
 */
export function publishDefaultStartIn(startIn: WorktreeStartIn) {
  defaultStartInListeners.forEach((listener) => listener(startIn));
}

/** Runs `listener` with each new default Start in. Answers how to stop. */
export function onDefaultStartInChange(
  listener: (startIn: WorktreeStartIn) => void,
): () => void {
  defaultStartInListeners.add(listener);
  return () => {
    defaultStartInListeners.delete(listener);
  };
}

/**
 * Whether this window can hand off, and so has worktrees: the desktop app,
 * which maps repository folders. The web build shows nothing of them.
 */
export function hasWorktrees(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.ajourDesktop?.chooseFolder === "function"
  );
}
