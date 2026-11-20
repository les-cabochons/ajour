import type { Handoff, HandoffCloseKind } from "@ajour/shared/handoffs";
import type { PluginsOverview } from "@ajour/shared";

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';

/**
 * One active `agent-handoff` plugin with T3 Code and Claude Code, and with
 * `copilot`, Copilot CLI, which doesn't follow its threads' state. Every
 * tool is on unless `enabled` names the ones that are. `closes` says how
 * each tool closes its threads (#850); none does by default.
 */
export function handoffOverview({
  copilot = false,
  enabled,
  closes = {},
}: {
  copilot?: boolean;
  enabled?: string[];
  closes?: Partial<Record<"t3" | "claude", HandoffCloseKind>>;
} = {}): PluginsOverview {
  const plugin = {
    id: "agent-handoff",
    version: "1.0.0",
    apiVersion: 4 as const,
    displayName: "Agent handoff",
    iconSvg: ICON,
    entrypoint: "plugin.mjs",
    capabilities: {
      handoff: {
        tools: [
          {
            id: "t3",
            label: "T3 Code",
            iconSvg: ICON,
            settings: [],
            connection: "none" as const,
            followsState: true,
            hooks: false,
            ...(closes.t3 ? { closesThreads: closes.t3 } : {}),
          },
          {
            id: "claude",
            label: "Claude Code",
            iconSvg: ICON,
            settings: [],
            connection: "none" as const,
            followsState: true,
            hooks: true,
            ...(closes.claude ? { closesThreads: closes.claude } : {}),
          },
          ...(copilot
            ? [
                {
                  id: "copilot",
                  label: "Copilot CLI",
                  iconSvg: ICON,
                  settings: [],
                  connection: "none" as const,
                  followsState: false,
                  hooks: false,
                },
              ]
            : []),
        ],
      },
    },
    connectionFields: [],
  };
  return {
    pluginsEnabled: true,
    unsignedPluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        enabledHandoffTools:
          enabled ?? plugin.capabilities.handoff.tools.map((tool) => tool.id),
        connections: [],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  } as PluginsOverview;
}

export function handoffRecord(overrides: Partial<Handoff> = {}): Handoff {
  return {
    id: "h1",
    pluginId: "agent-handoff",
    toolId: "t3",
    workItemId: "item-1",
    projectId: "project-1",
    folderId: "folder-1",
    threadId: "thread-1",
    title: "[PAY-12] Fix login redirect",
    branch: "pay-12-fix-login-redirect",
    link: "t3://thread/thread-1",
    native: { status: "running", label: "Running in T3" },
    startedAt: 1_000,
    state: "working",
    checkedAt: 2_000,
    changedAt: 2_000,
    history: [],
    ...overrides,
  };
}
