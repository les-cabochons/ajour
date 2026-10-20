import { spawn } from "node:child_process";
import path from "node:path";

/**
 * An agent CLI starts its MCP servers, and Playwright MCP starts Chrome.
 * Ending only the CLI leaves them running after Ajour quits, and they hold
 * the CLI's output open, so the run never ends. These helpers end the whole
 * tree the CLI started, and nothing outside it: the user's own Chrome in
 * "My Chrome" mode is not a descendant, so it survives.
 */

/**
 * Spawn options that make the CLI's tree killable as one. On macOS and
 * Linux the CLI leads its own process group, and its descendants join it.
 * Windows follows parent processes instead, so it needs nothing.
 */
export const processTreeSpawnOptions: { detached?: boolean } =
  process.platform === "win32" ? {} : { detached: true };

/**
 * Ends the process and everything it started.
 * - Windows: `taskkill /T /F`, which ends the tree by parent process and has
 *   no gentle form for a console program, so SIGTERM and SIGKILL are alike.
 *   It reads the process list through WMI, which takes from a fraction of a
 *   second to several seconds depending on the machine. It runs detached:
 *   Node ends its other children when Ajour exits, and this one must finish.
 * - macOS and Linux: the signal goes to the CLI's process group.
 * A process that is already gone is not an error.
 */
export function killProcessTree(
  pid: number,
  signal: "SIGTERM" | "SIGKILL",
): void {
  if (process.platform === "win32") {
    const taskkill = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    const killer = spawn(taskkill, ["/pid", String(pid), "/T", "/F"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => undefined);
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}
