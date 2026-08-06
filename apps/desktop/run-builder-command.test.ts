import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const scriptPath = require.resolve("./scripts/run-builder-command.cjs");
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

describe("run-builder-command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[scriptPath];
  });

  it("builds an x64 NSIS distributable without publishing", () => {
    const spawnSyncMock = vi.spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      error: undefined,
    });

    runScript(["make", "win32"]);

    const builderInvocation = spawnSyncMock.mock.calls.at(-1);
    expect(builderInvocation?.[1]).toEqual(
      expect.arrayContaining(["--win", "--x64", "--publish=never"]),
    );

    const options = builderInvocation?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
    expect(options?.env?.PATH?.split(path.delimiter)[0]).toBe(
      path.join(path.dirname(scriptPath), "..", "bin"),
    );
  });

  it("builds both supported macOS architectures", () => {
    const spawnSyncMock = vi.spyOn(childProcess, "spawnSync").mockReturnValue({
      status: 0,
      error: undefined,
    });

    runScript(["make", "darwin"]);

    const builderInvocation = spawnSyncMock.mock.calls.at(-1);
    expect(builderInvocation?.[1]).toEqual(
      expect.arrayContaining([
        "--mac",
        "--x64",
        "--arm64",
        "--publish=never",
      ]),
    );
  });

  it("keeps root macOS commands on the Electron Builder runner", () => {
    const rootPackage = require("../../package.json") as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["package:desktop:mac"]).toContain(
      "run-builder-command.cjs package darwin",
    );
    expect(rootPackage.scripts["make:desktop:mac"]).toContain(
      "run-builder-command.cjs make darwin",
    );
    expect(JSON.stringify(rootPackage.scripts)).not.toContain(
      "run-forge-command.cjs",
    );
  });
});
