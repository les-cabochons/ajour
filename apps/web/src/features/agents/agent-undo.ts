import { writeToolInputSchemas } from "@ajour/shared/agent-tools";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import type { AgentWriteOutcome } from "@/features/agents/agent-write-tools";
import { closeUndoToast } from "@/components/ui/toast";
import { undoRefusalMessage } from "@/features/feedback/undo-refusal";
import { localStore } from "@/lib/local-store";

/**
 * The `undo` tool: an agent presses the Undo of one of its own writes, as
 * the user would in its toast, and only the newest action's while its toast
 * shows. The store keeps earlier undos for Cmd+Z, but an agent's reach stops
 * at the newest, so this keeps only the last agent write's description, for the answer and
 * the refusal. The write belongs to the client that made it: another client
 * holding its token is refused as if the token had expired, so a client learns
 * nothing about another's tokens.
 */

const EXPIRED = "That change can't be undone any more.";

let lastAgentWrite:
  | {
      clientId: string;
      token: string;
      action: string;
      objectId: string;
      objectTitle: string;
      undoSubject: string;
    }
  | undefined;

/** Remembers an agent write that offered Undo, for a later `undo` call. */
export function rememberAgentWrite(
  outcome: AgentWriteOutcome,
  clientId: string,
) {
  if (!outcome.undoToken) return;
  lastAgentWrite = {
    clientId,
    token: outcome.undoToken,
    action: outcome.action,
    objectId: outcome.objectId,
    objectTitle: outcome.objectTitle,
    undoSubject: outcome.undoSubject,
  };
}

/**
 * Undoes the agent write that returned the token to this client. Refuses when
 * a later action replaced it, its toast closed or another client made it, and
 * with the toast's own reason when a record changed since.
 */
export function runAgentUndo(
  rawInput: unknown,
  clientId: string,
): AgentWriteOutcome {
  const { undoToken } = writeToolInputSchemas.undo.parse(rawInput);
  const write = lastAgentWrite;
  // Only this client's own write: a token it never got is refused too.
  if (write?.token !== undoToken || write.clientId !== clientId) {
    throw new AgentToolRefusal(EXPIRED);
  }
  // The window keeps earlier actions for Cmd+Z, but an agent presses only
  // the Undo of the newest action while its toast shows.
  if (!localStore.isLatestOpenUndo(undoToken)) {
    throw new AgentToolRefusal(EXPIRED);
  }
  const result = localStore.undo(undoToken);
  if (result === "expired") throw new AgentToolRefusal(EXPIRED);
  if (result === "stale" || result === "has_dependents") {
    // The store spent the token: its toast must not offer it again.
    lastAgentWrite = undefined;
    closeUndoToast();
    throw new AgentToolRefusal(undoRefusalMessage(result, write.undoSubject));
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
