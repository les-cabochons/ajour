import { execFile } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  findExecutable,
  readLoginShellPath,
  resolveLoginShellPath,
} from "./cli-path.ts";

// Records every shell start; each one still runs the real execFile.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

describe("findExecutable", () => {
  it("finds an executable on PATH and skips folders without it", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "ajour-path-"));
    const bin = await mkdtemp(path.join(tmpdir(), "ajour-path-"));
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
  const directory = await mkdtemp(path.join(tmpdir(), "ajour-shell-"));
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
