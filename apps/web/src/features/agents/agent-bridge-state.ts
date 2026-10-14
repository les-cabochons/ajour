import { useSyncExternalStore } from "react";
import type { McpBridgeStatus } from "@/lib/mcp-bridge";

/** The bridge's status for the agent indicator. `off` while MCP is off. */
export type AgentBridgeStatus = McpBridgeStatus | "off";

interface AgentBridgeState {
  status: AgentBridgeStatus;
}

let state: AgentBridgeState = { status: "off" };
const listeners = new Set<() => void>();

function update(patch: Partial<AgentBridgeState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function setAgentBridgeStatus(status: AgentBridgeStatus) {
  if (state.status !== status) update({ status });
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
