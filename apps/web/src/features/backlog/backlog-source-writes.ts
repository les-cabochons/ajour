import { showErrorToast } from "@/components/ui/toast";
import { isCapabilityActive } from "@ajour/shared";
import type { LocalWorkItem } from "@/domain/local-state";
import { hasSameSourceWriteRequest } from "@/domain/backlog/backlog-item-lifecycle";
import { isCommentSourceOf } from "@/domain/backlog/comments";
import { sourcePriorityFromLevel } from "@/domain/backlog/priority";
import { announcePostedComment } from "@/features/backlog/comment-threads";
import {
  getCachedPluginsOverview,
  isAccessOffError,
  postItemComment,
  writeBacklogSettle,
} from "@/lib/app-api";
import { isSourceWriteHeld } from "@/domain/backlog/held-edits";
import { announceHeldEdit } from "@/lib/held-edit-notice";
import { holdRefusedComment } from "@/lib/held-edits";
import {
  agentAccessAllows,
  readAgentCommentAccess,
} from "@/lib/agent-comment-access";
import { keepCommentAsDraft } from "@/lib/comment-drafts";
import { localStore } from "@/lib/local-store";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import { wideEvents } from "@/lib/wide-events";
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
  // A held write waits for the user's approval in Sync review (#395).
  const pending = snapshot.workItems.filter(
    (workItem) =>
      workItem.pendingSourceWrite &&
      !isSourceWriteHeld(workItem) &&
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

/**
 * Sends one item's pending write, as one `backlog.write_source` job. It
 * starts its own trace and joins the settle that caused it by the settle ID.
 * A write whose Undo window is still open is `deferred`, and goes later as
 * a job of its own; one replaced while it was sent is `superseded`.
 */
function sendSourceWrite(
  workItem: LocalWorkItem,
  sentItems: readonly LocalWorkItem[],
) {
  const write = workItem.pendingSourceWrite;
  if (!write) return;
  return wideEvents.run(
    "backlog.write_source",
    { kind: "job", trigger: "system", detached: true },
    async (job) => {
      job.set({
        backlog_item: { id: workItem._id, settle_id: workItem.settleId },
        plugin: { id: workItem.source },
        connection: { id: workItem.sourceConnectionId },
        source_write: {
          state_sent: write.state !== undefined,
          priority_sent: write.priority !== undefined,
        },
      });
      const delay = (write.readyAt ?? 0) - Date.now();
      if (delay > 0) {
        window.setTimeout(
          () => void sendPendingSourceWrites([workItem._id]),
          delay,
        );
        job.set({ source_write: { result: "deferred" } }).end("noop");
        return;
      }
      if (write.readyAt !== undefined) {
        job.set({ source_write: { delay_ms: -delay } });
      }
      const stillCurrent = () =>
        hasSameSourceWriteRequest(
          localStore
            .snapshot()
            .workItems.find((item) => item._id === workItem._id)
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
        job.set({ source_write: { result: "sent" } });
        // Its settle comments go next, as child jobs in its trace.
        job.enter(() => {
          localStore.completeSourceWrite(workItem._id, sentItems);
          void sendSettleComments(workItem._id);
        });
      } catch (error) {
        if (!stillCurrent()) {
          job.set({ source_write: { result: "superseded" } });
          job.cancel("superseded");
          return;
        }
        // Editing work items is off on the connection: the write is held,
        // with the item as the user left it, until they approve it.
        if (isAccessOffError(error)) {
          job.set({ source_write: { result: "held" } }).refuse("access_off");
          job.enter(() => localStore.holdSourceWrite(workItem._id));
          announceHeldEdit(workItem);
          return;
        }
        job.set({ source_write: { result: "failed" } }).fail(error);
        // The comments of the settle whose write failed, taken before recovery:
        // the settle-end watcher may draft them itself, and a newer settle's
        // comments queued meanwhile, in another window, keep waiting.
        const ofThisSettle = settleCommentsOf(workItem._id).filter((entry) =>
          isOfSettle(entry, workItem.settleId),
        );
        const kept = ofThisSettle.length;
        job.enter(() => {
          localStore.failSourceWrite(workItem._id);
          // The settle didn't stand, whatever state the item went back to.
          keepAsDrafts(workItem._id, ofThisSettle);
        });
        showErrorToast({
          title: `Couldn't update "${workItem.title}" in its source`,
          description: `${error instanceof Error ? error.message : "Unknown error"} The item returned to its previous state.${kept ? " Your comment is kept as a draft on it." : ""}`,
        });
      } finally {
        sending.delete(workItem._id);
        if (!stillCurrent()) void sendPendingSourceWrites([workItem._id]);
      }
    },
  );
}

/**
 * Whether a queued comment came with that settle. An older entry, queued
 * before settles had ids, matches only an item settled before then too.
 */
function isOfSettle(entry: PendingSettleComment, settleId: string | undefined) {
  return entry.settleId === settleId;
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
 * window closed, and the item's pending write landed. An agent's comment
 * also needs the agent to be still allowed to post. A settle that was
 * undone, failed or replaced keeps its comment as the item's draft
 * instead, as does a refused post (ADR 0008). Each ready comment is one
 * `settle_comment.send` job; while the item's write waits, none runs.
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
    ready.map((queued) =>
      wideEvents.run(
        "settle_comment.send",
        { kind: "job", trigger: "system", detached: true },
        (job) => sendSettleComment(job, workItemId, queued, itemNow),
      ),
    ),
  );
}

