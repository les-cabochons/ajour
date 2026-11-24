import { fileURLToPath } from "node:url";
import { claudeCodeAdapter } from "../agent-runner/adapters/claude-code.ts";
import { codexAdapter } from "../agent-runner/adapters/codex.ts";
import { opencodeAdapter } from "../agent-runner/adapters/opencode.ts";
import type {
  AgentCliAdapter,
  ConversationAdapter,
} from "../agent-runner/adapter.ts";

const FAKE_CLI = fileURLToPath(
  new URL("../agent-runner/fake-cli.mjs", import.meta.url),
);

/**
 * What a conversation's process runs: its steps, or its steps and the files
 * the launch writes in place of the adapter's, such as a name that can't be
 * written.
 */
export type FakeConversationScript =
  unknown[] | { steps: unknown[]; files: Record<string, string> };

export type FakeConversation = (launch: {
  index: number;
  resume?: string;
}) => FakeConversationScript;

const fakeEnv = (
  baseEnv: Record<string, string>,
  token: string,
  steps: unknown[],
  report: string,
  mcpUrl: string,
) => ({
  ...baseEnv,
  AJOUR_MCP_TOKEN: token,
  FAKE_CLI_SCRIPT: JSON.stringify(steps),
  FAKE_CLI_REPORT: report,
  FAKE_CLI_MCP_URL: mcpUrl,
});

/**
 * The real conversation adapter with the fake CLI in its CLI's place: the
 * real arguments follow the fake's path, so a test can read `--resume`, and
 * the real codec reads its output.
 */
function fakeConversation(
  real: ConversationAdapter,
  report: string,
  mcpUrl: () => string,
  conversation: FakeConversation,
): ConversationAdapter {
  let launches = 0;
  return {
    ...real,
    buildInvocation: (input) => {
      const invocation = real.buildInvocation(input);
      const script = conversation({
        index: launches++,
        ...(input.resume ? { resume: input.resume } : {}),
      });
      const steps = Array.isArray(script) ? script : script.steps;
      return {
        command: process.execPath,
        args: [FAKE_CLI, ...invocation.args],
        env: fakeEnv(input.baseEnv, input.token, steps, report, mcpUrl()),
        files: Array.isArray(script) ? invocation.files : script.files,
      };
    },
  };
}

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
  conversation: FakeConversation = () => [],
): AgentCliAdapter {
  return {
    ...claudeCodeAdapter,
    buildInvocation: (input) => ({
      command: process.execPath,
      args: [FAKE_CLI],
      env: fakeEnv(input.baseEnv, input.token, script, report, mcpUrl()),
      files: { "prompt.md": input.prompt },
    }),
    conversation: fakeConversation(
      claudeCodeAdapter.conversation,
      report,
      mcpUrl,
      conversation,
    ),
  };
}

/**
 * Codex, played by the fake CLI, for a pull request's conversation: one
 * process per turn, which reads the turn on stdin and speaks `exec --json`.
 * The runner looks it up as `codex`.
 */
export function fakeCodexAdapter(
  report: string,
  mcpUrl: () => string,
  conversation: FakeConversation,
): AgentCliAdapter {
  return {
    ...codexAdapter,
    conversation: fakeConversation(
      codexAdapter.conversation,
      report,
      mcpUrl,
      conversation,
    ),
  };
}

/**
 * OpenCode, played by the fake CLI, for a pull request's conversation: one
 * warm `acp` process that speaks the Agent Client Protocol. The runner
 * looks it up as `opencode`.
 */
export function fakeOpencodeAdapter(
  report: string,
  mcpUrl: () => string,
  conversation: FakeConversation,
): AgentCliAdapter {
  return {
    ...opencodeAdapter,
    conversation: fakeConversation(
      opencodeAdapter.conversation,
      report,
      mcpUrl,
      conversation,
    ),
  };
}
