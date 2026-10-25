import {
  readToolInputSchemas,
  writeToolInputSchemas,
  type BridgeToolCall,
  type BridgeToolResult,
  type DataToolOutput,
} from "@ajour/shared/agent-tools";
import { showErrorToast, showUndoToast } from "@/components/ui/toast";
import { findWorkItemOrRefuse } from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import {
  isCommentSourceOf,
  isOwnComment,
  type CommentSource,
} from "@/domain/backlog/comments";
import type { LocalWorkItem } from "@/domain/local-state";
import { announcePostedComment } from "@/features/backlog/comment-threads";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import {
  agentCommentIds,
  queueAgentComment,
  takeAgentComment,
  type PendingAgentComment,
} from "@/lib/agent-comments";

import {
  agentAccessAllows,
  readAgentCommentAccess,
} from "@/lib/agent-comment-access";
import {
  isAccessOffError,
  listItemComments,
  postItemComment,
} from "@/lib/app-api";
import { pendingCommentDeleteIds } from "@/lib/comment-deletes";
import { announceHeldEdit } from "@/lib/held-edit-notice";
import { holdCommentEdit } from "@/lib/held-edits";
import { keepCommentAsDraft } from "@/lib/comment-drafts";
import { localStore } from "@/lib/local-store";
import { reentry, wideEvents } from "@/lib/wide-events";

/**
 * Comment tools for agents (map #234). The user allows them per connection:
 * None, the default, Read, or Read and write. Each call checks it against the
 * connection as the local API has it now, so a change in Settings counts at
 * once. A posted comment waits for its Undo toast, like a deleted one.
 */

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";

/**
 * The item's comments, when the user lets agents `need` them on its
 * connection now. Refuses with what the user can change otherwise.
 */
export async function requireAgentCommentAccess(
  item: LocalWorkItem,
  need: "read" | "readWrite",
): Promise<CommentSource> {
  let current;
  try {
    current = await readAgentCommentAccess(item);
  } catch (error) {
    throw new AgentToolRefusal(
      `Ajour couldn't read its plugin settings: ${errorMessage(error)}`,
    );
  }
  if (!current.source) {
    throw new AgentToolRefusal(
      "This item has no comments in Ajour. Only items synced from a plugin that provides comments have them.",
    );
  }
  if (!agentAccessAllows(current.access, need)) {
    throw new AgentToolRefusal(
      `The user hasn't allowed agents to ${need === "read" ? "read" : "post"} comments on the "${current.connectionLabel ?? "item's"}" connection. They can change "Agent access" on it in Ajour's Settings, under Plugins.`,
    );
  }
  return current.source;
}

/** Refuses a comment longer than the source takes. */
export function assertCommentFits(source: CommentSource, body: string) {
  const limit = source.capability.maxLength;
  if (limit !== undefined && body.length > limit) {
    throw new AgentToolRefusal(
      `The item's source takes comments of at most ${limit} characters. This one has ${body.length}.`,
    );
  }
}

export async function listCommentsForAgent(
  rawInput: unknown,
): Promise<DataToolOutput<"list_work_item_comments">> {
  const input = readToolInputSchemas.list_work_item_comments.parse(rawInput);
  const item = findWorkItemOrRefuse(localStore.snapshot(), input.workItemId);
  // The tool call's unit, which the call after the access check joins.
  const enter = reentry();
  const source = await requireAgentCommentAccess(item, "read");
  let page;
  try {
    // The API checks Read again when the answer comes back.
    page = await enter(() =>
      listItemComments(
        source.pluginId,
        source.connectionId,
        {
          sourceId: source.sourceId,
          limit: input.limit,
          ...(input.cursor ? { cursor: input.cursor } : {}),
        },
        { agent: true },
      ),
    );
  } catch (error) {
    throw new AgentToolRefusal(
      `Ajour couldn't load the item's comments: ${errorMessage(error)}`,
    );
  }
  // A comment the user deleted waits for its Undo window; it is gone for them.
  const deleted = pendingCommentDeleteIds(source);
  return {
    comments: page.comments
      .filter((comment) => !deleted.has(comment.id))
      .map((comment) => ({
        commentId: comment.id,
        author: { id: comment.author.id, name: comment.author.displayName },
        byUser: isOwnComment(comment, page.viewer),
        body: comment.body,
        createdAt: comment.createdAt,
        ...(comment.updatedAt ? { updatedAt: comment.updatedAt } : {}),
        ...(comment.reactions?.length
          ? {
              reactions: comment.reactions.map((reaction) => ({
                reaction: reaction.reaction,
                count: reaction.count,
                byUser: reaction.viewerReacted,
              })),
            }
          : {}),
      })),
    ...(page.total !== undefined ? { total: page.total } : {}),
    ...(page.earlierCursor ? { earlierCursor: page.earlierCursor } : {}),
  };
}

/**
 * Queues an agent's comment behind an Undo toast named after the agent. It
 * goes to the source when the toast closes; Undo drops it.
 */
