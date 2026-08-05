import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const scriptPath = require.resolve("./scripts/run-forge-command.cjs");
const childProcess = require("node:child_process") as {
  spawnSync: ReturnType<typeof vi.fn>;
};

function runScript(args: string[]) {
  const originalArgv = process.argv;
  process.argv = ["node", scriptPath, ...args];
  delete require.cache[scriptPath];

  try {
    require(scriptPath);
  } finally {
    process.argv = originalArgv;
  }
}

describe("run-forge-command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[scriptPath];
  });

  it("adds the desktop pnpm shim directory to the forge PATH", () => {
    const spawnSyncMock = vi.spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      error: undefined,
    });

    runScript(["package", "win32"]);

    const forgeInvocation = spawnSyncMock.mock.calls.at(-1);
    const options = forgeInvocation?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    const pathEntry = options?.env?.PATH?.split(path.delimiter)[0];

    expect(pathEntry).toBe(path.join(path.dirname(scriptPath), "..", "bin"));
  });
});
