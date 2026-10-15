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
        'model_instructions_file="/tmp/run with spaces/prompt.md"',
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
        'mcp_servers.playwright.env."ELECTRON_RUN_AS_NODE"="1"',
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
