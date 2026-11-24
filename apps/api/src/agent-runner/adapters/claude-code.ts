import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AgentCliAdapter,
  ConversationAdapter,
  ConversationEvent,
  RunnerEvent,
} from "../adapter.ts";

/**
 * Init statuses that mean an MCP server will not work. `pending` (still
 * connecting), `disabled`, `connected` and any status Ajour does not know
 * do not end the run.
 */
const FAILED_MCP_STATUSES = new Set<unknown>(["failed", "needs-auth"]);

/** Keeps the user's instruction files, memory and claude.ai servers out. */
const ISOLATED_ENV = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
};

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

/** The first server of an init event that will not work. */
function failedMcpServer(event: Record<string, unknown>): string | undefined {
  const servers = Array.isArray(event.mcp_servers)
    ? (event.mcp_servers as unknown[])
    : [];
  return servers.find(
    (server): server is { name: string; status: string } =>
      typeof server === "object" &&
      server !== null &&
      typeof (server as { name?: unknown }).name === "string" &&
      FAILED_MCP_STATUSES.has((server as { status?: unknown }).status),
  )?.name;
}

function callsTool(event: Record<string, unknown>): boolean {
  const content = ((event.message as { content?: unknown[] })?.content ??
    []) as { type?: string }[];
  return content.some((item) => item.type === "tool_use");
}

/** A result's failure message: provider failures can use subtype "success". */
function resultFailure(event: Record<string, unknown>): string | undefined {
  if (!event.is_error) return undefined;
  const message = typeof event.result === "string" ? event.result.trim() : "";
  return message || `Claude Code stopped: ${String(event.subtype)}.`;
}

/**
 * Claude Code reads a network folder, such as a WSL distribution's
 * `\\wsl.localhost\Ubuntu\…`, only with a rule that allows it by name, even
 * among the folders it was given. The rule allows reads under that folder
 * and nowhere else (Claude Code 2.1.330).
 */
function networkReadRule(root: string): string[] {
  if (!/^\\\\[^\\]/.test(root)) return [];
  return [`Read(${root.replaceAll("\\", "/").replace(/\/+$/, "")}/**)`];
}

/**
 * A pull request's conversation. Claude Code reads one user message per turn
 * on its open stdin and streams partial messages, with only Ajour's server
 * and no built-in tool. A later process continues it with `--resume`. Flags
 * from docs/research/agent-sessions-for-deck.md (Claude Code 2.1.318).
 */
const claudeCodeConversation: ConversationAdapter = {
  mode: "warm",
  readsFiles: true,

  buildInvocation(input) {
    const mcpConfig = {
      mcpServers: {
        ajour: {
          type: "http",
          url: input.ajourMcpUrl,
          headers: { Authorization: "Bearer ${AJOUR_MCP_TOKEN}" },
        },
      },
    };
    return {
      command: input.executable,
      args: [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--append-system-prompt-file",
        path.join(input.workDirectory, "prompt.md"),
        "--mcp-config",
        path.join(input.workDirectory, "mcp.json"),
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--disable-slash-commands",
        // With a clone, only its read-only file tools, rooted at the
        // worktree: `dontAsk` refuses a read of anything outside the
        // folders Claude Code was given (#795).
        "--tools",
        input.readRoot ? "Read,Grep,Glob" : "",
        ...(input.readRoot ? ["--add-dir", input.readRoot] : []),
        "--allowedTools",
        "mcp__ajour",
        ...(input.readRoot ? networkReadRule(input.readRoot) : []),
        "--permission-mode",
        "dontAsk",
        ...(input.resume ? ["--resume", input.resume] : []),
        ...(input.model ? ["--model", input.model] : []),
      ],
      env: { ...input.baseEnv, AJOUR_MCP_TOKEN: input.token, ...ISOLATED_ENV },
      files: {
        "prompt.md": input.prompt,
        "mcp.json": JSON.stringify(mcpConfig, null, 2),
      },
    };
  },

  createCodec() {
    // Set by an interrupt, so the result that ends the turn reads as one.
    let interrupting = false;
    return {
      open: () => [],
      sendTurn(text) {
        interrupting = false;
        return [
          JSON.stringify({
            type: "user",
            message: { role: "user", content: text },
            session_id: "",
            parent_tool_use_id: null,
          }),
        ];
      },
      interrupt() {
        interrupting = true;
        return [
          JSON.stringify({
            type: "control_request",
            request_id: randomUUID(),
            request: { subtype: "interrupt" },
          }),
        ];
      },
      read(line) {
        const event = parseLine(line);
        const events: ConversationEvent[] = [];
        if (event?.type === "system" && event.subtype === "init") {
          if (typeof event.session_id === "string" && event.session_id) {
            events.push({ kind: "session", id: event.session_id });
          }
          const failed = failedMcpServer(event);
          if (failed) events.push({ kind: "mcp-failed", server: failed });
        } else if (event?.type === "stream_event") {
          const inner = event.event as
            | { type?: unknown; delta?: { type?: unknown; text?: unknown } }
            | undefined;
          if (
            inner?.type === "content_block_delta" &&
            inner.delta?.type === "text_delta" &&
            typeof inner.delta.text === "string" &&
            inner.delta.text
          ) {
            events.push({ kind: "text", text: inner.delta.text });
          }
        } else if (event?.type === "assistant") {
          // Its text already came as deltas.
          if (callsTool(event)) events.push({ kind: "tool-call" });
        } else if (event?.type === "result") {
          const failure = resultFailure(event);
          if (interrupting) events.push({ kind: "turn-interrupted" });
          else if (failure)
            events.push({ kind: "turn-failed", message: failure });
          else events.push({ kind: "turn-done" });
          interrupting = false;
        }
        return { events, reply: [] };
      },
    };
  },
};

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
      // Nothing resumes a run, so its transcript stays off disk, as Codex's
      // --ephemeral keeps it (Claude Code 2.1.327).
      "--no-session-persistence",
      ...(input.model ? ["--model", input.model] : []),
    ];
    return {
      command: input.executable,
      args,
      env: { ...input.baseEnv, AJOUR_MCP_TOKEN: input.token, ...ISOLATED_ENV },
      files: {
        "prompt.md": input.prompt,
        "mcp.json": JSON.stringify(mcpConfig, null, 2),
      },
    };
  },

  parseEvent(line): RunnerEvent | null {
    const event = parseLine(line);
    if (event?.type === "system" && event.subtype === "init") {
      const failed = failedMcpServer(event);
      return failed ? { kind: "mcp-failed", server: failed } : null;
    }
    if (event?.type === "assistant") {
      return callsTool(event) ? { kind: "tool-call" } : null;
    }
    if (event?.type === "result") {
      // The result carries the useful explanation, such as a session limit
      // and its reset time.
      const failure = resultFailure(event);
      return failure
        ? { kind: "failed", message: failure }
        : { kind: "finished", summary: String(event.result ?? "") };
    }
    return null;
  },

  conversation: claudeCodeConversation,
};
