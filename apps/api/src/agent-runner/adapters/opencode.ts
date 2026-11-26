import path from "node:path";
import type {
  AgentCliAdapter,
  ConversationAdapter,
  ConversationCodec,
  ConversationEvent,
  RunnerEvent,
} from "../adapter.ts";

/** OPENCODE_ variables that carry the user's login, not their config. */
const KEPT_OPENCODE_VARIABLES = new Set([
  "OPENCODE_API_KEY",
  "OPENCODE_AUTH_CONTENT",
]);

/**
 * The environment without the user's OpenCode overrides, such as
 * OPENCODE_CONFIG_CONTENT or OPENCODE_PERMISSION, which OpenCode merges over
 * the generated config.
 */
function withoutOpencodeOverrides(env: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !name.startsWith("OPENCODE_") || KEPT_OPENCODE_VARIABLES.has(name),
    ),
  );
}

/**
 * The user's login, which lives in OpenCode's data folder, with a config
 * folder of the run's own: no user config, agents, plugins, skills or
 * instruction files, OpenCode's or Claude Code's.
 */
function isolatedEnv(
  baseEnv: Record<string, string>,
  workDirectory: string,
  token: string,
): Record<string, string> {
  return {
    ...withoutOpencodeOverrides(baseEnv),
    AJOUR_MCP_TOKEN: token,
    // The user's global config folder holds their agents, plugins and AGENTS.md.
    XDG_CONFIG_HOME: path.join(workDirectory, "config"),
    OPENCODE_CONFIG: path.join(workDirectory, "opencode.json"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_SHARE: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  };
}

/** Ajour's MCP server. OpenCode fills the header from the environment. */
function ajourServer(url: string) {
  return {
    type: "remote",
    url,
    oauth: false,
    headers: { Authorization: "Bearer {env:AJOUR_MCP_TOKEN}" },
  };
}

/**
 * The config file: Ajour's agent, whose prompt is read relative to the file
 * so it stays out of the arguments, and every tool denied but those of the
 * given MCP servers.
 */
function configFile(
  mcp: Record<string, unknown>,
  extra: {
    default_agent?: string;
    model?: string;
    agents?: Record<string, unknown>;
    readRoot?: string;
  } = {},
): string {
  const { agents, readRoot, ...settings } = extra;
  const config = {
    $schema: "https://opencode.ai/config.json",
    autoupdate: false,
    share: "disabled",
    ...settings,
    agent: {
      ajour: { mode: "primary", prompt: "{file:./prompt.md}" },
      ...agents,
    },
    // MCP tools are named <server>_<tool>.
    permission: {
      "*": "deny",
      ...Object.fromEntries(
        Object.keys(mcp).map((name) => [`${name}_*`, "allow"]),
      ),
      ...(readRoot ? readOnlyIn(readRoot) : {}),
    },
    mcp,
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * The read-only file tools, in one folder only (#795): editing and the
 * shell stay denied by `*`, and a read outside the run's folder is refused
 * unless it is in `root`. OpenCode resolves a path before it matches it, so
 * `..` can't step out, and a later rule wins over an earlier one.
 */
function readOnlyIn(root: string) {
  return {
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    external_directory: { "*": "deny", [path.join(root, "*")]: "allow" },
  };
}

/**
 * A pull request's conversation on OpenCode: one `opencode acp` process,
 * which speaks the Agent Client Protocol on stdin and stdout, kept warm
 * across turns and streaming its answers. A later process continues the
 * session with `session/load`. Only Ajour's server and its tools are
 * allowed. From the #792 spike, with OpenCode 1.19.6.
 */
const opencodeConversation: ConversationAdapter = {
  mode: "warm",
  readsFiles: true,

  buildInvocation(input) {
    return {
      command: input.executable,
      // ACP reports neither a failed MCP server nor a provider error, but
      // OpenCode logs both: the codec reads them on stderr.
      args: ["acp", "--pure", "--print-logs", "--log-level", "WARN"],
      env: isolatedEnv(input.baseEnv, input.workDirectory, input.token),
      files: {
        "opencode.json": configFile(
          { ajour: ajourServer(input.ajourMcpUrl) },
          {
            default_agent: "ajour",
            ...(input.model ? { model: input.model } : {}),
            // Titling a session sends its first message in a request of its own.
            agents: { title: { disable: true } },
            ...(input.readRoot ? { readRoot: input.readRoot } : {}),
          },
        ),
        "prompt.md": input.prompt,
      },
    };
  },

  createCodec: (input) => createAcpCodec(input.workDirectory, input.resume),
};

type JsonRpcMessage = {
  id?: unknown;
  method?: unknown;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: unknown; data?: { message?: unknown } };
};

function parseMessage(line: string): JsonRpcMessage | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as JsonRpcMessage)
      : null;
  } catch {
    return null;
  }
}

