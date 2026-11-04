import { writeToolInputSchemas } from "@ajour/shared/agent-tools";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import type { AgentWriteOutcome } from "@/features/agents/agent-write-tools";
import { closeUndoToast } from "@/components/ui/toast";
import { localStore } from "@/lib/local-store";

/**
 * The `undo` tool: an agent presses the Undo of one of its own writes, as
 * the user would in its toast. The store keeps only the last action's undo,
 * so this keeps only the last agent write's description, for the answer and
 * the refusal.
 */

const EXPIRED = "That change can't be undone any more.";

let lastAgentWrite:
  | {
      token: string;
      action: string;
      objectId: string;
      objectTitle: string;
      undoSubject: string;
    }
  | undefined;

/** Remembers an agent write that offered Undo, for a later `undo` call. */
export function rememberAgentWrite(outcome: AgentWriteOutcome) {
  if (!outcome.undoToken) return;
  lastAgentWrite = {
    token: outcome.undoToken,
    action: outcome.action,
    objectId: outcome.objectId,
    objectTitle: outcome.objectTitle,
    undoSubject: outcome.undoSubject,
  };
}

/**
 * Undoes the agent write that returned the token. Refuses when a later
 * action replaced it or its toast closed, and with the toast's own reason
 * when a record changed since.
 */
export function runAgentUndo(rawInput: unknown): AgentWriteOutcome {
  const { undoToken } = writeToolInputSchemas.undo.parse(rawInput);
  const write = lastAgentWrite;
  // Only an agent's own write: a token the agent never got is refused too.
  if (write?.token !== undoToken) throw new AgentToolRefusal(EXPIRED);
  const result = localStore.undo(undoToken);
  if (result === "expired") throw new AgentToolRefusal(EXPIRED);
  if (result === "stale") {
    throw new AgentToolRefusal(
      `Can't undo. The ${write.undoSubject} changed after that action.`,
    );
  }
  lastAgentWrite = undefined;
  // The write's toast has nothing left to undo.
  closeUndoToast();
  return {
    output: { undone: write.action },
    undoToken: null,
    action: `Undid: ${write.action}`,
    objectId: write.objectId,
    objectTitle: write.objectTitle,
    undoSubject: write.undoSubject,
  };
}
