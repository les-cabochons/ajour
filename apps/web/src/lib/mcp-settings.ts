import { useSyncExternalStore } from "react";
import type { McpSettings } from "@ajour/shared/agent-tools";
import { getMcpSettings, isPluginApiMissing } from "@/lib/app-api";

/**
 * MCP settings from the local API, shared by Settings > MCP and the agent
 * bridge. `unavailable` means Ajour runs as a plain web app without the API.
 */
export type McpSettingsState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; settings: McpSettings };

let current: McpSettingsState = { kind: "loading" };
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: McpSettingsState) {
  current = next;
  listeners.forEach((listener) => listener());
}

export function setMcpSettings(settings: McpSettings) {
  publish({ kind: "ready", settings });
}

export async function refreshMcpSettings() {
  try {
    setMcpSettings(await getMcpSettings());
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
    void refreshMcpSettings();
  }
  return () => listeners.delete(listener);
}

export function useMcpSettings(): McpSettingsState {
  return useSyncExternalStore(subscribe, () => current);
}