export async function postCommentForAgent(
  call: BridgeToolCall,
  unit?: Unit<AjourCatalog, "agent_tool.call">,
): Promise<BridgeToolResult> {
  const input = writeToolInputSchemas.post_work_item_comment.parse(call.input);
  const item = findWorkItemOrRefuse(localStore.snapshot(), input.workItemId);
  const source = await requireAgentCommentAccess(item, "readWrite");
  assertCommentFits(source, input.body);

  const id = crypto.randomUUID();
  queueAgentComment({
    id,
    itemId: item._id,
    pluginId: source.pluginId,
    connectionId: source.connectionId,
    sourceId: source.sourceId,
    body: input.body,
    clientName: call.client.name,
    at: Date.now(),
  });
  const action = "Commented on a backlog item";
  unit?.set({ agent_tool: { undo_offered: true } });
  let undone = false;
  showUndoToast({
    title: `${call.client.name}: ${action}`,
    onUndo: () => {
      undone = true;
      takeAgentComment(id);
    },
    onClose: () => {
      if (!undone) void sendAgentComment(id);
    },
  });
  return {
    requestId: call.requestId,
    ok: true,
    output: {
      workItemId: item._id,
      queued: true,
    } satisfies DataToolOutput<"post_work_item_comment">,
    activity: { action, objectId: item._id, objectTitle: item.title },
  };
}

/**
 * Posts a queued agent comment, if its item is still there and the user
 * still lets agents post on its connection. Otherwise, or when the source
 * refuses it, it becomes the item's comment draft, so the user can send or
 * discard it. A comment whose item was deleted goes with it.
 */
export function sendAgentComment(id: string): Promise<void> {
  return wideEvents.run(
    "agent_comment.send",
    { kind: "job", trigger: "system", detached: true },
    async (job) => {
      const entry = takeAgentComment(id);
      if (!entry) {
        job.set({ comment: { result: "gone" } }).end("noop");
        return;
      }
      job.set({
        backlog_item: { id: entry.itemId },
        plugin: { id: entry.pluginId },
        connection: { id: entry.connectionId },
        comment: { body_length: entry.body.length },
      });
      await postAgentComment(job, entry);
    },
  );
}

async function postAgentComment(
  job: Unit<AjourCatalog, "agent_comment.send">,
  entry: PendingAgentComment,
) {
  const gone = () => job.set({ comment: { result: "gone" } }).end("noop");
  const keptAsDraft = (
    reason: "access_check_failed" | "agent_access" | "post_failed",
  ) => job.set({ comment: { result: "kept_as_draft", draft_reason: reason } });
  // The item as it is now, still from the comment's thread.
  const currentItem = () => {
    const item = localStore
      .snapshot()
      .workItems.find((workItem) => workItem._id === entry.itemId);
    return item && isCommentSourceOf(item, entry) ? item : undefined;
  };
  const item = currentItem();
  if (!item) {
    gone();
    return;
  }
  let checked = false;
  try {
    const current = await readAgentCommentAccess(item);
    checked = true;
    if (!agentAccessAllows(current.access, "readWrite")) {
      keptAsDraft("agent_access").refuse("agent_access");
      keepCommentAsDraft(entry.itemId, entry.body);
      showErrorToast({
        title: `${entry.clientName}'s comment on "${item.title}" wasn't posted`,
        description:
          "Agents can no longer post comments on its connection. It's kept as a draft on the item.",
      });
      return;
    }
    // Deleted or moved while access was read: the comment goes with it.
    if (!currentItem()) {
      gone();
      return;
    }
    // The API checks Read and write again at the post itself.
    const { comment } = await job.enter(() =>
      postItemComment(
        entry.pluginId,
        entry.connectionId,
        { sourceId: entry.sourceId, body: entry.body },
        { agent: true },
      ),
    );
    job.set({ comment: { result: "posted" } });
    announcePostedComment(entry, comment);
  } catch (error) {
    // Editing work items is off: the comment is held for review (#395).
    if (isAccessOffError(error)) {
      job.set({ comment: { result: "held" } }).refuse("access_off");
      holdCommentEdit({
        kind: "comment",
        itemId: entry.itemId,
        pluginId: entry.pluginId,
        connectionId: entry.connectionId,
        sourceId: entry.sourceId,
        body: entry.body,
        agentClient: entry.clientName,
      });
      announceHeldEdit(currentItem());
      return;
    }
    keptAsDraft(checked ? "post_failed" : "access_check_failed").fail(error);
    keepCommentAsDraft(entry.itemId, entry.body);
    const title = localStore
      .snapshot()
      .workItems.find((workItem) => workItem._id === entry.itemId)?.title;
    showErrorToast({
      title: `Couldn't post ${entry.clientName}'s comment${title ? ` on "${title}"` : ""}`,
      description: `${errorMessage(error)} It's kept as a draft on the item.`,
    });
  }
}

/** At launch, sends the agent comments left from a session that quit during Undo. */
export async function flushAgentComments() {
  await Promise.all(agentCommentIds().map(sendAgentComment));
}
