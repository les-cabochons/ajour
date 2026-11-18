import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexAdapter } from "./codex.ts";

const TOKEN = "ajour_secret-token-value";
const input = {
  executable: "/usr/local/bin/codex",
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

describe("Codex adapter", () => {
  it("keeps login while isolating config, skills, instruction files and shell tools", () => {
    const { args, env, files } = codexAdapter.buildInvocation(input);
    expect(args).toEqual(
      expect.arrayContaining([
        "--no-daemon",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--ask-for-approval",
        "never",
        "--sandbox",
        "read-only",
        "--json",
        "project_doc_max_bytes=0",
        "skills.include_instructions=false",
        "skills.bundled.enabled=false",
        "features.skip_host_skill_discovery=true",
        "features.shell_tool=false",
        "features.unified_exec=false",
        "features.plugins=false",
        "features.apps=false",
        "features.hooks=false",
        `model_instructions_file=${JSON.stringify(path.join(input.workDirectory, "prompt.md"))}`,
      ]),
    );
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(env.HOME).toBe(input.baseEnv.HOME);
    expect(env).not.toHaveProperty("CODEX_HOME");
    expect(files).toEqual({ "prompt.md": input.prompt });
  });

  it("configures only the two required servers without putting the token in files or arguments", () => {
    const { args, env, files } = codexAdapter.buildInvocation(input);
    expect(args.join(" ")).not.toContain(TOKEN);
    expect(JSON.stringify(files)).not.toContain(TOKEN);
    expect(env.AJOUR_MCP_TOKEN).toBe(TOKEN);
    expect(args).toEqual(
      expect.arrayContaining([
        'mcp_servers.ajour.url="http://127.0.0.1:8787/mcp/ajour"',
        'mcp_servers.ajour.bearer_token_env_var="AJOUR_MCP_TOKEN"',
        "mcp_servers.ajour.required=true",
        'mcp_servers.ajour.default_tools_approval_mode="approve"',
        "mcp_servers.playwright.required=true",
        'mcp_servers.playwright.default_tools_approval_mode="approve"',
        'mcp_servers.playwright.command="/Ajour app/MacOS/Ajour"',
        `mcp_servers.playwright.args=${JSON.stringify(input.playwright.args)}`,
        'mcp_servers.playwright.env.ELECTRON_RUN_AS_NODE="1"',
      ]),
    );
  });

  it("passes a model only when one is set and reads the installed version", () => {
    expect(codexAdapter.buildInvocation(input).args).not.toContain("--model");
    expect(
      codexAdapter.buildInvocation({ ...input, model: "a-model" }).args,
    ).toEqual(expect.arrayContaining(["--model", "a-model"]));
    expect(codexAdapter.parseVersion("codex-cli 0.161.0\n")).toBe("0.161.0");
  });

  it("reads MCP calls, final messages and provider errors", () => {
    const parse = (event: unknown) =>
      codexAdapter.parseEvent(JSON.stringify(event));
    expect(
      parse({ type: "item.started", item: { type: "mcp_tool_call" } }),
    ).toEqual({ kind: "tool-call" });
    expect(
      parse({ type: "item.completed", item: { type: "mcp_tool_call" } }),
    ).toBeNull();
    expect(
      parse({
        type: "item.completed",
        item: { type: "agent_message", text: "Week checked." },
      }),
    ).toEqual({ kind: "finished", summary: "Week checked." });
    expect(
      parse({
        type: "turn.failed",
        error: { message: "Usage limit reached." },
      }),
    ).toEqual({ kind: "failed", message: "Usage limit reached." });
    expect(parse({ type: "turn.failed" })).toEqual({
      kind: "failed",
      message: "Codex could not complete the task.",
    });
    // Warnings and intermediate stream errors must not turn a recovered run into a failure.
    expect(
      parse({
        type: "item.completed",
        item: { type: "error", message: "Experimental feature warning" },
      }),
    ).toBeNull();
    expect(parse({ type: "error", message: "Reconnecting..." })).toBeNull();
    expect(codexAdapter.parseEvent("not json")).toBeNull();
  });
});

describe("Codex conversation", () => {
  const conversation = codexAdapter.conversation!;
  const conversationInput = {
    executable: "/usr/local/bin/codex",
    workDirectory: "/tmp/conversation 1",
    prompt: "Review pull request pr-1.",
    ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
    model: "",
    baseEnv: { PATH: "/usr/bin" },
    token: TOKEN,
  };
  const config = (args: string[]) =>
    args.flatMap((arg, index) => (args[index - 1] === "--config" ? [arg] : []));

  it("runs one isolated process per turn, with only Ajour's server and the turn on stdin", () => {
    expect(conversation.mode).toBe("per-turn");
    const { args, env, files } =
      conversation.buildInvocation(conversationInput);
    expect(args).toEqual(
      expect.arrayContaining([
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--json",
      ]),
    );
    // Persisted, so a later turn can resume it.
    expect(args).not.toContain("--ephemeral");
    expect(args.at(-1)).toBe("-");
    expect(config(args)).toEqual(
      expect.arrayContaining([
        'sandbox_mode="read-only"',
        'mcp_servers.ajour.bearer_token_env_var="AJOUR_MCP_TOKEN"',
        "features.shell_tool=false",
        `model_instructions_file=${JSON.stringify(
          path.join(conversationInput.workDirectory, "prompt.md"),
        )}`,
      ]),
    );
    expect(config(args).some((item) => item.includes("playwright"))).toBe(
      false,
    );
    expect(args.join(" ")).not.toContain(TOKEN);
    expect(env.AJOUR_MCP_TOKEN).toBe(TOKEN);
    expect(files["prompt.md"]).toBe("Review pull request pr-1.");
  });

  it("resumes the thread by its ID", () => {
    const { args } = conversation.buildInvocation({
      ...conversationInput,
      resume: "019a-thread",
    });
    const resume = args.indexOf("resume");
    expect(args[resume - 1]).toBe("exec");
    expect(args.slice(-2)).toEqual(["019a-thread", "-"]);
  });

  it("sends the turn as stdin text and has no interrupt but ending the process", () => {
    const codec = conversation.createCodec(conversationInput);
    expect(codec.open()).toEqual([]);
    expect(codec.sendTurn("Explain this.")).toEqual(["Explain this."]);
    expect(codec.interrupt()).toEqual([]);
  });

  it("reads the thread, its messages, tool calls and the turn's end", () => {
    const codec = conversation.createCodec(conversationInput);
    const read = (value: unknown) => codec.read(JSON.stringify(value)).events;
    expect(read({ type: "thread.started", thread_id: "019a-thread" })).toEqual([
      { kind: "session", id: "019a-thread" },
    ]);
    expect(
      read({
        type: "item.started",
        item: { id: "i0", type: "mcp_tool_call" },
      }),
    ).toEqual([{ kind: "tool-call" }]);
    expect(
      read({
        type: "item.completed",
        item: { id: "i1", type: "agent_message", text: "First." },
      }),
    ).toEqual([{ kind: "text", text: "First." }]);
    // A later message in the same turn starts a new paragraph.
    expect(
      read({
        type: "item.completed",
        item: { id: "i2", type: "agent_message", text: "Second." },
      }),
    ).toEqual([{ kind: "text", text: "\n\nSecond." }]);
    expect(read({ type: "turn.completed" })).toEqual([{ kind: "turn-done" }]);
    expect(
      read({ type: "turn.failed", error: { message: "Usage limit" } }),
    ).toEqual([{ kind: "turn-failed", message: "Usage limit" }]);
  });

  it("streams a message that grows, sending only what is new", () => {
    const codec = conversation.createCodec(conversationInput);
    const read = (value: unknown) => codec.read(JSON.stringify(value)).events;
    expect(
      read({
        type: "item.updated",
        item: { id: "i1", type: "agent_message", text: "Hel" },
      }),
    ).toEqual([{ kind: "text", text: "Hel" }]);
    expect(
      read({
        type: "item.completed",
        item: { id: "i1", type: "agent_message", text: "Hello" },
      }),
    ).toEqual([{ kind: "text", text: "lo" }]);
  });
});
