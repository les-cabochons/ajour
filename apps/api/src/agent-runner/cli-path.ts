import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";

/**
 * An app started from the Dock gets a short PATH without ~/.local/bin or
 * Homebrew. Read the login shell's PATH once, so Ajour finds the agent CLIs
 * the user installed. Windows keeps the process PATH.
 */
let cachedPath: Promise<string> | undefined;

export function resolveLoginShellPath(): Promise<string> {
  cachedPath ??= readLoginShellPath();
  return cachedPath;
}

async function readLoginShellPath(): Promise<string> {
  const fallback = process.env.PATH ?? "";
  if (process.platform === "win32") return fallback;
  const shell = process.env.SHELL || "/bin/zsh";
  return await new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", 'printf %s "$PATH"'],
      { timeout: 5000, encoding: "utf8" },
      (error, stdout) =>
        resolve(error || !stdout.trim() ? fallback : stdout.trim()),
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

/** Test seam: forget the cached PATH. */
export function resetLoginShellPathForTests() {
  cachedPath = undefined;
}
