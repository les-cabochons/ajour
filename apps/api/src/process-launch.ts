import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findExecutable } from "./agent-runner/cli-path.ts";
import { resolveSpawn, type SpawnResolution } from "./process-spawn/index.ts";
import { endProcessGroup, endProcessTree } from "./process-tree.ts";

export class ProcessLaunchRefused extends Error {
  readonly reason:
    "invalid_request" | "spawn_refused" | "stdin_failed" | "operation_ended";
  constructor(
    message: string,
    reason: ProcessLaunchRefused["reason"] = "spawn_refused",
  ) {
    super(message);
    this.reason = reason;
  }
}
/** The terminal apps a terminal command can open in: Windows, then macOS. */
export type TerminalApp =
  "wt" | "WezTerm" | "Alacritty" | "Terminal" | "iTerm" | "Ghostty" | "kitty";
/**
 * The terminal app chosen in Settings › General › Terminal, as main found it
 * on this computer: the app bundle on macOS, the executable on Windows.
 * Without a path, Terminal opens by name and Windows Terminal is looked up
 * on PATH.
 */
export interface TerminalChoice {
  app: TerminalApp;
  path?: string;
}
// macOS apps that run a `.command` script `open -a` hands them.
const SCRIPT_TERMINALS: readonly TerminalApp[] = [
  "Terminal",
  "iTerm",
  "Ghostty",
];
/**
 * macOS apps that run the script as a program instead, in a new instance:
 * `open -n -a <app> --args <these> <script>`. Through `open -a` kitty asks to
 * confirm every script, WezTerm runs one only while it already runs, and
 * Alacritty declares no document types.
 */
const PROGRAM_TERMINALS: Partial<Record<TerminalApp, readonly string[]>> = {
  kitty: [],
  WezTerm: ["start", "--"],
  Alacritty: ["-e"],
};
type Plan = Exclude<SpawnResolution, { refused: string }>;
/**
 * How long a child has to read its input. Shorter than an operation's
 * deadline, so a child that never reads is refused with `stdin_failed`
 * rather than run the operation into a timeout, which counts toward
 * suspending the plugin.
 */
export const stdinDeliveryDeadlineMs = 10_000;
/** Text for the child's stdin, and the signal that abandons its delivery. */
export interface UnownedInput {
  stdin: string;
  signal?: AbortSignal;
  /** Overrides {@link stdinDeliveryDeadlineMs}. */
  deadlineMs?: number;
}
const stdinChunk = 64 * 1024;
/**
 * Starts a process Ajour doesn't own. Given input, only stdin is piped: the
 * text is written with backpressure and stdin ended before the child is let
 * go. Delivery ends once the child has read the input (on Windows, all of
 * it). Until then Ajour owns it, so a failed, late or abandoned delivery
 * stops it and everything it started rather than leave it running on part
 * of its input.
 */
