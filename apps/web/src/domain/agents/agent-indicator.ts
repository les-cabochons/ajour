import type { AgentsSnapshot } from "@ajour/shared/agent-tools";

/**
 * The agent indicator's one state, the most urgent across all sessions:
 * needs input, then error, then failed, then active, then idle. Opening the
 * panel (`seenAt`) clears past errors and failures. A stalled session or a
 * lost API connection (`reconnecting` or `disconnected`) keeps its state until it recovers.
 */

export type AgentIndicatorState =
  "hidden" | "idle" | "active" | "needs-input" | "failed" | "error";

export interface AgentIndicator {
  state: AgentIndicatorState;
  label: string;
}

/**
 * The bridge's status. `connecting` is the first attempt, `reconnecting` a
 * failed attempt the browser retries, `disconnected` a closed stream waiting
 * for a retry, and `off` means MCP is off.
 */
export type AgentBridgeStatus =
  "off" | "connecting" | "connected" | "reconnecting" | "disconnected";

export function getAgentIndicator({
  mcpEnabled,
  bridgeStatus,
  snapshot,
}: {
  mcpEnabled: boolean;
  bridgeStatus: AgentBridgeStatus;
  snapshot: AgentsSnapshot | null;
}): AgentIndicator {
  if (!mcpEnabled) return { state: "hidden", label: "" };

  const questions = snapshot?.openQuestions.length ?? 0;
  if (questions > 0) {
    return {
      state: "needs-input",
      label: questions === 1 ? "Needs input" : `${questions} questions`,
    };
  }

  const seenAt = snapshot?.seenAt ?? 0;
  if (bridgeStatus === "reconnecting" || bridgeStatus === "disconnected") {
    return { state: "error", label: "Can't reach Ajour's API" };
  }
  if (snapshot?.errors.some((error) => error.at > seenAt)) {
    return { state: "error", label: "Error" };
  }

  const sessions = snapshot?.sessions ?? [];
  if (sessions.some((session) => session.state === "stalled")) {
    return { state: "failed", label: "Stalled" };
  }
  if (
    sessions.some(
      (session) =>
        session.state === "failed" && (session.endedAt ?? 0) > seenAt,
    )
  ) {
    return { state: "failed", label: "Failed" };
  }

  const active = sessions.filter(
    (session) => session.state === "active",
  ).length;
  if (active > 0) {
    return {
      state: "active",
      label: active === 1 ? "Working" : `${active} working`,
    };
  }
  return { state: "idle", label: "Agents idle" };
}
