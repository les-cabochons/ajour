import path from "node:path";
import type { AgentCliAdapter, RunnerEvent } from "../adapter.ts";

/**
 * Claude Code, run headless with only Ajour's MCP servers. The MCP config
 * file holds `${AJOUR_MCP_TOKEN}`, which Claude Code expands from the
 * environment, so no file holds the token. Flags confirmed by
 * qa/agents/smoke-claude-code.sh (see the spec's smoke test results).
 * Never `--bare`: it drops subscription login.
 */
export const claudeCodeAdapter: AgentCliAdapter = {
  id: "claude-code",
  label: "Claude Code",
  executableName: "claude",

  parseVersion(output) {
    return output.match(/\d+\.\d+\.\d+/)?.[0];
  },

  buildInvocation(input) {
    const mcpConfig = {
      mcpServers: {
        ajour: {
          type: "http",
          url: input.ajourMcpUrl,
          headers: { Authorization: "Bearer ${AJOUR_MCP_TOKEN}" },
        },
        playwright: { type: "stdio", ...input.playwright },
      },
    };
    const args = [
      "-p",
      "Do the task in your instructions now.",
      "--append-system-prompt-file",
      path.join(input.workDirectory, "prompt.md"),
      "--mcp-config",
      path.join(input.workDirectory, "mcp.json"),
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--tools",
      "",
      "--allowedTools",
      "mcp__ajour",
      "mcp__playwright",
      "--permission-mode",
      "dontAsk",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(input.model ? ["--model", input.model] : []),
    ];
    return {
      command: input.executable,
      args,
      env: {
        ...input.baseEnv,
        AJOUR_MCP_TOKEN: input.token,
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      },
      files: {
        "prompt.md": input.prompt,
        "mcp.json": JSON.stringify(mcpConfig, null, 2),
      },
    };
  },

  parseEvent(line): RunnerEvent | null {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (event.type === "system" && event.subtype === "init") {
      const servers = Array.isArray(event.mcp_servers)
        ? (event.mcp_servers as unknown[])
        : [];
      const failed = servers.find(
        (server): server is { name: string; status: string } =>
          typeof server === "object" &&
          server !== null &&
          typeof (server as { name?: unknown }).name === "string" &&
          (server as { status?: unknown }).status !== "connected",
      );
      return failed ? { kind: "mcp-failed", server: failed.name } : null;
    }
    if (event.type === "assistant") {
      const content = ((event.message as { content?: unknown[] })?.content ??
        []) as { type?: string }[];
      return content.some((item) => item.type === "tool_use")
        ? { kind: "tool-call" }
        : null;
    }
    if (event.type === "result") {
      return event.is_error
        ? {
            kind: "failed",
            message: `Claude Code stopped: ${String(event.subtype)}.`,
          }
        : { kind: "finished", summary: String(event.result ?? "") };
    }
    return null;
  },
};
