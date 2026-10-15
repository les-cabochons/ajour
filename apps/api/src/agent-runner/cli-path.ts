import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";

const PATH_MARKER = "__AJOUR_PATH__";

/**
 * An app started from the Dock gets a short PATH without ~/.local/bin or
 * Homebrew. Read the login shell's PATH once, so Ajour finds the agent CLIs
 * the user installed. Windows keeps the process PATH.
 *
 * Only a successful read is cached. A slow or failing shell falls back to
 * the process PATH for that call and is tried again on the next one.
 */
let cachedPath: Promise<string> | undefined;

export function resolveLoginShellPath(): Promise<string> {
  const fallback = process.env.PATH ?? "";
  if (process.platform === "win32") return Promise.resolve(fallback);
  if (cachedPath) return cachedPath;
  const attempt = readLoginShellPath({
    shell: process.env.SHELL || "/bin/zsh",
    fallback,
    timeoutMs: 5000,
  }).then((result) => {
    if (!result.fromShell && cachedPath === attempt) cachedPath = undefined;
    return result.path;
  });
  cachedPath = attempt;
  return attempt;
}

/**
 * Ask an interactive login shell for its PATH. The value is printed between
 * markers because an rc file may print its own output (a banner, an nvm or
 * conda notice) before or after it. `fromShell` is false when the shell
 * failed, timed out or printed no markers, and `path` is then `fallback`.
 */
export async function readLoginShellPath({
  shell,
  fallback,
  timeoutMs,
}: {
  shell: string;
  fallback: string;
  timeoutMs: number;
}): Promise<{ path: string; fromShell: boolean }> {
  return await new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`],
      { timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        const value = error ? undefined : stdout.split(PATH_MARKER)[1]?.trim();
        resolve(
          value
            ? { path: value, fromShell: true }
            : { path: fallback, fromShell: false },
        );
      },
    );
  });
}

/** The executable's full path on `pathValue`, or null. */
export async function findExecutable(
  name: string,
  pathValue: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const extensions = platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here; try the next directory.
      }
    }
  }
  return null;
}
