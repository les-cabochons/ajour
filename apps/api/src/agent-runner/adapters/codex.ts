import path from "node:path";
import type {
  AgentCliAdapter,
  ConversationAdapter,
  ConversationEvent,
  RunnerEvent,
} from "../adapter.ts";

type ConfigValue = string | number | boolean | string[];

/**
 * No skills, plugins, memories, instruction files or tools but MCP. With
 * `--ignore-user-config`, the user's own config, MCP servers and hooks stay
 * out too. Ajour's server reads the token from the environment.
 */
function isolatedConfig(
  workDirectory: string,
  ajourMcpUrl: string,
): Record<string, ConfigValue> {
  return {
    model_instructions_file: path.join(workDirectory, "prompt.md"),
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
    "mcp_servers.ajour.url": ajourMcpUrl,
    "mcp_servers.ajour.bearer_token_env_var": "AJOUR_MCP_TOKEN",
    "mcp_servers.ajour.required": true,
    "mcp_servers.ajour.default_tools_approval_mode": "approve",
  };
}

function configArgs(config: Record<string, ConfigValue>): string[] {
  return Object.entries(config).flatMap(([name, value]) => [
    "--config",
    `${name}=${JSON.stringify(value)}`,
  ]);
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function turnFailure(event: Record<string, unknown>): string {
  const error = event.error as { message?: unknown } | undefined;
  return typeof error?.message === "string"
    ? error.message
    : "Codex could not complete the task.";
}

/**
 * A pull request's conversation on Codex: one `exec` process per turn, and
 * `exec resume` on the thread for the next ones. Unlike `app-server`, `exec`
 * can leave the user's config out. The thread is persisted so it can be
 * resumed, and Stop ends the process.
 */
const codexConversation: ConversationAdapter = {
  mode: "per-turn",

  buildInvocation(input) {
    return {
      command: input.executable,
      args: [
        "--no-daemon",
        "--ask-for-approval",
        "never",
        "exec",
        ...(input.resume ? ["resume"] : []),
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--json",
        ...configArgs({
          ...isolatedConfig(input.workDirectory, input.ajourMcpUrl),
          sandbox_mode: "read-only",
        }),
        ...(input.model ? ["--model", input.model] : []),
        ...(input.resume ? [input.resume] : []),
        // The turn comes on stdin.
        "-",
      ],
      env: { ...input.baseEnv, AJOUR_MCP_TOKEN: input.token },
      files: { "prompt.md": input.prompt },
    };
  },

  createCodec() {
    // What each agent message already sent, so a grown one sends only what
    // is new, and a later one starts a new paragraph.
    const sent = new Map<string, string>();
    return {
      open: () => [],
      sendTurn: (text) => [text],
      interrupt: () => [],
      read(line) {
        const event = parseLine(line);
        const events: ConversationEvent[] = [];
        const item = event?.item as Record<string, unknown> | undefined;
        if (
          event?.type === "thread.started" &&
          typeof event.thread_id === "string"
        ) {
          events.push({ kind: "session", id: event.thread_id });
        } else if (
          event?.type === "item.started" &&
          item?.type === "mcp_tool_call"
        ) {
          events.push({ kind: "tool-call" });
        } else if (
          (event?.type === "item.updated" ||
            event?.type === "item.completed") &&
          item?.type === "agent_message" &&
          typeof item.text === "string"
        ) {
          const id = typeof item.id === "string" ? item.id : "";
          const before = sent.get(id);
          const separator = before === undefined && sent.size > 0 ? "\n\n" : "";
          const text = item.text.startsWith(before ?? "")
            ? item.text.slice((before ?? "").length)
            : item.text;
          sent.set(id, item.text);
          if (text) events.push({ kind: "text", text: separator + text });
        } else if (event?.type === "turn.completed") {
          events.push({ kind: "turn-done" });
        } else if (event?.type === "turn.failed") {
          events.push({ kind: "turn-failed", message: turnFailure(event) });
        }
        return { events, reply: [] };
      },
    };
  },
};

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
    const config: Record<string, ConfigValue> = {
      ...isolatedConfig(input.workDirectory, input.ajourMcpUrl),
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
        ...configArgs(config),
        ...(input.model ? ["--model", input.model] : []),
        "Do the task in your instructions now.",
      ],
      env: { ...input.baseEnv, AJOUR_MCP_TOKEN: input.token },
      files: { "prompt.md": input.prompt },
    };
  },

  parseEvent(line): RunnerEvent | null {
    const event = parseLine(line);
    if (event?.type === "turn.failed") {
      return { kind: "failed", message: turnFailure(event) };
    }
    const item = event?.item as Record<string, unknown> | undefined;
    if (event?.type === "item.started" && item?.type === "mcp_tool_call") {
      return { kind: "tool-call" };
    }
    if (
      event?.type === "item.completed" &&
      item?.type === "agent_message" &&
      typeof item.text === "string"
    ) {
      return { kind: "finished", summary: item.text };
    }
    return null;
  },

  conversation: codexConversation,
};
