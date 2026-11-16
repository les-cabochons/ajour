import { expect, it } from "vitest";
import { launchProcess, cleanupLaunchScripts } from "./process-launch.ts";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

it.each(["powershell", "cmd"] as const)(
  "Given %s, launches the resolved target directly in a new console",
  async (terminal) => {
    const calls: unknown[] = [];
    await launchProcess(
      { command: "C:\\tools\\fake.exe", args: ["a & b"], env: {} },
      "C:\\repo",
      terminal,
      {
        platform: "win32",
        start: async (...args) => {
          calls.push(args);
        },
      },
    );
    expect(calls).toEqual([
      [
        { command: "C:\\tools\\fake.exe", args: ["a & b"], env: {} },
        "C:\\repo",
        false,
      ],
    ]);
  },
);
it("Given Windows Terminal, passes argv and refuses tab separators", async () => {
  const calls: unknown[] = [];
  const ports = {
    platform: "win32" as const,
    find: async () => "C:\\tools\\wt.exe",
    start: async (...args: unknown[]) => {
      calls.push(args);
    },
  };
  await launchProcess(
    { command: "C:\\tools\\fake.exe", args: ["a & b"], env: {} },
    "C:\\repo",
    "wt",
    ports,
  );
  expect(calls).toEqual([
    [
      {
        command: "C:\\tools\\wt.exe",
        args: ["-d", "C:\\repo", "--", "C:\\tools\\fake.exe", "a & b"],
        env: {},
      },
      "C:\\repo",
      false,
    ],
  ]);
  await expect(
    launchProcess(
      { command: "C:\\fake.exe", args: ["a;b"], env: {} },
      "C:\\repo",
      "wt",
      ports,
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
it.each(["Terminal", "iTerm"] as const)(
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
            expect(delayMs).toBe(60_000);
            cleanup = callback;
          },
        },
      );
      expect(await readFile(script, "utf8")).toBe(
        "#!/bin/sh\ncd '/repo'\\''s folder' || exit 1\nexec '/tools/fake' 'a'\\''b' '$(touch bad)' ''\n",
      );
      if (process.platform !== "win32")
        expect((await stat(script)).mode & 0o777).toBe(0o700);
      await cleanupLaunchScripts();
      await cleanup!();
      await expect(stat(script)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
