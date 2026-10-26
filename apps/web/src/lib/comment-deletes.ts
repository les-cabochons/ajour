import { showErrorToast } from "@/components/ui/toast";
import { deleteItemComment } from "@/lib/app-api";
import { createDeviceQueue } from "@/lib/device-queue";
import { heldCommentDeleteIds, holdRefusedComment } from "@/lib/held-edits";
import { wideEvents } from "@/lib/wide-events";

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

/** A comment in one item's thread. Comment ids repeat across sources. */
export type CommentRef = Pick<
  PendingCommentDelete,
  "pluginId" | "connectionId" | "sourceId" | "commentId"
>;

const sameComment = (left: CommentRef, right: CommentRef) =>
  left.pluginId === right.pluginId &&
  left.connectionId === right.connectionId &&
  left.sourceId === right.sourceId &&
  left.commentId === right.commentId;

/**
 * The thread's comments that wait to be deleted, so it keeps them hidden:
 * those in their Undo window, and those whose delete is held for review.
 */
export function pendingCommentDeleteIds(
  thread: Pick<CommentRef, "pluginId" | "connectionId" | "sourceId">,
) {
  return new Set([
    ...read()
      .filter(
        (entry) =>
          entry.pluginId === thread.pluginId &&
          entry.connectionId === thread.connectionId &&
          entry.sourceId === thread.sourceId,
      )
      .map((entry) => entry.commentId),
    ...heldCommentDeleteIds(thread),
  ]);
}

export function queueCommentDelete(entry: PendingCommentDelete) {
  write([...read().filter((pending) => !sameComment(pending, entry)), entry]);
}

/** Undo: the comment stays and nothing is sent. */
export function cancelCommentDelete(comment: CommentRef) {
  write(read().filter((entry) => !sameComment(entry, comment)));
}

/** The deletes waiting now, which the launch flush sends. */
export function pendingCommentDeleteCount() {
  return read().length;
}

/**
 * Sends a queued delete, as one `comment.delete` job. It leaves the queue
 * first, so a second call never sends it twice, and ends `noop`. Throws when
 * the source tool refuses it. A connection that can't edit work items holds
 * it instead, and the comment stays hidden: it answers `held`. The job
 * starts its own trace: it names Ajour's backlog item, never the comment's
 * ID in its source (ADR 0011).
 */
export function sendCommentDelete(
  comment: CommentRef,
): Promise<"sent" | "held" | "gone"> {
  return wideEvents.run(
    "comment.delete",
    { kind: "job", trigger: "system", detached: true },
    async (job) => {
      const entries = read();
      const entry = entries.find((pending) => sameComment(pending, comment));
      if (!entry) {
        job.end("noop");
        return "gone";
      }
      job.set({
        backlog_item: { id: entry.itemId },
        plugin: { id: entry.pluginId },
        connection: { id: entry.connectionId },
        comment: { queued_ms: Math.max(0, Date.now() - entry.at) },
      });
      write(entries.filter((pending) => !sameComment(pending, comment)));
      try {
        await deleteItemComment(entry.pluginId, entry.connectionId, {
          sourceId: entry.sourceId,
          commentId: entry.commentId,
        });
        return "sent";
      } catch (error) {
        if (
          !holdRefusedComment(error, {
            kind: "commentDelete",
            itemId: entry.itemId,
            pluginId: entry.pluginId,
            connectionId: entry.connectionId,
            sourceId: entry.sourceId,
            commentId: entry.commentId,
          })
        ) {
          throw error;
        }
        job.refuse("access_off");
        return "held";
      }
    },
  );
}

/** At launch, sends the deletes left from a session that quit during Undo. */
export async function flushPendingCommentDeletes() {
  await Promise.all(
    read().map(async (entry) => {
      try {
        await sendCommentDelete(entry);
      } catch (error) {
        showErrorToast({
          title: "A comment wasn't deleted",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    }),
  );
}
