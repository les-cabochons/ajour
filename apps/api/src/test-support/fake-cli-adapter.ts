import { fileURLToPath } from "node:url";
import { claudeCodeAdapter } from "../agent-runner/adapters/claude-code.ts";
import type { AgentCliAdapter } from "../agent-runner/adapter.ts";

const FAKE_CLI = fileURLToPath(
  new URL("../agent-runner/fake-cli.mjs", import.meta.url),
);

/**
 * Claude Code, played by the fake CLI: it runs `script` (see fake-cli.mjs)
 * with the run's token, writes what it saw to `report`, and sends its MCP
 * requests to `mcpUrl()`. The URL is read at the run, so a test can start
 * the API on a free port first. The runner looks it up as `claude`, so the
 * API's agent PATH needs a file of that name, which never runs.
 */
export function fakeCliAdapter(
  script: unknown[],
  report: string,
  mcpUrl: () => string,
): AgentCliAdapter {
  return {
    ...claudeCodeAdapter,
    buildInvocation: (input) => ({
      command: process.execPath,
      args: [FAKE_CLI],
      env: {
        ...input.baseEnv,
        AJOUR_MCP_TOKEN: input.token,
        FAKE_CLI_SCRIPT: JSON.stringify(script),
        FAKE_CLI_REPORT: report,
        FAKE_CLI_MCP_URL: mcpUrl(),
      },
      files: { "prompt.md": input.prompt },
    }),
  };
}
