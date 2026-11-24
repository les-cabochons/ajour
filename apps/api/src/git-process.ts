import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { resolveSpawn, type SpawnResolution } from "./process-spawn/index.ts";
import { endProcessTree } from "./process-tree.ts";

/*
 * Git, as the local API runs it itself (ADR 0022, ADR 0023): an argument
 * list and no shell, a deadline on every call, and output capped. Hand-off
 * worktrees and Deck's local clones both run git through here. A clone in a
 * WSL distribution runs git there, through `wsl.exe --exec`.
 */

/** Git's output kept per call. A call that writes more fails. */
const MAX_OUTPUT_BYTES = 1024 * 1024;
/**
 * How long a call waits for git's output to end once git has exited. A
 * process git started may hold that output open for as long as it runs.
 */
const OUTPUT_DRAIN_MS = 1000;

export interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** A git call that failed, with what git said, for the user's message. */
export class GitFailure extends Error {
  readonly reason: "git_failed" | "timeout";
  constructor(reason: "git_failed" | "timeout", said: string) {
    super(said);
    this.reason = reason;
  }
}

/** The last line git wrote, which says why it stopped. */
export function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

/** A ref Ajour may hand git: never one git could read as an option. */
export function checkedRef(ref: string): string {
  if (!ref || ref.startsWith("-") || /[\0\r\n]/.test(ref))
    throw new GitFailure("git_failed", "Ajour refused an unsafe git ref.");
  return ref;
}

/** Git, run in one repository folder, without a shell. */
export class Git {
  private readonly executable: string;
  private readonly env: Record<string, string | undefined>;
  private readonly cwd: string;
  constructor(
    executable: string,
    env: Record<string, string | undefined>,
    cwd: string,
  ) {
    this.executable = executable;
    this.env = env;
    this.cwd = cwd;
  }

  /** The process that runs git with `args`, or why Ajour won't start it. */
  protected plan(args: readonly string[]): SpawnResolution {
    return resolveSpawn(this.executable, args, this.env);
  }

  /** The folder the process starts in. */
  protected get startIn(): string {
    return this.cwd;
  }

  /**
   * Runs git and answers its exit code and output. Rejects when git can't
   * start, or wrote too much.
   *
   * A call never outlives its deadline, and never waits long on git's
   * output once git is gone. A process git started, such as a hook's
   * background child or a credential or fetch helper, can inherit that
   * output and keep it open after git exits. So the call settles on git's
   * exit, after at most `OUTPUT_DRAIN_MS` for what is left to read. At the
   * deadline it ends git with everything it started, lets go of the output
   * and answers `timedOut`. Otherwise the hand off would hang, and hold the
   * repository's lock over every later operation there.
   */
  run(args: readonly string[], timeoutMs: number): Promise<GitResult> {
    const plan = this.plan(args);
    if ("refused" in plan)
      return Promise.reject(
        new GitFailure("git_failed", "Ajour couldn't start git."),
      );
    return new Promise<GitResult>((resolve, reject) => {
      const child = spawn(plan.command, plan.args, {
        env: plan.env,
        cwd: this.startIn,
        shell: false,
        windowsHide: true,
        // On POSIX git leads its own session: its helpers end with it, and
        // it has no terminal to ask a password on.
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
      let size = 0;
      let exited = false;
      let settled = false;
      let timedOut = false;
      let draining: ReturnType<typeof setTimeout> | undefined;
      const stop = () => endProcessTree(child, plan.env, () => exited);
      /** Ends the call once, and stops reading: nothing waits on a stream after. */
      const settle = (answer: GitFailure | { code: number | null }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(draining);
        child.stdout.destroy();
        child.stderr.destroy();
        if (answer instanceof GitFailure) reject(answer);
        else
          resolve({
            code: answer.code,
            stdout: Buffer.concat(chunks.stdout).toString("utf8"),
            stderr: Buffer.concat(chunks.stderr).toString("utf8"),
            timedOut,
          });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
        settle({ code: null });
      }, timeoutMs);
      for (const stream of ["stdout", "stderr"] as const)
        child[stream].on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_OUTPUT_BYTES) {
            stop();
            settle(new GitFailure("git_failed", "Git wrote too much output."));
          } else chunks[stream].push(chunk);
        });
      child.once("error", () =>
        settle(new GitFailure("git_failed", "Ajour couldn't start git.")),
      );
      child.once("exit", (code) => {
        exited = true;
        // Git is gone. Its output closes at once unless something it
        // started still holds it: that gets a moment, and no more.
        draining = setTimeout(() => settle({ code }), OUTPUT_DRAIN_MS);
      });
      // The usual end: git exited and its output is read to the end.
      child.once("close", (code) => settle({ code }));
    });
  }

  /** The trimmed output of a call that must succeed. */
  async read(args: readonly string[], timeoutMs: number): Promise<string> {
    const result = await this.run(args, timeoutMs);
    if (result.timedOut)
      throw new GitFailure("timeout", "Git took too long to answer.");
    if (result.code !== 0)
      throw new GitFailure(
        "git_failed",
        lastLine(result.stderr) || "Git failed without saying why.",
      );
    return result.stdout.trim();
  }

  /** Whether a call that answers by its exit code said yes (0) or no (1). */
  async test(args: readonly string[], timeoutMs: number): Promise<boolean> {
    const result = await this.run(args, timeoutMs);
    if (result.timedOut)
      throw new GitFailure("timeout", "Git took too long to answer.");
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw new GitFailure(
      "git_failed",
      lastLine(result.stderr) || "Git failed without saying why.",
    );
  }
}

/** Where Windows keeps `wsl.exe`. */
export function wslExecutable(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return path.win32.join(
    env.SystemRoot || String.raw`C:\Windows`,
    "System32",
    "wsl.exe",
  );
}

/** A WSL distribution's name, as `wsl.exe --list` shows it. */
export const WSL_DISTRO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Git in a WSL distribution, run through `wsl.exe --exec`, each value its
 * own argument. `cwd` is the Linux folder git runs in, given with `-C`.
 * Windows environment variables don't reach the distribution, so git's
 * settings go through `env` on the Linux side: the same as `gitEnvironment`
 * sets for Windows git, and no prompt.
 */
export class WslGit extends Git {
  private readonly distro: string;
  private readonly linuxCwd: string;
  private readonly windowsEnv: Record<string, string | undefined>;

  constructor(
    distro: string,
    linuxCwd: string,
    windowsEnv: Record<string, string | undefined> = process.env,
  ) {
    super(wslExecutable(windowsEnv), windowsEnv, os.tmpdir());
    if (!WSL_DISTRO_NAME.test(distro)) {
      throw new GitFailure(
        "git_failed",
        "Ajour refused a WSL distribution name.",
      );
    }
    this.distro = distro;
    this.linuxCwd = linuxCwd;
    this.windowsEnv = windowsEnv;
  }

  protected override plan(args: readonly string[]): SpawnResolution {
    if (
      [this.linuxCwd, ...args].some((arg) =>
        arg.includes(String.fromCharCode(0)),
      )
    ) {
      return { refused: "nul" };
    }
    return {
      command: wslExecutable(this.windowsEnv),
      args: [
        "-d",
        this.distro,
        "--exec",
        "env",
        "GIT_OPTIONAL_LOCKS=0",
        "GIT_TERMINAL_PROMPT=0",
        "GCM_INTERACTIVE=never",
        "git",
        "-c",
        "safe.bareRepository=explicit",
        "-C",
        this.linuxCwd,
        ...args,
      ],
      env: { ...this.windowsEnv, WSL_UTF8: "1" },
    };
  }
}
