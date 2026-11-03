import { createDeviceQueue } from "@/lib/device-queue";

/**
 * Comments typed in the settle dialog, by an agent settling an item, or with
 * Comment and snooze in the comment editor, waiting for their settle or
 * snooze to stand (ADR 0008). Each belongs to one settle or snooze: it is
 * ready once that action's Undo toast closes, and goes to the source tool
 * after the item's pending write lands. Kept per device, outside the local
 * state, so a quit during the Undo window still sends it at the next launch.
 */
export const PENDING_SETTLE_COMMENTS_STORAGE_KEY =
  "ajour.pending-settle-comments";

export interface PendingSettleComment {
  /** One per settle, so a settle's toast acts on its own comment only. */
  id: string;
  itemId: string;
  pluginId: string;
  connectionId: string;
  sourceId: string;
  /** Markdown. Mentions are `[@Name](mention:<id>)`. */
  body: string;
  at: number;
  /** Set when the settle's Undo window closed. Until then it waits. */
  ready?: boolean;
  /** The item's `settleId` right after its settle. Absent on older entries. */
  settleId?: string;
  /** The agent client that settled the item, which must still be allowed to post. */
  agentClient?: string;
  /**
   * Set on a snooze's comment instead of a settle's: the item's `snoozedUntil`
   * right after that snooze.
   */
  snoozedUntil?: number;
}

/**
 * A stored comment. One queued before comments had ids, by a session that
 * quit during its Undo window, gets an id and is ready, as at any launch.
 */
function toPendingComment(value: unknown): PendingSettleComment | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  if (
    !["itemId", "pluginId", "connectionId", "sourceId", "body"].every(
      (key) => typeof entry[key] === "string",
    ) ||
    typeof entry.at !== "number" ||
    (entry.ready !== undefined && typeof entry.ready !== "boolean") ||
    (entry.settleId !== undefined && typeof entry.settleId !== "string") ||
    (entry.agentClient !== undefined &&
      typeof entry.agentClient !== "string") ||
    (entry.snoozedUntil !== undefined && typeof entry.snoozedUntil !== "number")
  ) {
    return undefined;
  }
  const comment = entry as unknown as PendingSettleComment;
  return typeof entry.id === "string"
    ? comment
    : { ...comment, id: `${comment.itemId}:${comment.at}`, ready: true };
}

const queue = createDeviceQueue(
  PENDING_SETTLE_COMMENTS_STORAGE_KEY,
  toPendingComment,
);

/** Broken entries are dropped. */
export const parsePendingSettleComments = queue.parse;

export function queueSettleComment(entry: PendingSettleComment) {
  queue.write([
    ...queue.read().filter((pending) => pending.id !== entry.id),
    entry,
  ]);
}

/** Its settle's or snooze's Undo window closed: it goes once the item's write lands. */
export function markSettleCommentReady(id: string) {
  queue.write(
    queue
      .read()
      .map((entry) => (entry.id === id ? { ...entry, ready: true } : entry)),
  );
}

/** At launch, the session that could undo them is gone. */
export function markSettleCommentsReady() {
  queue.write(queue.read().map((entry) => ({ ...entry, ready: true })));
}

export function settleCommentsOf(itemId: string) {
  return queue.read().filter((entry) => entry.itemId === itemId);
}

/** Takes a comment off the queue, so it is sent or kept at most once. */
export function takeSettleComment(id: string) {
  const entries = queue.read();
  const entry = entries.find((pending) => pending.id === id);
  if (entry) queue.write(entries.filter((pending) => pending.id !== id));
  return entry;
}

/** The comments waiting now, which the launch flush sends. */
export function pendingSettleCommentCount() {
  return queue.read().length;
}

export function settleCommentItemIds() {
  return [...new Set(queue.read().map((entry) => entry.itemId))];
}
