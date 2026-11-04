import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const enabled = process.env.AJOUR_SHELL_TESTS === "1";
const shells = process.env.AJOUR_TEST_SHELL
  ? [process.env.AJOUR_TEST_SHELL]
  : ["bash", "zsh", "fish"];

describe.skipIf(!enabled)(
  "real-shell completion (requires AJOUR_SHELL_TESTS=1, POSIX shells and python3)",
  () => {
    for (const shell of shells) {
      it(`${shell} inserts task names as one literal argument after Tab`, () => {
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
        expect(result.error, result.stdout + result.stderr).toBeUndefined();
        expect(result.status, result.stdout + result.stderr).toBe(0);
      }, 125_000);
    }
  },
);
