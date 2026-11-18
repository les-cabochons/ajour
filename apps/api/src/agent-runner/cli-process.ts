import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveSpawn, spawnRefusalMessage } from "../process-spawn/index.ts";
import type { AdapterInvocation } from "./adapter.ts";
import { AgentRunError } from "./launch.ts";

/**
 * One agent CLI process, as a plugin task's run and a pull request's
 * conversation both start it: the spawn, the last lines of its error output,
 * and an ending that comes even when the process never closes.
 *
 * A process can exit and still never close, since something it started can
 * hold its output open (#341). On Windows, `codex.cmd` starts `node`, which
 * starts `codex.exe` with the same pipes: ending `node` leaves them open. So
 * `finished` resolves when the process closes, or a grace period after it
 * exited or was terminated, whichever comes first.
 */

/** How long a CLI gets to exit after SIGTERM before it is killed. */
export const DEFAULT_KILL_GRACE_MS = 5000;
/** How many of the CLI's last error lines it keeps, for a failure message. */
const ERROR_LINES = 20;

export interface CliProcessOptions {
  invocation: Pick<AdapterInvocation, "command" | "args" | "env">;
  /** The CLI's name for a refusal, such as "Claude Code". */
  label: string;
  cwd: string;
  /** `pipe` keeps stdin open for the CLI's protocol. */
  stdin: "pipe" | "ignore";
  /** Time between SIGTERM and SIGKILL, and from an exit to giving up on the close. */
  killGraceMs?: number;
  /** Each stdout line, until the process finished. */
  onLine: (line: string) => void;
  /** Each stderr line, until the process finished. */
  onErrorLine?: (line: string) => void;
}

export interface CliProcessEnding {
  /** The close's exit code, or the exit's when the close never came. */
  code: number | null;
}

export interface CliProcess {
  readonly child: ChildProcess;
  /** The last lines of its error output, and the spawn error if any. */
  readonly errorLines: readonly string[];
  /** Set when the process exits. Its output can stay open longer. */
  readonly exited: { code: number | null } | undefined;
  /** Set when the process emitted an error, such as a failed spawn. */
  readonly error: Error | undefined;
  /** True when it never started: Node gives no pid to such a process. */
  readonly neverStarted: boolean;
  /** Resolves once, when the process closed or its grace period ran out. */
  readonly finished: Promise<CliProcessEnding>;
  /** Writes lines to its stdin, when it is still open. */
  write(lines: readonly string[]): void;
  /** Ends its stdin. */
  endInput(): void;
  /**
   * Ends stdin, then SIGTERM, then SIGKILL after the grace period. Only the
   * CLI itself: ending what it started is #341. `finished` comes a second
   * after that period at the latest.
   */
  terminate(): void;
}

/**
 * Starts the CLI. Throws an `AgentRunError` when Ajour refuses to spawn the
 * command; a spawn that fails later reaches `error` and `finished`.
 */
export function startCliProcess(options: CliProcessOptions): CliProcess {
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const { invocation } = options;
  const plan = resolveSpawn(
    invocation.command,
    invocation.args,
    invocation.env,
  );
  if ("refused" in plan) {
    throw new AgentRunError(
      spawnRefusalMessage(plan.refused, options.label, invocation.command),
      400,
    );
  }
  const child = spawn(plan.command, plan.args, {
    cwd: options.cwd,
    env: plan.env,
    shell: false,
    windowsHide: true,
    stdio: [options.stdin, "pipe", "pipe"],
  });

  const errorLines: string[] = [];
  let exited: { code: number | null } | undefined;
  let error: Error | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let giveUp: NodeJS.Timeout | undefined;
  let done = false;
  let resolveFinished!: (ending: CliProcessEnding) => void;
  const finished = new Promise<CliProcessEnding>((resolve) => {
    resolveFinished = resolve;
  });
  const finish = (code: number | null) => {
    if (done) return;
    done = true;
    clearTimeout(killTimer);
    clearTimeout(giveUp);
    resolveFinished({ code });
  };
  /** The first ending sets the deadline. */
  const finishWithinGrace = () => {
    if (done || giveUp) return;
    // Not unref'd: a shutdown waits for it.
    giveUp = setTimeout(() => finish(exited?.code ?? null), killGraceMs + 1000);
  };
  const pushError = (line: string) => {
    errorLines.push(line);
    if (errorLines.length > ERROR_LINES) errorLines.shift();
  };

  // A process that is gone can't take a write.
  child.stdin?.on("error", () => undefined);
  createInterface({ input: child.stdout! }).on("line", (line) => {
    if (!done) options.onLine(line);
  });
  createInterface({ input: child.stderr! }).on("line", (line) => {
    pushError(line);
    if (!done) options.onErrorLine?.(line);
  });
  child.on("error", (spawnError) => {
    error = spawnError;
    pushError(spawnError.message);
  });
  child.on("exit", (code) => {
    exited = { code };
    finishWithinGrace();
  });
  child.on("close", (code) => finish(code));

  const endInput = () => {
    const stdin = child.stdin;
    if (stdin && !stdin.writableEnded && !stdin.destroyed) stdin.end();
  };
  return {
    child,
    errorLines,
    get exited() {
      return exited;
    },
    get error() {
      return error;
    },
    get neverStarted() {
      return child.pid === undefined;
    },
    finished,
    write(lines) {
      const stdin = child.stdin;
      if (!stdin || stdin.writableEnded || stdin.destroyed) return;
      for (const line of lines) stdin.write(`${line}\n`);
    },
    endInput,
    terminate() {
      endInput();
      // The ending comes on time even if the CLI's exit never does.
      finishWithinGrace();
      // No pid: the CLI never started, and its error and close are on the
      // way. Killing it would throw.
      if (done || exited || child.pid === undefined) return;
      child.kill("SIGTERM");
      if (killTimer) return;
      killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
      killTimer.unref();
    },
  };
}
