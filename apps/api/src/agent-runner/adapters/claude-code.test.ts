import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "./claude-code.ts";

const TOKEN = "ajour_secret-token-value";
const input = {
  executable: "/usr/local/bin/claude",
  workDirectory: "/tmp/run-1",
  prompt: "Do the week.",
  ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
  playwright: {
    command: "/app/node",
    args: ["/app/pw/cli.js", "--browser", "chrome"],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  },
  model: "",
  baseEnv: { PATH: "/usr/bin", HOME: "/Users/a" },
  token: TOKEN,
};

describe("Claude Code adapter", () => {
  it("never puts the token in the arguments or the files", () => {
    const invocation = claudeCodeAdapter.buildInvocation(input);
    expect(invocation.args.join(" ")).not.toContain(TOKEN);
    expect(JSON.stringify(invocation.files)).not.toContain(TOKEN);
    expect(invocation.env.AJOUR_MCP_TOKEN).toBe(TOKEN);
  });

  it("loads only Ajour's two MCP servers and only their tools", () => {
    const { args, files } = claudeCodeAdapter.buildInvocation(input);
    expect(args).toContain("--strict-mcp-config");
    const config = JSON.parse(files["mcp.json"]!);
    expect(Object.keys(config.mcpServers)).toEqual(["ajour", "playwright"]);
    expect(config.mcpServers.ajour.headers.Authorization).toBe(
      "Bearer ${AJOUR_MCP_TOKEN}",
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "--allowedTools",
        "mcp__ajour",
        "mcp__playwright",
      ]),
    );
    expect(args).not.toContain("--bare");
  });

  it("keeps the user's instruction files out and passes the prompt as a file", () => {
    const { args, env, files } = claudeCodeAdapter.buildInvocation(input);
    expect(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe("1");
    expect(files["prompt.md"]).toBe("Do the week.");
    expect(args).toEqual(
      expect.arrayContaining([
        "--append-system-prompt-file",
        path.join(input.workDirectory, "prompt.md"),
      ]),
    );
  });

  it("keeps a run's session off disk, since nothing resumes a run", () => {
    expect(claudeCodeAdapter.buildInvocation(input).args).toContain(
      "--no-session-persistence",
    );
  });

  it("passes a model only when one is set", () => {
    expect(claudeCodeAdapter.buildInvocation(input).args).not.toContain(
      "--model",
    );
    expect(
      claudeCodeAdapter.buildInvocation({ ...input, model: "sonnet" }).args,
    ).toEqual(expect.arrayContaining(["--model", "sonnet"]));
  });

  it("reads a failed MCP server, tool calls and the result", () => {
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "system",
          subtype: "init",
          mcp_servers: [
            { name: "ajour", status: "connected" },
            { name: "playwright", status: "failed" },
          ],
        }),
      ),
    ).toEqual({ kind: "mcp-failed", server: "playwright" });
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "mcp__ajour__get_week_changes" },
            ],
          },
        }),
      ),
    ).toEqual({ kind: "tool-call" });
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "Entered 9 lines.",
        }),
      ),
    ).toEqual({ kind: "finished", summary: "Entered 9 lines." });
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "result",
          subtype: "error_max_turns",
          is_error: true,
          result: "",
        }),
      ),
    ).toEqual({
      kind: "failed",
      message: "Claude Code stopped: error_max_turns.",
    });
    expect(claudeCodeAdapter.parseEvent("not json")).toBeNull();
  });

  it("ignores a malformed MCP server list", () => {
    const init = (mcp_servers: unknown) =>
      claudeCodeAdapter.parseEvent(
        JSON.stringify({ type: "system", subtype: "init", mcp_servers }),
      );
    expect(init({})).toBeNull();
    expect(init([null])).toBeNull();
    expect(init(undefined)).toBeNull();
  });

  it("shows the provider error even when the result subtype is success", () => {
    const message =
      "You've hit your session limit · resets 7am (America/Toronto)";
    expect(
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: true,
          result: message,
        }),
      ),
    ).toEqual({ kind: "failed", message });
  });

  it.each([undefined, null, 42, "", "   "])(
    "keeps the error subtype when the result has no message: %s",
    (result) => {
      expect(
        claudeCodeAdapter.parseEvent(
          JSON.stringify({
            type: "result",
            subtype: "error_max_turns",
            is_error: true,
            result,
          }),
        ),
      ).toEqual({
        kind: "failed",
        message: "Claude Code stopped: error_max_turns.",
      });
    },
  );

  it("counts only failed and needs-auth servers as failed", () => {
    const init = (status: string) =>
      claudeCodeAdapter.parseEvent(
        JSON.stringify({
          type: "system",
          subtype: "init",
          mcp_servers: [{ name: "playwright", status }],
        }),
      );
    expect(init("pending")).toBeNull();
    expect(init("disabled")).toBeNull();
    expect(init("connected")).toBeNull();
    expect(init("something-new")).toBeNull();
    expect(init("needs-auth")).toEqual({
      kind: "mcp-failed",
      server: "playwright",
    });
    expect(init("failed")).toEqual({
      kind: "mcp-failed",
      server: "playwright",
    });
  });

  it("reads the version", () => {
    expect(claudeCodeAdapter.parseVersion("2.1.293 (Claude Code)\n")).toBe(
      "2.1.293",
    );
  });
});