function errorMessage(error: JsonRpcMessage["error"]): string {
  const message = error?.data?.message ?? error?.message;
  return typeof message === "string" && message
    ? message
    : "OpenCode could not complete the turn.";
}

/** OpenCode's log line for an MCP server that didn't start: its name. */
function failedMcpServer(line: string): string | undefined {
  if (
    !/\bstatus=failed\b/.test(line) ||
    !/\btype=(remote|local)\b/.test(line)
  ) {
    return undefined;
  }
  return line.match(/\bkey=([^\s"]+)/)?.[1];
}

/**
 * OpenCode's log line for a provider error during a turn, such as a missing
 * key or a usage limit: the provider's message.
 */
function providerFailure(line: string): string | undefined {
  if (
    !/\blevel=ERROR\b/.test(line) ||
    !line.includes('message="stream error"')
  ) {
    return undefined;
  }
  const detail = line.match(/\berror\.error="((?:[^"\\]|\\.)*)"/)?.[1];
  return (
    detail?.replace(/^\w*Error: /, "") ||
    "OpenCode's model provider returned an error."
  );
}

type Read = { events: ConversationEvent[]; reply: string[] };
const NOTHING: Read = { events: [], reply: [] };
const said = (...events: ConversationEvent[]): Read => ({ events, reply: [] });

/**
 * The client side of one `opencode acp` process. It initializes, opens a
 * session, or loads the one to resume, and holds the first turn until the
 * session is ready. A process whose session didn't open can't take a turn,
 * so it ends; a failed load names no session instead, so the runner starts
 * the turn over on a new one.
 */
function createAcpCodec(
  workDirectory: string,
  resume: string | undefined,
): ConversationCodec {
  let nextId = 0;
  let initializeId: number | undefined;
  let sessionRequestId: number | undefined;
  let sessionId: string | undefined;
  /** The turn sent before the session was ready. */
  let held: string | undefined;
  let promptId: number | undefined;
  /** Set when a provider error ended the turn and the codec cancelled its prompt. */
  let failure: string | undefined;

  const request = (method: string, params: unknown) => {
    nextId += 1;
    return {
      id: nextId,
      line: JSON.stringify({ jsonrpc: "2.0", id: nextId, method, params }),
    };
  };
  const prompt = (text: string) => {
    failure = undefined;
    const sent = request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    promptId = sent.id;
    return [sent.line];
  };
  const cancel = () => [
    JSON.stringify({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId },
    }),
  ];
  /** The agent's own request: every permission and client method is refused. */
  const answerRequest = (message: JsonRpcMessage) =>
    JSON.stringify(
      message.method === "session/request_permission"
        ? {
            jsonrpc: "2.0",
            id: message.id,
            result: { outcome: { outcome: "cancelled" } },
          }
        : {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" },
          },
    );

  /** A notification: only the running turn's own updates count. */
  const readUpdate = (message: JsonRpcMessage): Read => {
    // A load replays the session's history before it answers.
    if (
      message.method !== "session/update" ||
      promptId === undefined ||
      message.params?.sessionId !== sessionId
    ) {
      return NOTHING;
    }
    const update = message.params?.update as
      | {
          sessionUpdate?: unknown;
          content?: { type?: unknown; text?: unknown };
        }
      | undefined;
    if (
      update?.sessionUpdate === "agent_message_chunk" &&
      update.content?.type === "text" &&
      typeof update.content.text === "string" &&
      update.content.text
    ) {
      return said({ kind: "text", text: update.content.text });
    }
    // Its later updates, tool_call_update, are the same call.
    if (update?.sessionUpdate === "tool_call")
      return said({ kind: "tool-call" });
    return NOTHING;
  };

  const readInitialized = (message: JsonRpcMessage): Read => {
    initializeId = undefined;
    if (message.error) {
      return said({ kind: "cli-failed", message: errorMessage(message.error) });
    }
    const sent = resume
      ? request("session/load", {
          sessionId: resume,
          cwd: workDirectory,
          mcpServers: [],
        })
      : request("session/new", { cwd: workDirectory, mcpServers: [] });
    sessionRequestId = sent.id;
    return { events: [], reply: [sent.line] };
  };

  const readOpened = (message: JsonRpcMessage): Read => {
    sessionRequestId = undefined;
    const opened =
      resume ?? (message.result as { sessionId?: unknown })?.sessionId;
    if (message.error || typeof opened !== "string" || !opened) {
      const failed = errorMessage(message.error);
      // OpenCode 1.19.6 answers a load of a session it doesn't have with a
      // bare -32603 "service failure", like its other failures. Naming no
      // session lets the runner start over, saying the history is lost.
      return resume
        ? said({ kind: "turn-failed", message: failed })
        : said({ kind: "cli-failed", message: failed });
    }
    sessionId = opened;
    const reply = held === undefined ? [] : prompt(held);
    held = undefined;
    return { events: [{ kind: "session", id: opened }], reply };
  };

  const readAnswered = (message: JsonRpcMessage): Read => {
    promptId = undefined;
    const failed = failure;
    failure = undefined;
    if (failed !== undefined)
      return said({ kind: "turn-failed", message: failed });
    if (message.error) {
      return said({
        kind: "turn-failed",
        message: errorMessage(message.error),
      });
    }
    const { stopReason } = (message.result ?? {}) as { stopReason?: unknown };
    if (stopReason === "cancelled") return said({ kind: "turn-interrupted" });
    if (stopReason === "refusal") {
      return said({
        kind: "turn-failed",
        message: "The model refused to answer.",
      });
    }
    return said({ kind: "turn-done" });
  };

  return {
    open() {
      const sent = request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      });
      initializeId = sent.id;
      return [sent.line];
    },

    sendTurn(text) {
      if (sessionId === undefined) {
        held = text;
        return [];
      }
      return prompt(text);
    },

    // Before the session is ready there is nothing to cancel: the runner ends the process.
    interrupt: () => (promptId === undefined ? [] : cancel()),

    read(line) {
      const message = parseMessage(line);
      if (!message) return NOTHING;
      if (typeof message.method === "string") {
        return message.id === undefined
          ? readUpdate(message)
          : { events: [], reply: [answerRequest(message)] };
      }
      if (message.id === undefined) return NOTHING;
      if (message.id === initializeId) return readInitialized(message);
      if (message.id === sessionRequestId) return readOpened(message);
      if (message.id === promptId) return readAnswered(message);
      return NOTHING;
    },

    readError(line) {
      const server = failedMcpServer(line);
      if (server) return said({ kind: "mcp-failed", server });
      const provider = providerFailure(line);
      // ACP never answers a prompt its provider failed: cancelling frees it.
      if (
        provider !== undefined &&
        promptId !== undefined &&
        failure === undefined
      ) {
        failure = provider;
        return { events: [], reply: cancel() };
      }
      return NOTHING;
    },
  };
}

