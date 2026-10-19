import { createDeviceQueue } from "@/lib/device-queue";

/**
 * Comments typed in the settle dialog, or by an agent settling an item,
 * waiting for their settle to stand (ADR 0008). Each belongs to one settle:
 * it is ready once that settle's Undo toast closes, and goes to the source
 * tool after the item's pending write lands. Kept per device, outside the
 * local state, so a quit during the Undo window still sends it at the next
 * launch.
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
}

const isPendingComment = (value: unknown): value is PendingSettleComment => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    ["id", "itemId", "pluginId", "connectionId", "sourceId", "body"].every(
      (key) => typeof entry[key] === "string",
    ) &&
    typeof entry.at === "number" &&
    (entry.ready === undefined || typeof entry.ready === "boolean")
  );
};

const queue = createDeviceQueue(
  PENDING_SETTLE_COMMENTS_STORAGE_KEY,
  isPendingComment,
);

/** Broken entries are dropped. */
export const parsePendingSettleComments = queue.parse;

export function queueSettleComment(entry: PendingSettleComment) {
  queue.write([
    ...queue.read().filter((pending) => pending.id !== entry.id),
    entry,
  ]);
}

/** Its settle's Undo window closed: it goes once the item's write lands. */
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

export function settleCommentItemIds() {
  return [...new Set(queue.read().map((entry) => entry.itemId))];
}
