import { showErrorToast } from "@/components/ui/toast";
import { isCapabilityActive } from "@ajour/shared";
import type { LocalWorkItem } from "@/domain/local-state";
import { hasSameSourceWriteRequest } from "@/domain/backlog/backlog-item-lifecycle";
import { sourcePriorityFromLevel } from "@/domain/backlog/priority";
import { announcePostedComment } from "@/features/backlog/comment-threads";
import {
  getCachedPluginsOverview,
  postItemComment,
  writeBacklogSettle,
} from "@/lib/app-api";
import { keepCommentAsDraft } from "@/lib/comment-drafts";
import { localStore } from "@/lib/local-store";
import {
  getSettleComment,
  settleCommentItemIds,
  takeSettleComment,
} from "@/lib/settle-comments";

/** Items whose write is on its way, so a second flush doesn't send it twice. */
const sending = new Set<string>();

/**
 * Whether the item is synced and its active plugin can write to the source.
 * Settle then opens the settle dialog, and moves write the new source state.
 * Other items settle and move locally.
 */
export function canWriteToSource(workItem: LocalWorkItem) {
  if (
    workItem.source === "manual" ||
    !workItem.sourceId ||
    !workItem.sourceConnectionId
  ) {
    return false;
  }

  const group = getCachedPluginsOverview()?.connectionGroups.find(
    (candidate) => candidate.plugin.id === workItem.source,
  );
  return Boolean(
    group &&
    isCapabilityActive(group, "connector") &&
    group.plugin.capabilities.connector?.settle,
  );
}

/** Whether Settle on this item opens the settle dialog. */
export const settleOpensDialog = canWriteToSource;

/**
 * Sends the settle and move writes waiting in local state. After an Undo toast closes,
 * `workItemIds` limits this to the action's items. At launch, it sends every
 * write left from a session that quit during its Undo window.
 *
 * A failed write restores the item's previous source values and lifecycle,
 * and shows an error toast that stays until dismissed.
 */
export async function sendPendingSourceWrites(workItemIds?: readonly string[]) {
  const snapshot = localStore.snapshot();
  const pending = snapshot.workItems.filter(
    (workItem) =>
      workItem.pendingSourceWrite &&
      !sending.has(workItem._id) &&
      (!workItemIds || workItemIds.includes(workItem._id)),
  );
  await Promise.all(
    pending.map((item) => sendSourceWrite(item, snapshot.workItems)),
  );
}

async function sendSourceWrite(
  workItem: LocalWorkItem,
  sentItems: readonly LocalWorkItem[],
) {
  const write = workItem.pendingSourceWrite;
  if (!write) return;

  const delay = (write.readyAt ?? 0) - Date.now();
  if (delay > 0) {
    window.setTimeout(
      () => void sendPendingSourceWrites([workItem._id]),
      delay,
    );
    return;
  }
  const stillCurrent = () =>
    hasSameSourceWriteRequest(
      localStore.snapshot().workItems.find((item) => item._id === workItem._id)
        ?.pendingSourceWrite,
      write,
    );

  sending.add(workItem._id);
  try {
    if (!workItem.sourceId || !workItem.sourceConnectionId) {
      throw new Error("The item is no longer linked to its source.");
    }
    await writeBacklogSettle(workItem.source, workItem.sourceConnectionId, {
      sourceId: workItem.sourceId,
      state: write.state,
      priority: sourcePriorityFromLevel(write.priority),
    });
    localStore.completeSourceWrite(workItem._id, sentItems);
    void sendSettleComment(workItem._id);
  } catch (error) {
    if (!stillCurrent()) return;
    localStore.failSourceWrite(workItem._id);
    const keptComment = Boolean(getSettleComment(workItem._id));
    void sendSettleComment(workItem._id);
    showErrorToast({
      title: `Couldn't update "${workItem.title}" in its source`,
      description: `${error instanceof Error ? error.message : "Unknown error"} The item returned to its previous state.${keptComment ? " Your comment is kept as a draft on it." : ""}`,
    });
  } finally {
    sending.delete(workItem._id);
    if (!stillCurrent()) void sendPendingSourceWrites([workItem._id]);
  }
}

/**
 * Posts the comment typed in the settle dialog once the settle stands: after
 * its write lands, or when the Undo toast closes for a settle with nothing to
 * write. A settle that was undone or failed keeps the comment as the item's
 * draft instead, as does a refused post (ADR 0008).
 */
export async function sendSettleComment(workItemId: string) {
  if (!getSettleComment(workItemId)) return;
  const item = localStore
    .snapshot()
    .workItems.find((workItem) => workItem._id === workItemId);
  // The settle's write goes first and sends the comment once it lands.
  if (item?.pendingSourceWrite) return;
  const entry = takeSettleComment(workItemId);
  if (!entry || !item) return;
  if (item.status === "active") {
    keepCommentAsDraft(workItemId, entry.body);
    return;
  }

  try {
    const { comment } = await postItemComment(
      entry.pluginId,
      entry.connectionId,
      { sourceId: entry.sourceId, body: entry.body },
    );
    announcePostedComment(entry, comment);
  } catch (error) {
    keepCommentAsDraft(workItemId, entry.body);
    showErrorToast({
      title: `Couldn't post your comment on "${item.title}"`,
      description: `${error instanceof Error ? error.message : "Unknown error"} It's kept as a draft on the item.`,
    });
  }
}

/** At launch, sends the settle comments left from a session that quit during Undo. */
export async function flushSettleComments() {
  await Promise.all(settleCommentItemIds().map(sendSettleComment));
}

/** Compatibility for the explicit settle rule workflow. */
export const canWriteSettle = canWriteToSource;
