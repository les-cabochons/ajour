import { connectionAccessAllows } from "@ajour/shared/connection-access";
import type { PluginsOverview } from "@ajour/shared";
import { showErrorToast } from "@/components/ui/toast";
import {
  discardHeldDescription,
  releaseHeldDescription,
} from "@/domain/backlog/description-sync";
import { announcePostedComment } from "@/features/backlog/comment-threads";
import { sendPendingSourceWrites } from "@/features/backlog/backlog-source-writes";
import {
  deleteItemComment,
  editItemComment,
  isAccessOffError,
  postItemComment,
  syncBacklogConnection,
} from "@/lib/app-api";
import { keepCommentAsDraft } from "@/lib/comment-drafts";
import { saveSyncedDescription } from "@/lib/description-save";
import { announceHeldEdit } from "@/lib/held-edit-notice";
import {
  restoreHeldCommentEdit,
  takeHeldCommentEdit,
  type HeldEdit,
} from "@/lib/held-edits";
import { localStore } from "@/lib/local-store";

/*
 * Sending and discarding held edits from Sync review (#395). Sending is the
 * user's approval: the change then goes as it would have, through the same
 * path and its conflict checks, so a source that changed meanwhile still
 * answers with a conflict. A connection that still can't edit holds it
 * again. Discarding drops the change and puts the source's side back.
 */

/** The plugin operation that sends the held change. */
export function heldEditOperation(edit: HeldEdit) {
  switch (edit.kind) {
    case "settle":
      return "writeSettle";
    case "estimate":
      return "pushEstimates";
    case "description":
      return "writeDescription";
    case "comment":
      return "postItemComment";
    case "commentEdit":
      return "editItemComment";
    case "commentDelete":
      return "deleteItemComment";
  }
}

/** Whether the connection's access lets the held change go now. */
export function canSendHeldEdit(
  edit: HeldEdit,
  overview: PluginsOverview | null | undefined,
) {
  const group = overview?.connectionGroups.find(
    (candidate) => candidate.plugin.id === edit.pluginId,
  );
  const connection = group?.connections.find(
    (candidate) => candidate.id === edit.connectionId,
  );
  return Boolean(
    group &&
    connection &&
    !connection.paused &&
    connectionAccessAllows(group, connection, heldEditOperation(edit)),
  );
}

function itemOf(itemId: string) {
  return localStore.snapshot().workItems.find((item) => item._id === itemId);
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Unknown error";

/** Sends one held change, as the user approved it. */
export async function sendHeldEdit(edit: HeldEdit): Promise<void> {
  switch (edit.kind) {
    case "settle":
      localStore.releaseHeldSourceWrite(edit.itemId);
      await sendPendingSourceWrites([edit.itemId]);
      return;
    case "estimate":
      localStore.releaseHeldEstimate(edit.itemId, edit.field);
      try {
        // The sync uploads it, or finds a conflict with the source.
        await syncBacklogConnection(edit.pluginId, edit.connectionId, {
          trigger: "source_write",
        });
      } catch (error) {
        showErrorToast({
          title: `The estimate of "${itemOf(edit.itemId)?.title ?? "an item"}" wasn't sent`,
          description: errorText(error),
        });
      }
      return;
    case "description":
      localStore.updateSyncedDescription(edit.itemId, releaseHeldDescription);
      await saveSyncedDescription(edit.itemId, "save");
      return;
    default:
      await sendHeldComment(edit);
  }
}

async function sendHeldComment(edit: HeldEdit) {
  const entry = takeHeldCommentEdit("id" in edit ? edit.id : "");
  if (!entry) return;
  const title = itemOf(entry.itemId)?.title ?? "an item";
  try {
    if (entry.kind === "comment") {
      const { comment } = await postItemComment(
        entry.pluginId,
        entry.connectionId,
        { sourceId: entry.sourceId, body: entry.body },
        // An agent's comment still needs agents to be allowed to post.
        entry.agentClient
          ? { agent: true, itemId: entry.itemId }
          : { itemId: entry.itemId },
      );
      announcePostedComment(entry, comment);
    } else if (entry.kind === "commentEdit") {
      await editItemComment(
        entry.pluginId,
        entry.connectionId,
        {
          sourceId: entry.sourceId,
          commentId: entry.commentId,
          body: entry.body,
        },
        { itemId: entry.itemId },
      );
    } else {
      await deleteItemComment(entry.pluginId, entry.connectionId, {
        sourceId: entry.sourceId,
        commentId: entry.commentId,
      });
    }
  } catch (error) {
    // Still held: editing was turned off again meanwhile.
    if (isAccessOffError(error)) {
      restoreHeldCommentEdit(entry);
      announceHeldEdit(itemOf(entry.itemId));
      return;
    }
    if (entry.kind === "comment") {
      keepCommentAsDraft(entry.itemId, entry.body);
      showErrorToast({
        title: `Couldn't post the comment on "${title}"`,
        description: `${errorText(error)} It's kept as a draft on the item.`,
      });
    } else if (entry.kind === "commentEdit") {
      // Never lost: it waits here again.
      restoreHeldCommentEdit(entry);
      showErrorToast({
        title: `Couldn't save the comment edit on "${title}"`,
        description: `${errorText(error)} It's still held in Sync review.`,
      });
    } else {
      showErrorToast({
        title: `The comment on "${title}" wasn't deleted`,
        description: errorText(error),
      });
    }
  }
}

/** Drops one held change: nothing is sent, and the source's side comes back. */
export function discardHeldEdit(edit: HeldEdit) {
  switch (edit.kind) {
    case "settle":
      // As a write that failed: the item goes back to where it was.
      localStore.failSourceWrite(edit.itemId);
      return;
    case "estimate":
      localStore.discardHeldEstimate(edit.itemId, edit.field);
      return;
    case "description":
      localStore.updateSyncedDescription(edit.itemId, discardHeldDescription);
      return;
    default:
      takeHeldCommentEdit(edit.id);
  }
}