export async function startUnowned(
  plan: Plan,
  cwd: string,
  windowsHide: boolean,
  input?: UnownedInput,
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      env: plan.env,
      cwd,
      shell: false,
      stdio: input ? ["pipe", "ignore", "ignore"] : "ignore",
      detached: true,
      windowsHide,
    });
    child.once("error", reject);
    if (!input) {
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      return;
    }
    const stdin = child.stdin!;
    let settled = false;
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: ProcessLaunchRefused) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      input.signal?.removeEventListener("abort", abort);
      stdin.destroy();
      // A launcher that exited can leave a descendant holding its stdin.
      if (exited) endProcessGroup(child);
      else endProcessTree(child, plan.env, () => exited);
      reject(error);
    };
    const abort = () =>
      fail(
        new ProcessLaunchRefused(
          "The operation ended before the input was delivered.",
          "operation_ended",
        ),
      );
    // EPIPE when the child exits before reading everything.
    stdin.on("error", () =>
      fail(
        new ProcessLaunchRefused(
          "The process stopped reading its input.",
          "stdin_failed",
        ),
      ),
    );
    child.once("spawn", () => {
      void (async () => {
        if (input.signal?.aborted) return abort();
        input.signal?.addEventListener("abort", abort, { once: true });
        deadline = setTimeout(
          () =>
            fail(
              new ProcessLaunchRefused(
                "The process didn't read its input in time.",
                "stdin_failed",
              ),
            ),
          input.deadlineMs ?? stdinDeliveryDeadlineMs,
        );
        const data = Buffer.from(input.stdin, "utf8");
        for (let at = 0; at < data.length && !settled; at += stdinChunk) {
          if (!stdin.write(data.subarray(at, at + stdinChunk)))
            await new Promise<void>((next) => {
              const done = () => {
                stdin.off("drain", done);
                stdin.off("close", done);
                next();
              };
              stdin.once("drain", done);
              stdin.once("close", done);
            });
        }
        if (settled) return;
        stdin.end((error?: Error | null) => {
          if (error)
            return fail(
              new ProcessLaunchRefused(
                "The process stopped reading its input.",
                "stdin_failed",
              ),
            );
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          input.signal?.removeEventListener("abort", abort);
          child.unref();
          resolve();
        });
      })();
    });
  });
}
interface LaunchPorts {
  literalArgIndices?: readonly number[];
  platform?: NodeJS.Platform;
  temp?: string;
  find?: (name: string, userPath: string) => Promise<string | null | undefined>;
  start?: typeof startUnowned;
  later?: (cleanup: () => Promise<void>, delayMs: number) => void;
}
export async function launchProcess(
  plan: Plan,
  cwd: string,
  terminal?: TerminalChoice,
  ports: LaunchPorts = {},
) {
  const platform = ports.platform ?? process.platform;
  const start = ports.start ?? startUnowned;
  if (!terminal) return start(plan, cwd, true);
  if (platform === "win32") {
    if (
      terminal.app !== "wt" &&
      !(
        (terminal.app === "WezTerm" || terminal.app === "Alacritty") &&
        terminal.path
      )
    )
      throw new ProcessLaunchRefused("Unsupported terminal");
    const check = (value: string, literal = false) => {
      if (
        !/^[A-Za-z0-9 ._:\\/@+=,~()\-]+$/.test(value) ||
        value.endsWith("\\") ||
        (!literal && value.startsWith("-"))
      )
        throw new ProcessLaunchRefused(
          "Value cannot be passed safely in terminal mode",
          "invalid_request",
        );
    };
    check(cwd);
    check(plan.command);
    plan.args.forEach((value, index) =>
      check(value, ports.literalArgIndices?.includes(index)),
    );
    const command = [plan.command, ...plan.args];
    let launch: SpawnResolution;
    if (terminal.app === "wt") {
      const wt = await (ports.find ?? findExecutable)(
        "wt.exe",
        plan.env.PATH ?? "",
      );
      if (!wt)
        throw new ProcessLaunchRefused(
          "Install Windows Terminal to open commands in a terminal",
        );
      check(wt);
      launch = resolveSpawn(wt, ["-d", cwd, "--", ...command], plan.env);
    } else {
      // Main found it where the user installed it. These re-join argv like
      // Windows Terminal, so their path takes the same allowlist.
      const exe = terminal.path!;
      check(exe);
      launch = resolveSpawn(
        exe,
        terminal.app === "WezTerm"
          ? ["start", "--cwd", cwd, "--", ...command]
          : // Alacritty joins what follows -e with plain spaces, unquoted, and
            // Windows splits that line again. The allowlist leaves no quote
            // and no trailing backslash, so quoting a value with a space
            // keeps it one argument.
            [
              "--working-directory",
              cwd,
              "-e",
              ...command.map((value) =>
                value.includes(" ") ? `"${value}"` : value,
              ),
            ],
        plan.env,
      );
    }
    if ("refused" in launch)
      throw new ProcessLaunchRefused("Terminal spawn refused");
    return start(launch, cwd, false);
  }
  const program = terminal.path ? PROGRAM_TERMINALS[terminal.app] : undefined;
  if (
    platform !== "darwin" ||
    (!SCRIPT_TERMINALS.includes(terminal.app) && !program)
  )
    throw new ProcessLaunchRefused("Unsupported terminal");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  // Terminal may already be running. Forward only launcher changes, not inherited secrets.
  const exports = Object.entries(plan.env)
    .flatMap(([name, value]) => {
      if (value === undefined || value === process.env[name]) return [];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes("\0"))
        throw new ProcessLaunchRefused(
          "Environment cannot be passed safely in terminal mode",
          "invalid_request",
        );
      return [`export ${name}=${quote(value)}\n`];
    })
    .join("");
  const root = ports.temp ?? os.tmpdir();
  // Ajour may have quit before the five-minute timer ran. Only sweep our old directories.
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("ajour-terminal-"))
      continue;
    const candidate = path.join(root, entry.name);
    try {
      if (Date.now() - (await stat(candidate)).mtimeMs > 3_600_000)
        await rm(candidate, { recursive: true, force: true });
    } catch {
      /* Another launch may have already cleaned it. */
    }
  }
  const directory = await mkdtemp(
    path.join(ports.temp ?? os.tmpdir(), "ajour-terminal-"),
  );
  const script = path.join(directory, "launch.command");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = async () => {
    clearTimeout(timer);
    await rm(directory, { recursive: true, force: true });
  };

  try {
    await writeFile(
      script,
      `#!/bin/sh\nfor v in $(env | sed -n 's/^\\(AJOUR_[A-Za-z0-9_]*\\)=.*/\\1/p'); do unset "$v"; done\n${exports}cd ${quote(cwd)} || exit 1\nexec ${[plan.command, ...plan.args].map(quote).join(" ")}\n`,
      { mode: 0o700, flag: "wx" },
    );
    // The app gets only the script's path: every value stays in the script.
    await start(
      {
        command: "/usr/bin/open",
        args: program
          ? ["-n", "-a", terminal.path!, "--args", ...program, script]
          : ["-a", terminal.path ?? terminal.app, script],
        env: plan.env,
      },
      cwd,
      true,
    );
  } catch (error) {
    await cleanup();
    throw error;
  }
  if (ports.later) ports.later(cleanup, 300_000);
  else
    timer = setTimeout(() => {
      void cleanup().catch(() => undefined);
    }, 300_000).unref();
}
