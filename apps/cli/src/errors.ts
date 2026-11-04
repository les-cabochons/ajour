/**
 * Every way a command can fail, with the exit code a script branches on.
 * The manual's EXIT STATUS section lists the same codes.
 */
export const EXIT = {
  ok: 0,
  refused: 1,
  usage: 2,
  unreachable: 3,
  reference: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CliError extends Error {
  readonly exitCode: ExitCode;
  /** The word before the message on stderr, such as "error" or "refused". */
  readonly label: string;

  constructor(message: string, exitCode: ExitCode, label: string) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.label = label;
  }
}

/** Ajour refused the action, with the app's own reason. */
export class RefusedError extends CliError {
  constructor(message: string) {
    super(message, EXIT.refused, "refused");
  }
}

/** A bad command, flag or value. */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT.usage, "usage");
  }
}

/** Ajour is not running, MCP is off, or the token no longer works. */
export class UnreachableError extends CliError {
  constructor(message: string) {
    super(message, EXIT.unreachable, "error");
  }
}
