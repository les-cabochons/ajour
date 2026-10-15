import path from "node:path";
import type { AgentCliAdapter, RunnerEvent } from "../adapter.ts";

/**
 * Codex exec with the user's login, but no user config, skills, plugins or
 * instruction files. MCP tokens stay in the environment. Tested with 0.161.0.
 */
export const codexAdapter: AgentCliAdapter = {
  id: "codex",
  label: "Codex",
  executableName: "codex",

  parseVersion(output) {
    return output.match(/\d+\.\d+\.\d+/)?.[0];
  },

  buildInvocation(input) {
    const config: Record<string, string | number | boolean | string[]> = {
      model_instructions_file: path.join(input.workDirectory, "prompt.md"),
      project_doc_max_bytes: 0,
      "skills.include_instructions": false,
      "skills.bundled.enabled": false,
      "features.skip_host_skill_discovery": true,
      "features.plugins": false,
      "features.apps": false,
      "features.memories": false,
      "features.multi_agent": false,
      "features.multi_agent_v2": false,
      "agents.enabled": false,
      "features.goals": false,
      "tools.experimental_request_user_input.enabled": false,
      "features.hooks": false,
      "features.shell_tool": false,
      "features.unified_exec": false,
      "features.shell_snapshot": false,
      "features.image_generation": false,
      "features.browser_use": false,
      "features.computer_use": false,
      "features.view_image": false,
      "features.sleep_tool": false,
      "features.tool_suggest": false,
      web_search: "disabled",
      "mcp_servers.ajour.url": input.ajourMcpUrl,
      "mcp_servers.ajour.bearer_token_env_var": "AJOUR_MCP_TOKEN",
      "mcp_servers.ajour.required": true,
      "mcp_servers.ajour.default_tools_approval_mode": "approve",
      "mcp_servers.playwright.command": input.playwright.command,
      "mcp_servers.playwright.args": input.playwright.args,
      "mcp_servers.playwright.required": true,
      "mcp_servers.playwright.default_tools_approval_mode": "approve",
    };
    for (const [name, value] of Object.entries(input.playwright.env)) {
      // Codex splits override paths on dots without parsing quoted keys.
      // The host supplies portable environment names, such as ELECTRON_RUN_AS_NODE.
      config[`mcp_servers.playwright.env.${name}`] = value;
    }
    return {
      command: input.executable,
      args: [
        "--no-daemon",
        "--ask-for-approval",
        "never",
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        ...Object.entries(config).flatMap(([name, value]) => [
          "--config",
          `${name}=${JSON.stringify(value)}`,
        ]),
        ...(input.model ? ["--model", input.model] : []),
        "Do the task in your instructions now.",
      ],
      env: { ...input.baseEnv, AJOUR_MCP_TOKEN: input.token },
      files: { "prompt.md": input.prompt },
    };
  },

  parseEvent(line): RunnerEvent | null {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null) return null;
      event = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    if (event.type === "turn.failed") {
      const error = event.error as { message?: unknown } | undefined;
      return {
        kind: "failed",
        message:
          typeof error?.message === "string"
            ? error.message
            : "Codex could not complete the task.",
      };
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (event.type === "item.started" && item?.type === "mcp_tool_call") {
      return { kind: "tool-call" };
    }
    if (
      event.type === "item.completed" &&
      item?.type === "agent_message" &&
      typeof item.text === "string"
    ) {
      return { kind: "finished", summary: item.text };
    }
    return null;
  },
};
