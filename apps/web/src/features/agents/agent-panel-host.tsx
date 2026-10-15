import {
  answerAgentQuestion,
  dismissAgentSession,
  markAgentsSeen,
  stopAgentRun,
} from "@/lib/app-api";
import {
  closeAgentPanel,
  openAgentPanel,
  setAgentsSnapshot,
  useAgentBridgeState,
} from "@/features/agents/agent-bridge-state";
import { AgentPanel } from "@/features/agents/agent-panel";

async function answer(questionId: string, text: string) {
  setAgentsSnapshot(await answerAgentQuestion(questionId, text));
}

async function dismiss(sessionId: string) {
  setAgentsSnapshot(await dismissAgentSession(sessionId));
}

async function stop(runId: string) {
  setAgentsSnapshot(await stopAgentRun(runId));
}

function markSeen() {
  void markAgentsSeen()
    .then(setAgentsSnapshot)
    .catch(() => undefined);
}

/**
 * Wires the agent panel to the MCP bridge's snapshot and the local API's
 * answer, dismiss, stop and seen routes. Mount once in the app shell, beside the page, where
 * the wide window docks the panel.
 */
export function AgentPanelHost() {
  const { snapshot, panelOpen } = useAgentBridgeState();
  return (
    <AgentPanel
      snapshot={snapshot}
      open={panelOpen}
      onOpenChange={(open) => (open ? openAgentPanel() : closeAgentPanel())}
      onAnswer={answer}
      onDismiss={dismiss}
      onStop={stop}
      onSeen={markSeen}
    />
  );
}
