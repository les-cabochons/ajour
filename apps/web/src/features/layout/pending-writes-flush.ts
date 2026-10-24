import { flushAgentComments } from "@/features/agents/agent-comment-tools";
import {
  flushSettleComments,
  pendingSourceWriteCount,
  sendPendingSourceWrites,
} from "@/features/backlog/backlog-source-writes";
import { agentCommentIds } from "@/lib/agent-comments";
import {
  flushPendingCommentDeletes,
  pendingCommentDeleteCount,
} from "@/lib/comment-deletes";
import { pendingSettleCommentCount } from "@/lib/settle-comments";
import { wideEvents } from "@/lib/wide-events";

/**
 * Sends the settle writes, comment deletes, settle comments and agent
 * comments left from a session that quit during their Undo window (ADR
 * 0001, ADR 0008), as one `pending_writes.flush` job. Each send starts
 * inside it, so it is its own job and a child span in the flush's trace.
 * There is no offline queue beyond that: a write that fails here puts its
 * item back to active.
 */
export function flushPendingWrites(): Promise<void> {
  return wideEvents.run(
    "pending_writes.flush",
    { kind: "job", trigger: "boot" },
    async (job) => {
      const flush = {
        source_write_count: pendingSourceWriteCount(),
        comment_delete_count: pendingCommentDeleteCount(),
        settle_comment_count: pendingSettleCommentCount(),
        agent_comment_count: agentCommentIds().length,
      };
      job.set({ flush });
      // Most launches find nothing: an event that sent nothing is a `noop`.
      if (Object.values(flush).every((count) => count === 0)) {
        job.end("noop");
        return;
      }
      await Promise.all([
        sendPendingSourceWrites(),
        flushPendingCommentDeletes(),
        flushSettleComments(),
        flushAgentComments(),
      ]);
    },
  );
}
