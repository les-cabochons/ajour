import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultReadVersion,
  findExecutable,
  readLoginShellPath,
  resolveLoginShellPath,
} from "./cli-path.ts";

import { npmShim } from "./test-support/npm-shim.ts";

// Records every shell start; each one still runs the real execFile.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

/** Each test's folders, removed after it whether it passed or failed. */
const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  // On Windows a process that just exited can hold a handle in its folder
  // for a moment, so the removal retries.
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      }),
    ),
  );
});

describe("findExecutable", () => {
  it("Given relative PATH entries, skips them and finds the absolute installation", async () => {
    const bin = await tempDir("ajour-path-");
    const executable = path.join(
      bin,
      process.platform === "win32" ? "claude.exe" : "claude",
    );
    await writeFile(executable, "");
    await chmod(executable, 0o755);
    const relative = path.relative(process.cwd(), bin);
    expect(await findExecutable("claude", relative)).toBeNull();
    expect(
      await findExecutable(
        "claude",
        [relative, bin].join(path.delimiter),
        process.platform,
      ),
    ).toBe(executable);
  });
  // Root-relative Windows paths depend on the current drive; POSIX has no such paths.
  it.skipIf(process.platform !== "win32")(
    "Given a root-relative Windows PATH entry, skips the installation",
    async () => {
      const bin = await tempDir("ajour-path-");
      await writeFile(path.join(bin, "claude.exe"), "");
      expect(await findExecutable("claude", bin.slice(2))).toBeNull();
    },
  );
  it("finds an executable on PATH and skips folders without it", async () => {
    const empty = await tempDir("ajour-path-");
    const bin = await tempDir("ajour-path-");
    await writeFile(path.join(bin, "claude"), "#!/bin/sh\n");
    await chmod(path.join(bin, "claude"), 0o755);
    expect(
      await findExecutable(
        "claude",
        [empty, bin].join(path.delimiter),
        "darwin",
      ),
    ).toBe(path.join(bin, "claude"));
    expect(await findExecutable("codex", bin, "darwin")).toBeNull();
  });
});

/** A fake shell that prints a banner, then runs the command it is given like `sh -ilc <cmd>`. */
async function fakeShell(body: string): Promise<string> {
  const directory = await tempDir("ajour-shell-");
  const shell = path.join(directory, "fake-shell");
  await writeFile(shell, `#!/bin/sh\n${body}\n`);
  await chmod(shell, 0o755);
  return shell;
}

describe("resolveLoginShellPath", () => {
  it.runIf(process.platform === "win32")(
    "keeps the process PATH on Windows without starting a shell",
    async () => {
      vi.mocked(execFile).mockClear();
      expect(await resolveLoginShellPath()).toBe(process.env.PATH ?? "");
      expect(execFile).not.toHaveBeenCalled();
    },
  );
});

// The fake shells are `#!/bin/sh` scripts, and Ajour reads a login shell's
// PATH only on macOS and Linux; Windows keeps the process PATH.
describe.skipIf(process.platform === "win32")("readLoginShellPath", () => {
  it("ignores output an rc file prints around the PATH", async () => {
    const shell = await fakeShell(
      'echo "Welcome banner"\nexport PATH=/custom/bin:/usr/bin\n/bin/sh -c "$2"\necho "trailing notice"',
    );
    expect(
      await readLoginShellPath({ shell, fallback: "/short", timeoutMs: 5000 }),
    ).toEqual({ path: "/custom/bin:/usr/bin", fromShell: true });
  });

  it("falls back when the shell prints no markers", async () => {
    const shell = await fakeShell('echo "Welcome banner"');
    expect(
      await readLoginShellPath({ shell, fallback: "/short", timeoutMs: 5000 }),
    ).toEqual({ path: "/short", fromShell: false });
  });

  it("falls back when the shell fails or does not exist", async () => {
    const failing = await fakeShell("exit 1");
    expect(
      await readLoginShellPath({
        shell: failing,
        fallback: "/short",
        timeoutMs: 5000,
      }),
    ).toEqual({ path: "/short", fromShell: false });
    expect(
      await readLoginShellPath({
        shell: "/nonexistent/shell",
        fallback: "/short",
        timeoutMs: 5000,
      }),
    ).toEqual({ path: "/short", fromShell: false });
  });

  it("falls back when the shell is too slow", async () => {
    const shell = await fakeShell("sleep 5");
    expect(
      await readLoginShellPath({ shell, fallback: "/short", timeoutMs: 100 }),
    ).toEqual({ path: "/short", fromShell: false });
  });
});

// Windows shim probes require Windows path and process semantics.
describe.skipIf(process.platform !== "win32")("Windows CLI version", () => {
  it.each(["claude", "codex", "opencode"])(
    "detects %s through an npm shim and reads its version",
    async (name) => {
      const bin = await tempDir("ajour npm & �-");
      await writeFile(path.join(bin, "version.mjs"), 'console.log("1.2.3");');
      await writeFile(
        path.join(bin, `${name}.cmd`),
        npmShim("%dp0%\\version.mjs"),
      );
      const executable = await findExecutable(name, bin);
      expect(executable).toBe(path.join(bin, `${name}.cmd`));
      expect(
        await defaultReadVersion(executable!, process.env.PATH ?? ""),
      ).toBe("1.2.3\n");
    },
  );

  it("refuses an unknown shim without executing it", async () => {
    const bin = await tempDir("ajour unknown-");
    const shim = path.join(bin, "claude.cmd");
    await writeFile(shim, "@echo SHOULD_NOT_RUN");
    expect(await defaultReadVersion(shim, process.env.PATH ?? "")).toEqual({
      refused: "unknown_shim",
    });
  });
});
