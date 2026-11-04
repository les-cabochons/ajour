import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

for (const shell of ["bash", "zsh", "fish"]) {
  // The PTY driver uses POSIX terminal APIs. CI requires all three shells.
  const available =
    process.platform !== "win32" &&
    spawnSync(shell, ["--version"]).status === 0 &&
    spawnSync("python3", ["--version"]).status === 0;
  it.runIf(available)(
    `${shell} inserts task names as one literal argument after Tab`,
    () => {
      const result = spawnSync(
        "python3",
        [
          fileURLToPath(
            new URL("../scripts/check-completion.py", import.meta.url),
          ),
          shell,
        ],
        { encoding: "utf8", timeout: 120_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
    125_000,
  );
}
