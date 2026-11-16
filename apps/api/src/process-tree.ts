import { execFile, type ChildProcess } from "node:child_process";
import path from "node:path";
import { resolveSpawn } from "./process-spawn/index.ts";

/**
 * Ends a child the broker owns and everything it started: `taskkill /T /F`
 * on Windows, the child's process group on POSIX, where the broker starts
 * owned children detached so they lead one. Falls back to the child alone
 * when that fails. `exited` says whether the child already ended.
 */
export function endProcessTree(
  child: ChildProcess,
  env: Readonly<Record<string, string | undefined>>,
  exited: () => boolean,
): void {
  const killChild = () => {
    if (exited()) return;
    try {
      child.kill("SIGKILL");
    } catch {
      /* Its streams still close. */
    }
  };
  try {
    if (exited() || child.pid === undefined) return;
    if (process.platform === "win32") {
      const killer = resolveSpawn(
        path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "taskkill.exe",
        ),
        ["/pid", String(child.pid), "/T", "/F"],
        env,
      );
      if ("refused" in killer) killChild();
      else
        execFile(
          killer.command,
          killer.args,
          { env: killer.env, shell: false, windowsHide: true },
          (error) => {
            if (error && !exited()) killChild();
          },
        );
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        killChild();
      }
    }
  } catch {
    killChild();
  }
}

/**
 * Ends what is left of a detached child's process group on POSIX once the
 * child itself exited: a descendant it started may outlive it. Windows
 * keeps no group, and a tree whose root ended can't be found there.
 */
export function endProcessGroup(child: ChildProcess): void {
  if (process.platform === "win32" || child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* No process of the group is left. */
  }
}
