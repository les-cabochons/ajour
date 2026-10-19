import { useSyncExternalStore } from "react";
import type { AgentRunnerOverview } from "@ajour/shared/agent-runs";
import { getAgentRunner, isPluginApiMissing } from "@/lib/app-api";

/**
 * The agent runner's overview from the local API, shared by Settings >
 * Agents and the Commit page. `unavailable` means Ajour runs as a plain web
 * app without the API.
 */
export type AgentRunnerState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; overview: AgentRunnerOverview };

let current: AgentRunnerState = { kind: "loading" };
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: AgentRunnerState) {
  current = next;
  listeners.forEach((listener) => listener());
}

export function setAgentRunner(overview: AgentRunnerOverview) {
  publish({ kind: "ready", overview });
}

export async function refreshAgentRunner() {
  try {
    setAgentRunner(await getAgentRunner());
  } catch (error) {
    publish(
      isPluginApiMissing(error)
        ? { kind: "unavailable" }
        : {
            kind: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          },
    );
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    void refreshAgentRunner();
  }
  return () => listeners.delete(listener);
}

export function useAgentRunner(): AgentRunnerState {
  return useSyncExternalStore(subscribe, () => current);
}
