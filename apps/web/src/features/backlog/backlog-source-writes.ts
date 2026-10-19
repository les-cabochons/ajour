import { showErrorToast } from "@/components/ui/toast";
import { isCapabilityActive } from "@ajour/shared";
import type { LocalWorkItem } from "@/domain/local-state";
import { hasSameSourceWriteRequest } from "@/domain/backlog/backlog-item-lifecycle";
import { isCommentSourceOf } from "@/domain/backlog/comments";
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
  type PendingSettleComment,
  markSettleCommentReady,
  markSettleCommentsReady,
  settleCommentItemIds,
  settleCommentsOf,
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
 *
 * An action's item with no write left, such as one whose write Undo took
 * back, may still hold settle comments that waited on that write: they go
 * now.
 */
export async function sendPendingSourceWrites(workItemIds?: readonly string[]) {
  const snapshot = localStore.snapshot();
  const pending = snapshot.workItems.filter(
    (workItem) =>
      workItem.pendingSourceWrite &&
      !sending.has(workItem._id) &&
      (!workItemIds || workItemIds.includes(workItem._id)),
  );
  const writeless = (workItemIds ?? []).filter(
    (id) =>
      !snapshot.workItems.find((workItem) => workItem._id === id)
        ?.pendingSourceWrite,
  );
  await Promise.all([
    ...pending.map((item) => sendSourceWrite(item, snapshot.workItems)),
    ...writeless.map(sendSettleComments),
  ]);
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
    void sendSettleComments(workItem._id);
  } catch (error) {
    if (!stillCurrent()) return;
    // The comments of the settle whose write failed, taken before recovery:
    // the settle-end watcher may draft them itself, and a newer settle's
    // comments queued meanwhile, in another window, keep waiting.
    const ofThisSettle = settleCommentsOf(workItem._id).filter((entry) =>
      isOfSettle(entry, workItem.settleId),
    );
    const kept = ofThisSettle.length;
    localStore.failSourceWrite(workItem._id);
    // The settle didn't stand, whatever state the item went back to.
    keepAsDrafts(workItem._id, ofThisSettle);
    showErrorToast({
      title: `Couldn't update "${workItem.title}" in its source`,
      description: `${error instanceof Error ? error.message : "Unknown error"} The item returned to its previous state.${kept ? " Your comment is kept as a draft on it." : ""}`,
    });
  } finally {
    sending.delete(workItem._id);
    if (!stillCurrent()) void sendPendingSourceWrites([workItem._id]);
  }
}

/** Whether a queued comment came with that settle. Older entries name none. */
function isOfSettle(entry: PendingSettleComment, settleId: string | undefined) {
  return entry.settleId === undefined || entry.settleId === settleId;
}

/** Keeps these queued comments as the item's draft, each at most once. */
function keepAsDrafts(
  workItemId: string,
  entries: readonly Pick<PendingSettleComment, "id">[],
) {
  for (const { id } of entries) {
    const entry = takeSettleComment(id);
    if (entry) keepCommentAsDraft(workItemId, entry.body);
  }
}

/**
 * Posts the item's settle comments that are ready: their settle's Undo
 * window closed, and the item's pending write landed. A settle that was
 * undone keeps its comment as the item's draft instead, as does a refused
 * post (ADR 0008).
 */
export async function sendSettleComments(workItemId: string) {
  const itemNow = () =>
    localStore
      .snapshot()
      .workItems.find((workItem) => workItem._id === workItemId);
  // The item's write goes first and sends the comments once it lands.
  if (itemNow()?.pendingSourceWrite) return;
  const ready = settleCommentsOf(workItemId).filter((entry) => entry.ready);
  await Promise.all(
    ready.map(async ({ id }) => {
      const entry = takeSettleComment(id);
      const item = itemNow();
      if (!entry || !item) return;
      if (!settleStands(item, entry)) {
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
    }),
  );
}

/**
 * Whether the settle a comment was typed with still stands: the item is
 * still in that settle, settled or archived since, and comes from the
 * comment's thread.
 */
function settleStands(item: LocalWorkItem, entry: PendingSettleComment) {
  return (
    item.status !== "active" &&
    isCommentSourceOf(item, entry) &&
    isOfSettle(entry, item.settleId)
  );
}

/**
 * Turns an item's waiting settle comments into drafts as soon as its settle
 * ends: the item is active again, whether unsettled, restored, returned by a
 * sync, undone or put back by a failed write. A settle that goes on into an
 * archive keeps them. So a later settle, of the item or of a parent carrying
 * it, never finds an earlier settle's comment. Returns the unsubscribe.
 */
export function watchSettleEnds() {
  const lifecyclesOf = () =>
    new Map(
      localStore
        .snapshot()
        .workItems.map((workItem) => [
          workItem._id,
          { status: workItem.status, settleId: workItem.settleId },
        ]),
    );
  let before = lifecyclesOf();
  return localStore.subscribe(() => {
    const now = lifecyclesOf();
    // The settles that ended: the item was settled or archived, now active.
    const ended = [...now].flatMap(([id, { status }]) => {
      const previous = before.get(id);
      return status === "active" && previous && previous.status !== "active"
        ? [{ id, settleId: previous.settleId }]
        : [];
    });
    before = now;
    if (ended.length === 0) return;
    const queued = new Set(settleCommentItemIds());
    for (const { id, settleId } of ended) {
      if (!queued.has(id)) continue;
      // Only that settle's: a newer one's comments, queued meanwhile in
      // another window, keep waiting.
      keepAsDrafts(
        id,
        settleCommentsOf(id).filter((entry) => isOfSettle(entry, settleId)),
      );
    }
  });
}

/**
 * A settle's Undo window closed: its comment goes once the item's write
 * lands, or now if nothing waits.
 */
export function releaseSettleComment(commentId: string, workItemId: string) {
  markSettleCommentReady(commentId);
  return sendSettleComments(workItemId);
}

/** At launch, sends the settle comments left from a session that quit during Undo. */
export async function flushSettleComments() {
  markSettleCommentsReady();
  await Promise.all(settleCommentItemIds().map(sendSettleComments));
}

/** Compatibility for the explicit settle rule workflow. */
export const canWriteSettle = canWriteToSource;
