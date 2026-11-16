import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { terminalSettings, openPluginLink } = createRequire(import.meta.url)(
  "./electron/terminal-settings.cjs",
);
it.each([
  ["win32", "powershell", "wt"],
  ["win32", "cmd", "wt"],
  ["darwin", "iTerm", "Terminal"],
])("Given %s saved %s, migrates to %s", async (platform, old, current) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "ajour-terminal-setting-test-"),
  );
  const file = path.join(root, "setting.json");
  try {
    await writeFile(file, JSON.stringify(old));
    const settings = terminalSettings(platform, file);
    expect(await settings.read()).toBe(current);
    expect(JSON.parse(await readFile(file, "utf8"))).toBe(current);
    await expect(settings.save(old)).rejects.toThrow("Unsupported");
    await expect(settings.save(current)).resolves.toBe(current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("Given Linux, has no terminal default", async () => {
  const settings = terminalSettings("linux", "unused");
  expect(await settings.read()).toBeUndefined();
  await expect(settings.save("Terminal")).rejects.toThrow();
});
it.each([
  "file:///x",
  "http://example.test/",
  "javascript:alert(1)",
  "other://thread",
])("Given forbidden main-process link %s, refuses", async (url) => {
  await expect(
    openPluginLink(url, ["codex"], async () => {
      throw new Error("called");
    }),
  ).rejects.toThrow("scheme");
});
it.each(["https://example.test/", "codex://thread/1"])(
  "Given allowed main-process link %s, opens",
  async (url) => {
    const opened: string[] = [];
    await openPluginLink(url, ["codex"], async (value: string) => {
      opened.push(value);
    });
    expect(opened).toEqual([url]);
  },
);
