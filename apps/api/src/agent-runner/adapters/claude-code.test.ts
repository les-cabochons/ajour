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
        "/tmp/run-1/prompt.md",
      ]),
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
              { type: "tool_use", name: "mcp__ajour__get_submit_lines" },
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

  it("reads the version", () => {
    expect(claudeCodeAdapter.parseVersion("2.1.293 (Claude Code)\n")).toBe(
      "2.1.293",
    );
  });
});
