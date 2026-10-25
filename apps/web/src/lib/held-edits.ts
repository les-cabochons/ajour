import { useMemo, useSyncExternalStore } from "react";
import { heldItemEdits, type HeldItemEdit } from "@/domain/backlog/held-edits";
import type { LocalWorkItem } from "@/domain/local-state";
import { createDeviceQueue } from "@/lib/device-queue";
import { useLocalWorkItems } from "@/lib/local-hooks";

/*
 * The held-edit store (#395): every change a connection refused because
 * editing work items was off, kept on this computer until the user sends or
 * discards it in Sync review. Changes to a backlog item's own state, a
 * settle or move, an estimate and a description, are held on the item in
 * the local state (`domain/backlog/held-edits.ts`). Comments, their edits
 * and their deletes wait here, in a device queue, as their pending
 * versions do. Nothing here is ever sent without the user's approval, nor
 * dropped without their Discard.
 */

export const HELD_COMMENTS_STORAGE_KEY = "ajour.held-comments";

interface HeldCommentBase {
  id: string;
  itemId: string;
  pluginId: string;
  connectionId: string;
  sourceId: string;
  at: number;
}

/** A held change to a comment thread. */
export type HeldCommentEdit =
  | (HeldCommentBase & {
      kind: "comment";
      /** Markdown. Mentions are `[@Name](mention:<id>)`. */
      body: string;
      /** The agent client that wrote it, if one did. */
      agentClient?: string;
    })
  | (HeldCommentBase & { kind: "commentEdit"; commentId: string; body: string })
  | (HeldCommentBase & { kind: "commentDelete"; commentId: string });

/** Every held change: those kept on items, then those of comment threads. */
export type HeldEdit = HeldItemEdit | HeldCommentEdit;

function toHeldComment(value: unknown): HeldCommentEdit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  const strings = ["id", "itemId", "pluginId", "connectionId", "sourceId"];
  if (
    !strings.every((key) => typeof entry[key] === "string") ||
    typeof entry.at !== "number"
  ) {
    return undefined;
  }
  switch (entry.kind) {
    case "comment":
      return typeof entry.body === "string" &&
        (entry.agentClient === undefined ||
          typeof entry.agentClient === "string")
        ? (entry as unknown as HeldCommentEdit)
        : undefined;
    case "commentEdit":
      return typeof entry.body === "string" &&
        typeof entry.commentId === "string"
        ? (entry as unknown as HeldCommentEdit)
        : undefined;
    case "commentDelete":
      return typeof entry.commentId === "string"
        ? (entry as unknown as HeldCommentEdit)
        : undefined;
    default:
      return undefined;
  }
}

const queue = createDeviceQueue(HELD_COMMENTS_STORAGE_KEY, toHeldComment);
const listeners = new Set<() => void>();
let version = 0;
let cached: { version: number; entries: HeldCommentEdit[] } | undefined;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

/** Broken entries are dropped. */
export const parseHeldComments = queue.parse;

/** The held comment changes, oldest first. */
export function heldCommentEdits(): HeldCommentEdit[] {
  if (cached?.version !== version) {
    cached = { version, entries: queue.read() };
  }
  return cached.entries;
}

let ids = 0;
function nextId(at: number) {
  ids += 1;
  return `held-${at.toString(36)}-${ids}-${Math.random().toString(36).slice(2, 8)}`;
}

type NewHeldComment = HeldCommentEdit extends infer Entry
  ? Entry extends HeldCommentEdit
    ? Omit<Entry, "id" | "at">
    : never
  : never;

/**
 * Holds a comment change the connection refused. An edit or a delete
 * replaces an earlier held change of the same comment.
 */
export function holdCommentEdit(change: NewHeldComment): HeldCommentEdit {
  const at = Date.now();
  const entry = { ...change, id: nextId(at), at } as HeldCommentEdit;
  const sameComment = (other: HeldCommentEdit) =>
    "commentId" in entry &&
    "commentId" in other &&
    other.commentId === entry.commentId &&
    other.pluginId === entry.pluginId &&
    other.connectionId === entry.connectionId &&
    other.sourceId === entry.sourceId;
  queue.write([...queue.read().filter((other) => !sameComment(other)), entry]);
  notify();
  return entry;
}

/** Takes the held change out, to send or discard it. Undefined once gone. */
export function takeHeldCommentEdit(id: string): HeldCommentEdit | undefined {
  const entries = queue.read();
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return undefined;
  queue.write(entries.filter((candidate) => candidate.id !== id));
  notify();
  return entry;
}

/** Puts a held change back, as after a send that was refused again. */
export function restoreHeldCommentEdit(entry: HeldCommentEdit) {
  queue.write([
    ...queue.read().filter((candidate) => candidate.id !== entry.id),
    entry,
  ]);
  notify();
}

/** The thread's comments whose delete is held, so it keeps them hidden. */
export function heldCommentDeleteIds(thread: {
  pluginId: string;
  connectionId: string;
  sourceId: string;
}) {
  return new Set(
    heldCommentEdits()
      .filter(
        (entry) =>
          entry.kind === "commentDelete" &&
          entry.pluginId === thread.pluginId &&
          entry.connectionId === thread.connectionId &&
          entry.sourceId === thread.sourceId,
      )
      .map((entry) => (entry as { commentId: string }).commentId),
  );
}

export function subscribeHeldComments(listener: () => void) {
  listeners.add(listener);
  // Another window's change reaches this one through storage.
  const onStorage = (event: StorageEvent) => {
    if (event.key === HELD_COMMENTS_STORAGE_KEY) notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Every held change, of the items and of the comment threads. */
export function listHeldEdits(
  workItems: readonly LocalWorkItem[],
  comments: readonly HeldCommentEdit[] = heldCommentEdits(),
): HeldEdit[] {
  return [...heldItemEdits(workItems), ...comments].sort(
    (left, right) => left.at - right.at,
  );
}

/** How many changes the connection holds. */
export function heldEditCount(
  edits: readonly HeldEdit[],
  pluginId: string,
  connectionId: string,
) {
  return edits.filter(
    (edit) => edit.pluginId === pluginId && edit.connectionId === connectionId,
  ).length;
}

/** The held changes, kept current as items and comment threads change. */
export function useHeldEdits(): HeldEdit[] {
  const workItems = useLocalWorkItems();
  const comments = useSyncExternalStore(
    subscribeHeldComments,
    heldCommentEdits,
    heldCommentEdits,
  );
  return useMemo(
    () => listHeldEdits(workItems, comments),
    [workItems, comments],
  );
}
