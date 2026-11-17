import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppApiStorage } from "./storage.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function stateFile() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-switches-"));
  roots.push(root);
  return path.join(root, "state.json");
}

it("starts every tool off, saves each switch per plugin and keeps them after a reload", async () => {
  const file = await stateFile();
  const storage = new AppApiStorage(file);
  expect(await storage.getEnabledHandoffTools("agent-handoff")).toEqual([]);

  expect(
    await storage.setHandoffToolEnabled("agent-handoff", "t3", true),
  ).toEqual(["t3"]);
  expect(
    await storage.setHandoffToolEnabled("agent-handoff", "codex", true),
  ).toEqual(["t3", "codex"]);
  // Turning one on twice keeps it once.
  expect(
    await storage.setHandoffToolEnabled("agent-handoff", "t3", true),
  ).toEqual(["t3", "codex"]);
  expect(
    await storage.setHandoffToolEnabled("agent-handoff", "t3", false),
  ).toEqual(["codex"]);
  expect(await storage.getEnabledHandoffTools("other")).toEqual([]);

  const reloaded = new AppApiStorage(file);
  expect(await reloaded.getEnabledHandoffTools("agent-handoff")).toEqual([
    "codex",
  ]);
});

it("refuses unsafe ids and drops malformed saved switches", async () => {
  const file = await stateFile();
  const storage = new AppApiStorage(file);
  await expect(
    storage.setHandoffToolEnabled("__proto__", "t3", true),
  ).rejects.toThrow("Invalid plugin id.");
  await expect(
    storage.setHandoffToolEnabled("agent-handoff", "Not a tool", true),
  ).rejects.toThrow("Invalid tool id.");
  expect(await storage.getEnabledHandoffTools("__proto__")).toEqual([]);

  await storage.setHandoffToolEnabled("agent-handoff", "t3", true);
  const saved = JSON.parse(await readFile(file, "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(
    file,
    JSON.stringify({
      ...saved,
      handoffEnabledTools: {
        "agent-handoff": ["t3", 4, "t3", "", "__proto__"],
        broken: "t3",
      },
    }),
  );
  const reloaded = new AppApiStorage(file);
  expect(await reloaded.getEnabledHandoffTools("agent-handoff")).toEqual([
    "t3",
  ]);
  expect(await reloaded.getEnabledHandoffTools("broken")).toEqual([]);
});

it("forgets a plugin's switches when the plugin is removed", async () => {
  const file = await stateFile();
  const storage = new AppApiStorage(file);
  await storage.setHandoffToolEnabled("agent-handoff", "t3", true);
  await storage.setHandoffToolEnabled("other", "cli", true);
  await storage.removePluginData("agent-handoff");
  expect(await storage.getEnabledHandoffTools("agent-handoff")).toEqual([]);
  expect(await storage.getEnabledHandoffTools("other")).toEqual(["cli"]);
});

it("turns on, on upgrade, the tools whose handoffs this device keeps", async () => {
  const file = await stateFile();
  await writeFile(
    file,
    JSON.stringify({
      version: 12,
      connections: [],
      handoffs: [
        {
          id: "h1",
          pluginId: "agent-handoff",
          toolId: "t3",
          workItemId: "item",
          projectId: "p",
          folderId: "f",
          threadId: "thread",
          title: "[PAY-12] Fix",
          startedAt: 1,
          state: "working",
          native: {},
          checkedAt: 1,
          changedAt: 1,
          history: [],
        },
      ],
    }),
  );
  const storage = new AppApiStorage(file);
  expect(await storage.getEnabledHandoffTools("agent-handoff")).toEqual(["t3"]);
  // The step ran once: a tool turned off stays off at the next load.
  await storage.setHandoffToolEnabled("agent-handoff", "t3", false);
  expect(
    await new AppApiStorage(file).getEnabledHandoffTools("agent-handoff"),
  ).toEqual([]);
});
