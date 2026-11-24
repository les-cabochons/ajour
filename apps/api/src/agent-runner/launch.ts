/** What a plugin task's run and a conversation's process share to start. */

export class AgentRunError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.name = "AgentRunError";
    this.status = status;
  }
}

/**
 * The version when it looks like one, such as 1.4.2 or 0.30.0-beta.1. When
 * an adapter cannot read `--version`, Settings shows the raw output, which is
 * CLI output and stays out of the log.
 */
export function versionOnly(value: string | undefined): string | undefined {
  return value !== undefined &&
    /^v?\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.]+)?$/.test(value)
    ? value
    : undefined;
}

/**
 * The environment the CLI starts from: the API's own, minus every AJOUR_
 * variable so no Ajour setting or secret reaches the agent. The adapter adds
 * AJOUR_MCP_TOKEN back, and only that one.
 */
export function childEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith("AJOUR_"),
    ),
  );
}