/**
 * OpenCode `run` with the user's login and a config folder of its own.
 * Every built-in tool is denied; only the two MCP servers are allowed. The
 * token reaches the config through `{env:AJOUR_MCP_TOKEN}`. Tested with
 * 1.18.35.
 */
export const opencodeAdapter: AgentCliAdapter = {
  id: "opencode",
  label: "OpenCode",
  executableName: "opencode",

  parseVersion(output) {
    return output.match(/\d+\.\d+\.\d+/)?.[0];
  },

  buildInvocation(input) {
    return {
      command: input.executable,
      args: [
        "run",
        "--agent",
        "ajour",
        "--pure",
        "--format",
        "json",
        ...(input.model ? ["--model", input.model] : []),
        "Do the task in your instructions now.",
      ],
      env: isolatedEnv(input.baseEnv, input.workDirectory, input.token),
      files: {
        "opencode.json": configFile({
          ajour: ajourServer(input.ajourMcpUrl),
          playwright: {
            type: "local",
            command: [input.playwright.command, ...input.playwright.args],
            environment: input.playwright.env,
          },
        }),
        "prompt.md": input.prompt,
      },
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
    const part = event.part as Record<string, unknown> | undefined;
    if (event.type === "tool_use") return { kind: "tool-call" };
    if (event.type === "text" && typeof part?.text === "string") {
      // Each step can end with text; the runner keeps the last one.
      return { kind: "finished", summary: part.text };
    }
    if (event.type === "error") {
      const error = event.error as
        { data?: { message?: unknown }; message?: unknown } | undefined;
      const message = error?.data?.message ?? error?.message;
      return {
        kind: "failed",
        message:
          typeof message === "string"
            ? message
            : "OpenCode could not complete the task.",
      };
    }
    return null;
  },

  conversation: opencodeConversation,
};
