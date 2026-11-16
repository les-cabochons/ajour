import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findExecutable } from "./agent-runner/cli-path.ts";
import { resolveSpawn, type SpawnResolution } from "./process-spawn/index.ts";

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
export type TerminalApp = "wt" | "Terminal";
type Plan = Exclude<SpawnResolution, { refused: string }>;
/** Text for the child's stdin, and the signal that abandons its delivery. */
export interface UnownedInput {
  stdin: string;
  signal?: AbortSignal;
}
const stdinChunk = 64 * 1024;
/**
 * Starts a process Ajour doesn't own. Given input, only stdin is piped: the
 * text is written with backpressure and stdin ended before the child is let
 * go. Until then Ajour owns it, so a failed or abandoned delivery stops it
 * rather than leave it running on part of its input.
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
    const fail = (error: ProcessLaunchRefused) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", abort);
      stdin.destroy();
      try {
        if (process.platform !== "win32" && child.pid !== undefined)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
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
  terminal?: TerminalApp,
  ports: LaunchPorts = {},
) {
  const platform = ports.platform ?? process.platform;
  const start = ports.start ?? startUnowned;
  if (!terminal) return start(plan, cwd, true);
  if (platform === "win32") {
    if (terminal !== "wt")
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
    const wt = await (ports.find ?? findExecutable)(
      "wt.exe",
      plan.env.PATH ?? "",
    );
    if (!wt)
      throw new ProcessLaunchRefused(
        "Install Windows Terminal to open commands in a terminal",
      );
    check(wt);
    const launch = resolveSpawn(
      wt,
      ["-d", cwd, "--", plan.command, ...plan.args],
      plan.env,
    );
    if ("refused" in launch)
      throw new ProcessLaunchRefused("Terminal spawn refused");
    return start(launch, cwd, false);
  }
  if (platform !== "darwin" || terminal !== "Terminal")
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
    await start(
      {
        command: "/usr/bin/open",
        args: ["-a", terminal, script],
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
