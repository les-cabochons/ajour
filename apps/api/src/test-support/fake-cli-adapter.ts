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
 *
 * A pull request's conversation runs `conversation(launch)` instead, where
 * `launch` counts its processes from 0 and `resume` is the session it
 * continues. It speaks Claude Code's stream-json, so the runner reads it
 * with the real conversation codec.
 */
export function fakeCliAdapter(
  script: unknown[],
  report: string,
  mcpUrl: () => string,
  conversation: (launch: {
    index: number;
    resume?: string;
  }) => unknown[] = () => [],
): AgentCliAdapter {
  let launches = 0;
  const env = (
    baseEnv: Record<string, string>,
    token: string,
    steps: unknown[],
  ) => ({
    ...baseEnv,
    AJOUR_MCP_TOKEN: token,
    FAKE_CLI_SCRIPT: JSON.stringify(steps),
    FAKE_CLI_REPORT: report,
    FAKE_CLI_MCP_URL: mcpUrl(),
  });
  const claudeConversation = claudeCodeAdapter.conversation!;
  return {
    ...claudeCodeAdapter,
    buildInvocation: (input) => ({
      command: process.execPath,
      args: [FAKE_CLI],
      env: env(input.baseEnv, input.token, script),
      files: { "prompt.md": input.prompt },
    }),
    conversation: {
      ...claudeConversation,
      buildInvocation: (input) => {
        const real = claudeConversation.buildInvocation(input);
        const steps = conversation({
          index: launches++,
          ...(input.resume ? { resume: input.resume } : {}),
        });
        return {
          command: process.execPath,
          // The real arguments follow, so a test can read `--resume`.
          args: [FAKE_CLI, ...real.args],
          env: env(input.baseEnv, input.token, steps),
          files: real.files,
        };
      },
    },
  };
}
