import { showErrorToast } from "@/components/ui/toast";
import { deleteItemComment } from "@/lib/app-api";
import { createDeviceQueue } from "@/lib/device-queue";

/**
 * Deleted comments waiting for their Undo window (ADR 0008, through ADR
 * 0001's mechanism): the comment hides at once, and the delete goes to the
 * source tool when the Undo toast closes, or at the next launch if Ajour
 * quit first. Kept per device, outside the local state.
 */
export const PENDING_COMMENT_DELETES_STORAGE_KEY =
  "ajour.pending-comment-deletes";

export interface PendingCommentDelete {
  itemId: string;
  pluginId: string;
  connectionId: string;
  sourceId: string;
  commentId: string;
  at: number;
}

const isPendingDelete = (value: unknown): value is PendingCommentDelete => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    ["itemId", "pluginId", "connectionId", "sourceId", "commentId"].every(
      (key) => typeof entry[key] === "string",
    ) && typeof entry.at === "number"
  );
};

const queue = createDeviceQueue(PENDING_COMMENT_DELETES_STORAGE_KEY, (value) =>
  isPendingDelete(value) ? value : undefined,
);
const read = queue.read;
const write = queue.write;

/** Broken entries are dropped. */
export const parsePendingCommentDeletes = queue.parse;

/** Comments that wait to be deleted, so the thread keeps them hidden. */
export function pendingCommentDeleteIds() {
  return new Set(read().map((entry) => entry.commentId));
}

export function queueCommentDelete(entry: PendingCommentDelete) {
  write([
    ...read().filter((pending) => pending.commentId !== entry.commentId),
    entry,
  ]);
}

/** Undo: the comment stays and nothing is sent. */
export function cancelCommentDelete(commentId: string) {
  write(read().filter((entry) => entry.commentId !== commentId));
}

/**
 * Sends a queued delete. It leaves the queue first, so a second call never
 * sends it twice. Throws when the source tool refuses it.
 */
export async function sendCommentDelete(commentId: string) {
  const entries = read();
  const entry = entries.find((pending) => pending.commentId === commentId);
  if (!entry) return;
  write(entries.filter((pending) => pending.commentId !== commentId));
  await deleteItemComment(entry.pluginId, entry.connectionId, {
    sourceId: entry.sourceId,
    commentId: entry.commentId,
  });
}

/** At launch, sends the deletes left from a session that quit during Undo. */
export async function flushPendingCommentDeletes() {
  await Promise.all(
    read().map(async (entry) => {
      try {
        await sendCommentDelete(entry.commentId);
      } catch (error) {
        showErrorToast({
          title: "A comment wasn't deleted",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    }),
  );
}
