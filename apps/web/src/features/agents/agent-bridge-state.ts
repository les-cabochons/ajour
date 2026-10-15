import { useSyncExternalStore } from "react";
import type { AgentsSnapshot } from "@ajour/shared/agent-tools";
import type { McpBridgeStatus } from "@/lib/mcp-bridge";

/** The bridge's status for the agent indicator. `off` while MCP is off. */
export type AgentBridgeStatus = McpBridgeStatus | "off";

interface AgentBridgeState {
  status: AgentBridgeStatus;
  /** Null until the API sends the first snapshot. */
  snapshot: AgentsSnapshot | null;
  panelOpen: boolean;
}

let state: AgentBridgeState = {
  status: "off",
  snapshot: null,
  panelOpen: false,
};
const listeners = new Set<() => void>();

function update(patch: Partial<AgentBridgeState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/** Turning MCP off also closes the panel, which has nothing left to show. */
export function setAgentBridgeStatus(status: AgentBridgeStatus) {
  if (state.status === status) return;
  update(status === "off" ? { status, panelOpen: false } : { status });
}

export function setAgentsSnapshot(snapshot: AgentsSnapshot) {
  update({ snapshot });
}

export function openAgentPanel() {
  update({ panelOpen: true });
}

export function closeAgentPanel() {
  update({ panelOpen: false });
}

export function useAgentBridgeState(): AgentBridgeState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