describe("Claude Code conversation", () => {
  const conversation = claudeCodeAdapter.conversation!;
  const conversationInput = {
    executable: "/usr/local/bin/claude",
    workDirectory: "/tmp/conversation-1",
    prompt: "Review pull request pr-1.",
    ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
    model: "",
    baseEnv: { PATH: "/usr/bin" },
    token: TOKEN,
  };
  const line = (value: unknown) => JSON.stringify(value);
  const read = (value: unknown) =>
    conversation.createCodec(conversationInput).read(line(value));

  it("keeps stdin open for turns, streams partial text and loads only Ajour's server", () => {
    const { args, env, files } =
      conversation.buildInvocation(conversationInput);
    expect(args).toEqual(
      expect.arrayContaining([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--strict-mcp-config",
        "--allowedTools",
        "mcp__ajour",
      ]),
    );
    expect(args).not.toContain("mcp__playwright");
    expect(args).not.toContain("--resume");
    expect(args.join(" ")).not.toContain(TOKEN);
    expect(JSON.stringify(files)).not.toContain(TOKEN);
    expect(env.AJOUR_MCP_TOKEN).toBe(TOKEN);
    expect(Object.keys(JSON.parse(files["mcp.json"]!).mcpServers)).toEqual([
      "ajour",
    ]);
    expect(files["prompt.md"]).toBe("Review pull request pr-1.");
  });

  it("reads a clone's worktree with its read-only file tools only, and nothing without one", () => {
    const without = conversation.buildInvocation(conversationInput).args;
    expect(without[without.indexOf("--tools") + 1]).toBe("");
    expect(without).not.toContain("--add-dir");

    const { args } = conversation.buildInvocation({
      ...conversationInput,
      readRoot: "/cache/worktrees/0123456789abcdef",
    });
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(args[args.indexOf("--add-dir") + 1]).toBe(
      "/cache/worktrees/0123456789abcdef",
    );
    // dontAsk refuses whatever isn't allowed: no write, no shell, no read elsewhere.
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("mcp__ajour");
    expect(conversation.readsFiles).toBe(true);
  });

  it("allows reads of a WSL worktree by name, since Claude Code refuses a network folder otherwise", () => {
    const root = String.raw`\\wsl.localhost\Ubuntu\home\alex\.cache\ajour\deck-worktrees\0123`;
    const { args } = conversation.buildInvocation({
      ...conversationInput,
      readRoot: root,
    });
    expect(args[args.indexOf("--add-dir") + 1]).toBe(root);
    const allowed = args.slice(
      args.indexOf("--allowedTools") + 1,
      args.indexOf("--permission-mode"),
    );
    expect(allowed).toEqual([
      "mcp__ajour",
      "Read(//wsl.localhost/Ubuntu/home/alex/.cache/ajour/deck-worktrees/0123/**)",
    ]);
  });

  it("resumes an earlier conversation by its session ID", () => {
    expect(
      conversation.buildInvocation({ ...conversationInput, resume: "s-1" })
        .args,
    ).toEqual(expect.arrayContaining(["--resume", "s-1"]));
  });

  it("sends a turn as one user message and an interrupt as a control request", () => {
    const codec = conversation.createCodec(conversationInput);
    expect(codec.open()).toEqual([]);
    const [turn] = codec.sendTurn("Explain this.");
    expect(JSON.parse(turn!)).toMatchObject({
      type: "user",
      message: { role: "user", content: "Explain this." },
    });
    const [interrupt] = codec.interrupt();
    expect(JSON.parse(interrupt!)).toMatchObject({
      type: "control_request",
      request: { subtype: "interrupt" },
    });
  });

  it("reads the session, text deltas, tool calls and each turn's end", () => {
    expect(
      read({
        type: "system",
        subtype: "init",
        session_id: "s-1",
        mcp_servers: [{ name: "ajour", status: "connected" }],
      }).events,
    ).toEqual([{ kind: "session", id: "s-1" }]);
    expect(
      read({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hel" },
        },
      }).events,
    ).toEqual([{ kind: "text", text: "Hel" }]);
    // The complete message repeats the text it streamed.
    expect(
      read({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      }).events,
    ).toEqual([]);
    expect(
      read({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "mcp__ajour__x" }] },
      }).events,
    ).toEqual([{ kind: "tool-call" }]);
    expect(
      read({ type: "result", subtype: "success", is_error: false }).events,
    ).toEqual([{ kind: "turn-done" }]);
    expect(
      read({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Session limit reached",
      }).events,
    ).toEqual([{ kind: "turn-failed", message: "Session limit reached" }]);
    expect(
      read({
        type: "system",
        subtype: "init",
        session_id: "s-2",
        mcp_servers: [{ name: "ajour", status: "failed" }],
      }).events,
    ).toEqual([
      { kind: "session", id: "s-2" },
      { kind: "mcp-failed", server: "ajour" },
    ]);
  });

  it("ends an interrupted turn as interrupted", () => {
    const codec = conversation.createCodec(conversationInput);
    codec.sendTurn("Explain this.");
    codec.interrupt();
    expect(
      codec.read(
        line({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
        }),
      ).events,
    ).toEqual([{ kind: "turn-interrupted" }]);
    // The next turn ends on its own again.
    codec.sendTurn("And this?");
    expect(
      codec.read(line({ type: "result", subtype: "success", is_error: false }))
        .events,
    ).toEqual([{ kind: "turn-done" }]);
  });
});
