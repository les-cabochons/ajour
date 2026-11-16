import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findExecutable } from "./agent-runner/cli-path.ts";
import { resolveSpawn, type SpawnResolution } from "./process-spawn/index.ts";

const scripts = new Set<() => Promise<void>>();
export async function cleanupLaunchScripts() {
  await Promise.allSettled([...scripts].map((cleanup) => cleanup()));
}

export class ProcessLaunchRefused extends Error {}

export type TerminalApp = "wt" | "powershell" | "cmd" | "Terminal" | "iTerm";
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
    if (!["wt", "powershell", "cmd"].includes(terminal))
      throw new ProcessLaunchRefused("Unsupported terminal");
    if (terminal !== "wt") return start(plan, cwd, false);
    if ([cwd, plan.command, ...plan.args].some((value) => value.includes(";")))
      throw new ProcessLaunchRefused("Terminal tab separator refused");
    const wt = await (ports.find ?? findExecutable)(
      "wt.exe",
      plan.env.PATH ?? "",
    );
    if (!wt) throw new ProcessLaunchRefused("Windows Terminal not found");
    const launch = resolveSpawn(
      wt,
      ["-d", cwd, "--", plan.command, ...plan.args],
      plan.env,
    );
    if ("refused" in launch)
      throw new ProcessLaunchRefused("Terminal spawn refused");
    return start(launch, cwd, false);
  }
  if (platform !== "darwin" || !["Terminal", "iTerm"].includes(terminal))
    throw new ProcessLaunchRefused("Unsupported terminal");
  const directory = await mkdtemp(
    path.join(ports.temp ?? os.tmpdir(), "ajour-terminal-"),
  );
  const script = path.join(directory, "launch.command");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = async () => {
    clearTimeout(timer);
    await rm(directory, { recursive: true, force: true });
    scripts.delete(cleanup);
  };
  scripts.add(cleanup);
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
  if (ports.later) ports.later(cleanup, 60_000);
  else
    timer = setTimeout(() => {
      void cleanup().catch(() => undefined);
    }, 60_000).unref();
}
