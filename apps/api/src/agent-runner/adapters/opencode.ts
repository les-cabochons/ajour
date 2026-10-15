import path from "node:path";
import type { AgentCliAdapter, RunnerEvent } from "../adapter.ts";

/**
 * OpenCode `run` with the user's login, which lives in its data folder, but
 * with a config folder of its own: no user config, agents, plugins, skills or
 * instruction files. Every built-in tool is denied; only the two MCP servers
 * are allowed. The token reaches the config through `{env:AJOUR_MCP_TOKEN}`.
 * Tested with 1.18.35.
 */
export const opencodeAdapter: AgentCliAdapter = {
  id: "opencode",
  label: "OpenCode",
  executableName: "opencode",

  parseVersion(output) {
    return output.match(/\d+\.\d+\.\d+/)?.[0];
  },

  buildInvocation(input) {
    const config = {
      $schema: "https://opencode.ai/config.json",
      autoupdate: false,
      share: "disabled",
      agent: {
        ajour: {
          mode: "primary",
          // Read relative to this config file, so the prompt stays out of the arguments.
          prompt: "{file:./prompt.md}",
        },
      },
      // MCP tools are named <server>_<tool>.
      permission: {
        "*": "deny",
        "ajour_*": "allow",
        "playwright_*": "allow",
      },
      mcp: {
        ajour: {
          type: "remote",
          url: input.ajourMcpUrl,
          oauth: false,
          headers: { Authorization: "Bearer {env:AJOUR_MCP_TOKEN}" },
        },
        playwright: {
          type: "local",
          command: [input.playwright.command, ...input.playwright.args],
          environment: input.playwright.env,
        },
      },
    };
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
      env: {
        ...input.baseEnv,
        AJOUR_MCP_TOKEN: input.token,
        // The user's global config folder holds their agents, plugins and AGENTS.md.
        XDG_CONFIG_HOME: path.join(input.workDirectory, "config"),
        OPENCODE_CONFIG: path.join(input.workDirectory, "opencode.json"),
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_CLAUDE_CODE: "1",
        OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_SHARE: "1",
        OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
      },
      files: {
        "opencode.json": `${JSON.stringify(config, null, 2)}\n`,
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
};
