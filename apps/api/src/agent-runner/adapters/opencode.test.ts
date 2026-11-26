import path from "node:path";
import { describe, expect, it } from "vitest";
import { opencodeAdapter } from "./opencode.ts";

const TOKEN = "ajour_secret-token-value";
const input = {
  executable: "/opt/homebrew/bin/opencode",
  workDirectory: "/tmp/run with spaces",
  prompt: "Do the week.",
  ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
  playwright: {
    command: "/Ajour app/MacOS/Ajour",
    args: ["/Ajour app/playwright/cli.js", "--browser", "chrome"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  },
  model: "",
  baseEnv: { PATH: "/usr/bin", HOME: "/Users/a" },
  token: TOKEN,
};

describe("OpenCode adapter", () => {
  it("keeps the login while isolating config, plugins, skills and instruction files", () => {
    const { args, env } = opencodeAdapter.buildInvocation(input);
    expect(args).toEqual([
      "run",
      "--agent",
      "ajour",
      "--pure",
      "--format",
      "json",
      "Do the task in your instructions now.",
    ]);
    expect(env).toMatchObject({
      HOME: "/Users/a",
      XDG_CONFIG_HOME: path.join(input.workDirectory, "config"),
      OPENCODE_CONFIG: path.join(input.workDirectory, "opencode.json"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    });
    expect(env).not.toHaveProperty("XDG_DATA_HOME");
  });

  it("allows only the two MCP servers, with the token only in the environment", () => {
    const { args, env, files } = opencodeAdapter.buildInvocation(input);
    const config = JSON.parse(files["opencode.json"]!);
    expect(config.permission).toEqual({
      "*": "deny",
      "ajour_*": "allow",
      "playwright_*": "allow",
    });
    expect(config.mcp.ajour).toEqual({
      type: "remote",
      url: "http://127.0.0.1:8787/mcp/ajour",
      oauth: false,
      headers: { Authorization: "Bearer {env:AJOUR_MCP_TOKEN}" },
    });
    expect(config.mcp.playwright).toEqual({
      type: "local",
      command: [
        "/Ajour app/MacOS/Ajour",
        "/Ajour app/playwright/cli.js",
        "--browser",
        "chrome",
      ],
      environment: { ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(config.agent.ajour.prompt).toBe("{file:./prompt.md}");
    expect(files["prompt.md"]).toBe("Do the week.");
    expect(args.join(" ")).not.toContain(TOKEN);
    expect(JSON.stringify(files)).not.toContain(TOKEN);
    expect(env.AJOUR_MCP_TOKEN).toBe(TOKEN);
  });

  it("drops the user's OpenCode overrides but keeps their credentials", () => {
    const { env } = opencodeAdapter.buildInvocation({
      ...input,
      baseEnv: {
        ...input.baseEnv,
        OPENCODE_CONFIG_CONTENT: '{"permission":{"*":"allow"}}',
        OPENCODE_PERMISSION: '{"bash":"allow"}',
        OPENCODE_AUTO_SHARE: "1",
        OPENCODE_CONFIG_DIR: "/Users/a/.opencode-extra",
        OPENCODE_API_KEY: "zen-key",
      },
    });
    expect(env).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
    expect(env).not.toHaveProperty("OPENCODE_PERMISSION");
    expect(env).not.toHaveProperty("OPENCODE_AUTO_SHARE");
    expect(env).not.toHaveProperty("OPENCODE_CONFIG_DIR");
    expect(env.OPENCODE_API_KEY).toBe("zen-key");
    expect(env.OPENCODE_CONFIG).toBe(
      path.join(input.workDirectory, "opencode.json"),
    );
  });

  it("passes the model when one is set", () => {
    const { args } = opencodeAdapter.buildInvocation({
      ...input,
      model: "github-copilot/claude-sonnet-5.5",
    });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe(
      "github-copilot/claude-sonnet-5.5",
    );
  });

  it("reads tool calls, the last text and errors from the JSON events", () => {
    const parse = (event: unknown) =>
      opencodeAdapter.parseEvent(JSON.stringify(event));
    expect(parse({ type: "tool_use", part: { tool: "ajour_ping" } })).toEqual({
      kind: "tool-call",
    });
    expect(
      parse({ type: "text", part: { text: "Entered 3 entries." } }),
    ).toEqual({ kind: "finished", summary: "Entered 3 entries." });
    expect(
      parse({ type: "error", error: { data: { message: "Model not found" } } }),
    ).toEqual({ kind: "failed", message: "Model not found" });
    expect(parse({ type: "step_start" })).toBeNull();
    expect(opencodeAdapter.parseEvent("not json")).toBeNull();
  });

  it("reads the version", () => {
    expect(opencodeAdapter.parseVersion("1.18.35\n")).toBe("1.18.35");
  });
});

describe("OpenCode conversation", () => {
  const conversation = opencodeAdapter.conversation!;
  const conversationInput = {
    executable: "/opt/homebrew/bin/opencode",
    workDirectory: "/tmp/conversation 1",
    prompt: "Review pull request pr-1.",
    ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
    model: "",
    baseEnv: {
      PATH: "/usr/bin",
      HOME: "/Users/a",
      OPENCODE_CONFIG_CONTENT: '{"permission":{"*":"allow"}}',
      OPENCODE_API_KEY: "zen-key",
    },
    token: TOKEN,
  };

  it("keeps one ACP process warm, with only Ajour's server and its tools", () => {
    expect(conversation.mode).toBe("warm");
    const { args, env, files } =
      conversation.buildInvocation(conversationInput);
    expect(args).toEqual([
      "acp",
      "--pure",
      "--print-logs",
      "--log-level",
      "WARN",
    ]);
    const config = JSON.parse(files["opencode.json"]!);
    expect(config.default_agent).toBe("ajour");
    expect(config.agent.ajour).toEqual({
      mode: "primary",
      prompt: "{file:./prompt.md}",
    });
    // Its title request would send the first message again.
    expect(config.agent.title).toEqual({ disable: true });
    expect(config.permission).toEqual({ "*": "deny", "ajour_*": "allow" });
    expect(Object.keys(config.mcp)).toEqual(["ajour"]);
    expect(config.mcp.ajour).toEqual({
      type: "remote",
      url: "http://127.0.0.1:8787/mcp/ajour",
      oauth: false,
      headers: { Authorization: "Bearer {env:AJOUR_MCP_TOKEN}" },
    });
    expect(config).not.toHaveProperty("model");
    expect(files["prompt.md"]).toBe("Review pull request pr-1.");
    expect(args.join(" ")).not.toContain(TOKEN);
    expect(JSON.stringify(files)).not.toContain(TOKEN);
    expect(env).toMatchObject({
      AJOUR_MCP_TOKEN: TOKEN,
      HOME: "/Users/a",
      OPENCODE_API_KEY: "zen-key",
      XDG_CONFIG_HOME: path.join(conversationInput.workDirectory, "config"),
      OPENCODE_CONFIG: path.join(
        conversationInput.workDirectory,
        "opencode.json",
      ),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    });
    expect(env).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
  });

  /** A codec and what it wrote so far, as JSON-RPC messages. */
  function acp(resume?: string) {
    const codec = conversation.createCodec({
      ...conversationInput,
      ...(resume ? { resume } : {}),
    });
    const written: Record<string, any>[] = [];
    const write = (lines: string[]) =>
      written.push(...lines.map((line) => JSON.parse(line)));
    write(codec.open());
    /** Reads one stdout line from the CLI and returns its events. */
    const read = (message: unknown) => {
      const { events, reply } = codec.read(
        typeof message === "string" ? message : JSON.stringify(message),
      );
      write(reply);
      return events;
    };
    /** Reads one stderr line. */
    const readError = (line: string) => {
      const { events, reply } = codec.readError!(line);
      write(reply);
      return events;
    };
    const last = () => written.at(-1)!;
    return { codec, written, write, read, readError, last };
  }
  const update = (sessionId: string, value: unknown) => ({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update: value },
  });
  const chunk = (sessionId: string, text: string) =>
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    });
  const answer = (id: unknown, result: unknown) => ({
    jsonrpc: "2.0",
    id,
    result,
  });

  /** A codec whose session ses_1 is open. */
  function opened() {
    const session = acp();
    session.read(answer(session.last().id, { protocolVersion: 1 }));
    session.read(answer(session.last().id, { sessionId: "ses_1" }));
    return session;
  }

  it("opens a session, holds the first turn until it's ready, and streams it", () => {
    const { codec, write, read, written, last } = acp();
    expect(written).toEqual([
      expect.objectContaining({
        method: "initialize",
        params: expect.objectContaining({ protocolVersion: 1 }),
      }),
    ]);
    // The runner sends the turn before the session exists.
    write(codec.sendTurn("Explain this."));
    expect(written).toHaveLength(1);
    expect(read(answer(written[0]!.id, { protocolVersion: 1 }))).toEqual([]);
    expect(last()).toMatchObject({
      method: "session/new",
      params: { cwd: conversationInput.workDirectory, mcpServers: [] },
    });
    expect(read(answer(last().id, { sessionId: "ses_1" }))).toEqual([
      { kind: "session", id: "ses_1" },
    ]);
    expect(last()).toMatchObject({
      method: "session/prompt",
      params: {
        sessionId: "ses_1",
        prompt: [{ type: "text", text: "Explain this." }],
      },
    });
    const prompt = last().id;
    expect(read(chunk("ses_1", "Hel"))).toEqual([
      { kind: "text", text: "Hel" },
    ]);
    expect(
      read(
        update("ses_1", {
          sessionUpdate: "tool_call",
          toolCallId: "call_1",
          title: "ajour_read_hunks",
          status: "pending",
        }),
      ),
    ).toEqual([{ kind: "tool-call" }]);
    // Its later updates are the same call.
    expect(
      read(
        update("ses_1", {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_1",
          status: "completed",
        }),
      ),
    ).toEqual([]);
    expect(read(answer(prompt, { stopReason: "end_turn" }))).toEqual([
      { kind: "turn-done" },
    ]);

    // A warm session takes the next turn at once.
    write(codec.sendTurn("And this?"));
    expect(last()).toMatchObject({
      method: "session/prompt",
      params: { prompt: [{ type: "text", text: "And this?" }] },
    });
    expect(read(answer(last().id, { stopReason: "max_tokens" }))).toEqual([
      { kind: "turn-done" },
    ]);
  });

  it("cancels a turn with session/cancel and ends it as interrupted", () => {
    const { codec, write, read, last } = opened();
    // Nothing to cancel yet: the runner ends the process instead.
    expect(codec.interrupt()).toEqual([]);
    write(codec.sendTurn("Explain this."));
    const prompt = last().id;
    write(codec.interrupt());
    expect(last()).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "ses_1" },
    });
    expect(read(answer(prompt, { stopReason: "cancelled" }))).toEqual([
      { kind: "turn-interrupted" },
    ]);
  });

  it("fails a turn whose prompt request fails or that the model refuses", () => {
    const { codec, write, read, last } = opened();
    write(codec.sendTurn("One"));
    expect(
      read({
        jsonrpc: "2.0",
        id: last().id,
        error: {
          code: -32603,
          message: "Internal error",
          data: { message: "Model not found" },
        },
      }),
    ).toEqual([{ kind: "turn-failed", message: "Model not found" }]);
    write(codec.sendTurn("Two"));
    expect(read(answer(last().id, { stopReason: "refusal" }))).toEqual([
      { kind: "turn-failed", message: "The model refused to answer." },
    ]);
  });

  it("resumes a session with session/load and skips the history it replays", () => {
    const { codec, write, read, written, last } = acp("ses_0");
    write(codec.sendTurn("Still there?"));
    read(answer(written[0]!.id, { protocolVersion: 1 }));
    expect(last()).toMatchObject({
      method: "session/load",
      params: {
        sessionId: "ses_0",
        cwd: conversationInput.workDirectory,
        mcpServers: [],
      },
    });
    const load = last().id;
    expect(read(chunk("ses_0", "An earlier answer"))).toEqual([]);
    expect(read(answer(load, null))).toEqual([
      { kind: "session", id: "ses_0" },
    ]);
    expect(last()).toMatchObject({
      method: "session/prompt",
      params: { sessionId: "ses_0" },
    });
    expect(read(chunk("ses_0", "Yes"))).toEqual([
      { kind: "text", text: "Yes" },
    ]);
  });

  it("names no session and fails the turn when the one to resume is gone", () => {
    const { codec, write, read, written, last } = acp("ses_gone");
    write(codec.sendTurn("Still there?"));
    read(answer(written[0]!.id, { protocolVersion: 1 }));
    expect(
      read({
        jsonrpc: "2.0",
        id: last().id,
        error: {
          code: -32603,
          message: "Internal error: OpenCode service failure",
        },
      }),
    ).toEqual([
      {
        kind: "turn-failed",
        message: "Internal error: OpenCode service failure",
      },
    ]);
    expect(written.some((message) => message.method === "session/prompt")).toBe(
      false,
    );
  });

  it("ends a process whose session didn't open, since it can't take a turn", () => {
    const failed = {
      code: -32603,
      message: "Internal error",
      data: { message: "Model not found" },
    };
    const notInitialized = acp();
    expect(
      notInitialized.read({
        jsonrpc: "2.0",
        id: notInitialized.last().id,
        error: failed,
      }),
    ).toEqual([{ kind: "cli-failed", message: "Model not found" }]);
    const notOpened = acp();
    notOpened.read(answer(notOpened.last().id, { protocolVersion: 1 }));
    expect(
      notOpened.read({
        jsonrpc: "2.0",
        id: notOpened.last().id,
        error: failed,
      }),
    ).toEqual([{ kind: "cli-failed", message: "Model not found" }]);
  });

  it("refuses every permission and client request the agent makes", () => {
    const { read, last } = opened();
    expect(
      read({
        jsonrpc: "2.0",
        id: 7,
        method: "session/request_permission",
        params: { sessionId: "ses_1", options: [] },
      }),
    ).toEqual([]);
    expect(last()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { outcome: { outcome: "cancelled" } },
    });
    read({ jsonrpc: "2.0", id: 8, method: "fs/read_text_file", params: {} });
    expect(last()).toMatchObject({ id: 8, error: { code: -32601 } });
    expect(read("not json")).toEqual([]);
  });

  it("reads a failed MCP server from OpenCode's log", () => {
    const { readError } = opened();
    expect(
      readError(
        'timestamp=2026-11-24T07:15:29.127Z level=WARN run=12f67fb8 message="server unavailable" key=ajour type=remote status=failed',
      ),
    ).toEqual([{ kind: "mcp-failed", server: "ajour" }]);
    expect(
      readError(
        'timestamp=2026-11-24T07:15:06.012Z level=WARN message="duplicate skill name" name=pdf',
      ),
    ).toEqual([]);
  });

  it("cancels a prompt whose provider failed, which OpenCode only logs, and fails its turn", () => {
    const { codec, write, read, readError, last } = opened();
    write(codec.sendTurn("Explain this."));
    const prompt = last().id;
    expect(
      readError(
        'timestamp=2026-11-24T07:22:39.894Z level=ERROR run=012e26f9 message="stream error" providerID=opencode modelID=big-pickle session.id=ses_1 agent=ajour mode=primary error.error="AI_APICallError: Free usage limit reached."',
      ),
    ).toEqual([]);
    expect(last()).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "ses_1" },
    });
    // OpenCode answers the cancelled prompt as an ordinary end.
    expect(read(answer(prompt, { stopReason: "end_turn" }))).toEqual([
      { kind: "turn-failed", message: "Free usage limit reached." },
    ]);
    // The next turn starts clean.
    write(codec.sendTurn("Again"));
    expect(read(answer(last().id, { stopReason: "end_turn" }))).toEqual([
      { kind: "turn-done" },
    ]);
  });

  it("reads a clone's worktree with its read-only file tools, in that folder only", () => {
    const root = path.join(path.sep, "cache", "worktrees", "0123456789abcdef");
    const without = JSON.parse(
      conversation.buildInvocation(conversationInput).files["opencode.json"]!,
    ).permission;
    expect(without).toEqual({ "*": "deny", "ajour_*": "allow" });

    const { permission } = JSON.parse(
      conversation.buildInvocation({ ...conversationInput, readRoot: root })
        .files["opencode.json"]!,
    );
    expect(permission).toEqual({
      "*": "deny",
      "ajour_*": "allow",
      read: "allow",
      grep: "allow",
      glob: "allow",
      list: "allow",
      external_directory: { "*": "deny", [path.join(root, "*")]: "allow" },
    });
    // Editing, the shell and everything else stay denied by "*".
    expect(Object.keys(permission)).not.toContain("edit");
    expect(Object.keys(permission)).not.toContain("bash");
    expect(conversation.readsFiles).toBe(true);
  });

  it("sets the model in the config when one is set", () => {
    const { files } = conversation.buildInvocation({
      ...conversationInput,
      model: "anthropic/claude-sonnet-5-5",
    });
    expect(JSON.parse(files["opencode.json"]!).model).toBe(
      "anthropic/claude-sonnet-5-5",
    );
  });
});