async function sendSettleComment(
  job: Unit<AjourCatalog, "settle_comment.send">,
  workItemId: string,
  queued: PendingSettleComment,
  itemNow: () => LocalWorkItem | undefined,
) {
  job.set({
    backlog_item: { id: workItemId, settle_id: queued.settleId },
    plugin: { id: queued.pluginId },
    connection: { id: queued.connectionId },
    comment: {
      body_length: queued.body.length,
      for_agent: queued.agentClient !== undefined,
    },
  });
  const keptAsDraft = (
    reason:
      "settle_ended" | "access_check_failed" | "agent_access" | "post_failed",
  ) => job.set({ comment: { result: "kept_as_draft", draft_reason: reason } });
  // An agent's comment: read its access before taking the comment, so
  // what the item does meanwhile is checked below.
  let agentCheck: { allowed: boolean } | { error: unknown } | undefined;
  if (queued.agentClient) {
    try {
      const { access } = await readAgentCommentAccess({
        source: queued.pluginId,
        sourceConnectionId: queued.connectionId,
        sourceId: queued.sourceId,
      });
      agentCheck = { allowed: agentAccessAllows(access, "readWrite") };
    } catch (error) {
      agentCheck = { error };
    }
  }
  // A write that started meanwhile goes first and sends it after.
  if (itemNow()?.pendingSourceWrite) {
    job.set({ comment: { result: "deferred" } }).end("noop");
    return;
  }
  const entry = takeSettleComment(queued.id);
  const item = itemNow();
  if (!entry || !item) {
    job.set({ comment: { result: "gone" } }).end("noop");
    return;
  }
  if (!settleStands(item, entry)) {
    keptAsDraft("settle_ended").cancel("settle_ended");
    keepCommentAsDraft(workItemId, entry.body);
    return;
  }
  const author = entry.agentClient ? `${entry.agentClient}'s` : "your";
  if (agentCheck && "error" in agentCheck) {
    keptAsDraft("access_check_failed").fail(agentCheck.error);
    keepCommentAsDraft(workItemId, entry.body);
    showErrorToast({
      title: `Couldn't post ${author} comment on "${item.title}"`,
      description: `${agentCheck.error instanceof Error ? agentCheck.error.message : "Unknown error"} It's kept as a draft on the item.`,
    });
    return;
  }
  if (agentCheck && !agentCheck.allowed) {
    keptAsDraft("agent_access").refuse("agent_access");
    keepCommentAsDraft(workItemId, entry.body);
    showErrorToast({
      title: `${entry.agentClient}'s comment on "${item.title}" wasn't posted`,
      description:
        "Agents can no longer post comments on its connection. It's kept as a draft on the item.",
    });
    return;
  }
  try {
    const { comment } = await job.enter(() =>
      postItemComment(
        entry.pluginId,
        entry.connectionId,
        { sourceId: entry.sourceId, body: entry.body },
        // An agent's comment: the API checks its access at the post.
        entry.agentClient ? { agent: true } : undefined,
      ),
    );
    job.set({ comment: { result: "posted" } });
    announcePostedComment(entry, comment);
  } catch (error) {
    // Editing work items is off: the comment is held for review.
    if (
      holdRefusedComment(error, {
        kind: "comment",
        itemId: workItemId,
        pluginId: entry.pluginId,
        connectionId: entry.connectionId,
        sourceId: entry.sourceId,
        body: entry.body,
        ...(entry.agentClient ? { agentClient: entry.agentClient } : {}),
      })
    ) {
      job.set({ comment: { result: "held" } }).refuse("access_off");
      return;
    }
    keptAsDraft("post_failed").fail(error);
    keepCommentAsDraft(workItemId, entry.body);
    showErrorToast({
      title: `Couldn't post ${author} comment on "${item.title}"`,
      description: `${error instanceof Error ? error.message : "Unknown error"} It's kept as a draft on the item.`,
    });
  }
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

/** The source writes waiting now, which the launch flush sends. Held ones wait for review. */
export function pendingSourceWriteCount() {
  return localStore
    .snapshot()
    .workItems.filter(
      (workItem) => workItem.pendingSourceWrite && !isSourceWriteHeld(workItem),
    ).length;
}

/** At launch, sends the settle comments left from a session that quit during Undo. */
export async function flushSettleComments() {
  markSettleCommentsReady();
  await Promise.all(settleCommentItemIds().map(sendSettleComments));
}

/** Compatibility for the explicit settle rule workflow. */
export const canWriteSettle = canWriteToSource;
