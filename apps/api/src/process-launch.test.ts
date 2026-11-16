import { expect, it } from "vitest";
import { launchProcess } from "./process-launch.ts";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ports = {
  platform: "win32" as const,
  find: async () => "C:\\tools\\wt.exe",
  start: async () => undefined,
};
it.each([
  'x" --injected "y',
  "a\t--tabflag",
  "",
  "end\\ with space\\",
  "pct %USERNAME%",
  "a!",
  "a;b",
  "a^b",
  "a&b",
  "a|b",
  "a<b",
  "a>b",
  "a\n",
  "a\x7f",
  "-flag",
  "snowman\u2603",
])("Given unsafe terminal value %j, refuses before spawning", async (value) => {
  for (const field of ["arg", "command", "cwd"] as const) {
    await expect(
      launchProcess(
        {
          command: field === "command" ? value : "C:\\tools\\fake.exe",
          args: [field === "arg" ? value : "last"],
          env: {},
        },
        field === "cwd" ? value : "C:\\repo",
        "wt",
        ports,
      ),
    ).rejects.toMatchObject({
      reason: "invalid_request",
      message: expect.stringContaining("terminal mode"),
    });
  }
});
it("Given the reviewer's final safe value, permits last", async () => {
  await expect(
    launchProcess(
      { command: "C:\\tools\\fake.exe", args: ["last"], env: {} },
      "C:\\repo",
      "wt",
      ports,
    ),
  ).resolves.toBeUndefined();
});
it("Given a manifest literal flag, permits only its declared position", async () => {
  await expect(
    launchProcess(
      { command: "C:\\tools\\fake.exe", args: ["--resume", "id-1"], env: {} },
      "C:\\repo",
      "wt",
      { ...ports, literalArgIndices: [0] },
    ),
  ).resolves.toBeUndefined();
});
it("Given missing Windows Terminal, explains how to install it", async () => {
  await expect(
    launchProcess(
      { command: "C:\\tools\\fake.exe", args: [], env: {} },
      "C:\\repo",
      "wt",
      { ...ports, find: async () => null },
    ),
  ).rejects.toThrow("Install Windows Terminal to open commands in a terminal");
});
it.each(["Terminal"] as const)(
  "Given %s, writes a private quoted script and cleans it after the delay",
  async (terminal) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-launch-test-"));
    let cleanup: (() => Promise<void>) | undefined;
    try {
      let script = "";
      await launchProcess(
        { command: "/tools/fake", args: ["a'b", "$(touch bad)", ""], env: {} },
        "/repo's folder",
        terminal,
        {
          platform: "darwin",
          temp: root,
          start: async (plan) => {
            expect(plan.command).toBe("/usr/bin/open");
            expect(plan.args.slice(0, 2)).toEqual(["-a", terminal]);
            script = plan.args[2]!;
          },
          later: (callback, delayMs) => {
            expect(delayMs).toBe(300_000);
            cleanup = callback;
          },
        },
      );
      expect(await readFile(script, "utf8")).toBe(
        "#!/bin/sh\ncd '/repo'\\''s folder' || exit 1\nexec '/tools/fake' 'a'\\''b' '$(touch bad)' ''\n",
      );
      if (process.platform !== "win32")
        expect((await stat(script)).mode & 0o777).toBe(0o700);
      const { ProcessBroker } = await import("./process-broker.ts");
      await new ProcessBroker({
        folders: { resolve: async () => undefined },
        gate: async () => undefined,
      }).shutdown();
      expect(await readFile(script, "utf8")).toContain("#!/bin/sh");
      await cleanup!();
      await expect(stat(script)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("Given stale macOS scripts, sweeps only directories older than one hour", async () => {
  const { mkdir, utimes } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-launch-sweep-"));
  const old = path.join(root, "ajour-terminal-old"),
    fresh = path.join(root, "ajour-terminal-fresh"),
    unrelated = path.join(root, "other");
  let cleanup: (() => Promise<void>) | undefined;
  try {
    for (const dir of [old, fresh, unrelated]) await mkdir(dir);
    for (const dir of [old, unrelated])
      await utimes(dir, new Date(0), new Date(0));
    await launchProcess(
      { command: "/bin/tool", args: [], env: {} },
      "/repo",
      "Terminal",
      {
        platform: "darwin",
        temp: root,
        start: async () => undefined,
        later: (fn) => {
          cleanup = fn;
        },
      },
    );
    await expect(stat(old)).rejects.toThrow();
    expect(await stat(fresh)).toBeTruthy();
    expect(await stat(unrelated)).toBeTruthy();
  } finally {
    await cleanup?.();
    await rm(root, { recursive: true, force: true });
  }
});
