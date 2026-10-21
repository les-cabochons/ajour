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
