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
  /** How the CLI holds a pull request's conversation. */
  conversation: ConversationAdapter;
}

/** What an adapter needs to start a conversation's process. */
export interface ConversationInput {
  executable: string;
  /** The folder the CLI runs in. The adapter may write config files here, never the token. */
  workDirectory: string;
  /** The conversation's own instructions, filled. Each turn adds its task's. */
  prompt: string;
  ajourMcpUrl: string;
  /** Empty means the CLI's default. */
  model: string;
  baseEnv: Record<string, string>;
  token: string;
  /** The provider's ID of an earlier conversation to continue. */
  resume?: string;
}

/** What the runner learns from one line of a conversation's output. */
export type ConversationEvent =
  /** The provider's ID for the conversation, which a later process resumes. */
  | { kind: "session"; id: string }
  /** The next piece of the answer. */
  | { kind: "text"; text: string }
  | { kind: "tool-call" }
  | { kind: "turn-done" }
  | { kind: "turn-interrupted" }
  | { kind: "turn-failed"; message: string }
  | { kind: "mcp-failed"; server: string }
  /** The process can't take another turn: its turn fails and it ends. */
  | { kind: "cli-failed"; message: string };

/**
 * One process's side of the CLI's conversation protocol, over stdin and
 * stdout lines. It keeps the protocol's own state, such as request IDs.
 */
export interface ConversationCodec {
  /** Lines to write as soon as the process starts. */
  open(): string[];
  /** Lines that send one turn. A codec may hold them until the CLI is ready. */
  sendTurn(text: string): string[];
  /** Lines that ask the CLI to stop the turn in progress. Empty when it can't, and the runner ends the process. */
  interrupt(): string[];
  /** What one stdout line says, and the lines to answer it with. */
  read(line: string): { events: ConversationEvent[]; reply: string[] };
  /**
   * What one stderr line says, and the lines to answer it with, for a CLI
   * that reports some failures only in its log. Absent when stderr only
   * shows the CLI is at work.
   */
  readError?(line: string): { events: ConversationEvent[]; reply: string[] };
}

/**
 * How a CLI holds a conversation. `warm` keeps one process running across
 * turns, its stdin open, and a new process resumes the conversation after
 * it ends. `per-turn` runs one process per turn, which gets the turn on
 * stdin, resumes the conversation by the provider's ID, and exits.
 */
export interface ConversationAdapter {
  mode: "warm" | "per-turn";
  buildInvocation(input: ConversationInput): AdapterInvocation;
  createCodec(input: ConversationInput): ConversationCodec;
}
