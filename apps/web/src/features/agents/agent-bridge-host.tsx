import { useEffect } from "react";
import type { AgentsSnapshot } from "@ajour/shared/agent-tools";
import { showActionToast } from "@/components/ui/toast";
import { connectMcpBridge } from "@/lib/mcp-bridge";
import { useMcpSettings } from "@/lib/mcp-settings";
import {
  openAgentPanel,
  setAgentBridgeStatus,
  setAgentsSnapshot,
  useAgentBridgeState,
} from "@/features/agents/agent-bridge-state";
import { runAgentToolCall } from "@/features/agents/agent-tool-runner";

const QUESTION_PREVIEW_LENGTH = 80;

/** Closes the toast of each question that has one, by question id. */
const questionToasts = new Map<string, () => void>();

/**
 * Shows a toast for each open question that has none yet, and closes the toast
 * of a question that is no longer open, such as one answered in the panel.
 */
function syncQuestionToasts(snapshot: AgentsSnapshot) {
  const open = new Set(snapshot.openQuestions.map((question) => question.id));
  for (const [id, close] of questionToasts) {
    if (open.has(id)) continue;
    close();
    questionToasts.delete(id);
  }
  for (const question of snapshot.openQuestions) {
    if (questionToasts.has(question.id)) continue;
    const text =
      question.text.length > QUESTION_PREVIEW_LENGTH
        ? `${question.text.slice(0, QUESTION_PREVIEW_LENGTH - 1)}…`
        : question.text;
    questionToasts.set(
      question.id,
      showActionToast({
        title: `${question.client.name} asks: ${text}`,
        actionLabel: "Answer",
        onAction: openAgentPanel,
      }),
    );
  }
}

/** Keeps the MCP bridge open while MCP is on. Mount once, in the app shell. */
export function AgentBridgeHost() {
  const settings = useMcpSettings();
  const { snapshot, panelOpen } = useAgentBridgeState();
  const enabled = settings.kind === "ready" && settings.settings.enabled;

  useEffect(() => {
    if (!enabled) {
      setAgentBridgeStatus("off");
      return;
    }
    return connectMcpBridge({
      runToolCall: runAgentToolCall,
      onStatus: setAgentBridgeStatus,
      onAgents: setAgentsSnapshot,
    });
  }, [enabled]);

  // Snapshots come from the stream and from the panel's answers.
  useEffect(() => {
    if (snapshot) syncQuestionToasts(snapshot);
  }, [snapshot]);

  // The panel shows every open question, so its toasts have done their job.
  useEffect(() => {
    if (panelOpen) questionToasts.forEach((close) => close());
  }, [panelOpen]);

  return null;
}
