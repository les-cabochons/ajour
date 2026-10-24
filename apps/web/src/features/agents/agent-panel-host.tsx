import { useEffect } from "react";
import {
  answerAgentQuestion,
  asPoll,
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
import { refreshAgentRunner, useAgentRunner } from "@/lib/agent-runner";

/** How often the host asks the API whether the run is still going. */
const RUN_POLL_MS = 5000;

async function answer(questionId: string, text: string) {
  setAgentsSnapshot(await answerAgentQuestion(questionId, text));
}

async function dismiss(sessionId: string) {
  setAgentsSnapshot(await dismissAgentSession(sessionId));
}

async function stop(runId: string) {
  setAgentsSnapshot(await stopAgentRun(runId));
  await refreshAgentRunner();
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
  const runner = useAgentRunner();
  const currentRunId =
    runner.kind === "ready" ? (runner.overview.currentRun?.id ?? null) : null;

  // The API owns the run. Refresh when a runner session changes state, and
  // poll while a run is going: the CLI can outlive its session, and Stop
  // must go away once the run does.
  const runnerSessionKey = (snapshot?.sessions ?? [])
    .filter((session) => session.runId)
    .map((session) => `${session.runId}:${session.state}`)
    .join(",");
  useEffect(() => {
    if (!runnerSessionKey && !currentRunId) return;
    // Status reads that follow the run: polls, which record nothing.
    void asPoll(() => refreshAgentRunner());
    if (!currentRunId) return;
    const timer = setInterval(
      () => void asPoll(() => refreshAgentRunner()),
      RUN_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [runnerSessionKey, currentRunId]);

  return (
    <AgentPanel
      snapshot={snapshot}
      open={panelOpen}
      onOpenChange={(open) => (open ? openAgentPanel() : closeAgentPanel())}
      onAnswer={answer}
      onDismiss={dismiss}
      onStop={stop}
      currentRunId={currentRunId}
      onSeen={markSeen}
    />
  );
}
