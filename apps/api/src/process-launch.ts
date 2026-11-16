import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findExecutable } from "./agent-runner/cli-path.ts";
import { resolveSpawn, type SpawnResolution } from "./process-spawn/index.ts";

export class ProcessLaunchRefused extends Error {
  readonly reason: "invalid_request" | "spawn_refused";
  constructor(
    message: string,
    reason: "invalid_request" | "spawn_refused" = "spawn_refused",
  ) {
    super(message);
    this.reason = reason;
  }
}
export type TerminalApp = "wt" | "Terminal";
type Plan = Exclude<SpawnResolution, { refused: string }>;
export async function startUnowned(
  plan: Plan,
  cwd: string,
  windowsHide: boolean,
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      env: plan.env,
      cwd,
      shell: false,
      stdio: "ignore",
      detached: true,
      windowsHide,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
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

  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  try {
    await writeFile(
      script,
      `#!/bin/sh\ncd ${quote(cwd)} || exit 1\nexec ${[plan.command, ...plan.args].map(quote).join(" ")}\n`,
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
