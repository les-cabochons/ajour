import type { AgentCliId } from "../../../../packages/shared/agent-runs.ts";

/** An MCP server the CLI starts as a child process. */
export interface StdioServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** What an adapter needs to build one run's command. */
export interface AdapterInput {
  executable: string;
  /** The folder the CLI runs in. The adapter may write config files here, never the token. */
  workDirectory: string;
  /** Runner prompt plus task prompt, filled. */
  prompt: string;
  ajourMcpUrl: string;
  playwright: StdioServerSpec;
  /** Empty means the CLI's default. */
  model: string;
  /** The process environment to start from, with the login shell's PATH. */
  baseEnv: Record<string, string>;
  token: string;
}

export interface AdapterInvocation {
  command: string;
  args: string[];
  /** Includes AJOUR_MCP_TOKEN. The token appears nowhere else. */
  env: Record<string, string>;
  /** Files to write in `workDirectory` before starting, by relative name. */
  files: Record<string, string>;
}

/** What the runner learns from one line of the CLI's JSON output. */
export type RunnerEvent =
  | { kind: "mcp-failed"; server: string }
  | { kind: "tool-call" }
  | { kind: "finished"; summary: string }
  | { kind: "failed"; message: string };

export interface AgentCliAdapter {
  id: AgentCliId;
  label: string;
  /** The executable name looked up on PATH. */
  executableName: string;
  /** The version from `<cli> --version` output, or undefined. */
  parseVersion(output: string): string | undefined;
  buildInvocation(input: AdapterInput): AdapterInvocation;
  /** Null for lines the runner does not need. */
  parseEvent(line: string): RunnerEvent | null;
}
