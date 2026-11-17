import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { Handoffs, HandoffRefused } from "./handoffs.ts";
import { AppApiStorage } from "./storage.ts";

/**
 * A handoff plugin with two tools that list threads. Each test turns tools
 * on and off through storage, as the plugin page's switches do (#760).
 */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-switch-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const folder = await storage.addRepositoryFolder("p", root, "Repo");
  const clock = { now: 1_000_000 };
  const calls = {
    starts: [] as string[],
    reads: [] as string[][],
    listings: [] as string[],
    detections: 0,
  };
  const service = new Handoffs({
    storage,
    now: () => clock.now,
    onChange: () => {},
    plugins: {
      async listPlugins() {
        return [
          {
            id: "agent",
            capabilities: {
              handoff: {
                tools: [
                  { id: "t3", label: "T3 Code", listsThreads: true },
                  { id: "codex", label: "Codex", listsThreads: true },
                ],
              },
            },
          },
        ];
      },
      async detectTools() {
        calls.detections++;
        return {
          tools: [
            { id: "t3", available: true },
            { id: "codex", available: true },
          ],
        };
      },
      async startHandoff(_plugin, request) {
        calls.starts.push(request.tool);
        return { threadId: `${request.tool}-thread`, native: {} };
      },
      async readHandoffStates(_plugin, request) {
        calls.reads.push(request.handoffs.map((h) => h.threadId));
        return request.handoffs.map((h) => ({
          id: h.id,
          state: "ready" as const,
          native: {},
        }));
      },
      async listThreads(_plugin, request) {
        calls.listings.push(request.tool);
        return {
          threads: [
            {
              threadId: `${request.tool}-found`,
              title: "[PAY-12] Fix",
              native: {},
            },
          ],
        };
      },
    },
  });
  const start = (toolId: string) =>
    service.start({
      pluginId: "agent",
      toolId,
      projectId: "p",
      folderId: folder.id,
      workItemId: "item",
      projectName: "Project",
      item: { key: "PAY-12", title: "Fix", type: "Bug", url: "" },
      settings: {},
    });
  return { storage, folder, clock, calls, service, start };
}

it("refuses a start for a tool that is off, saying where to turn it on", async () => {
  const t = await setup();
  await expect(t.start("t3")).rejects.toThrow(HandoffRefused);
  await expect(t.start("t3")).rejects.toThrow(
    "T3 Code is off. Turn it on in the plugin's Handoff tools to hand off to it.",
  );
  expect(t.calls.starts).toEqual([]);
  expect(await t.storage.listHandoffs()).toEqual([]);

  await t.storage.setHandoffToolEnabled("agent", "t3", true);
  await t.start("t3");
  expect(t.calls.starts).toEqual(["t3"]);
});

it("detects only the tools that are on, and runs no detection with none on", async () => {
  const t = await setup();
  expect(await t.service.detect("agent", "p")).toEqual({ tools: [] });
  expect(t.calls.detections).toBe(0);

  await t.storage.setHandoffToolEnabled("agent", "codex", true);
  expect(await t.service.detect("agent", "p")).toEqual({
    tools: [{ id: "codex", available: true }],
  });
  expect(t.calls.detections).toBe(1);
});

it("lists threads only in tools that are on and refuses to link a thread of a tool turned off", async () => {
  const t = await setup();
  expect((await t.service.findThreads("p", "item", ["PAY-12"])).offers).toEqual(
    [],
  );
  expect(t.calls.listings).toEqual([]);

  await t.storage.setHandoffToolEnabled("agent", "t3", true);
  const found = await t.service.findThreads("p", "item", ["PAY-12"]);
  expect(found.offers.map((offer) => offer.threadId)).toEqual(["t3-found"]);
  expect(t.calls.listings).toEqual(["t3"]);

  // Turned off after listing: the offer it made can no longer be linked.
  await t.storage.setHandoffToolEnabled("agent", "t3", false);
  await expect(
    t.service.adopt({
      pluginId: "agent",
      toolId: "t3",
      folderId: t.folder.id,
      threadId: "t3-found",
      workItemId: "item",
      projectId: "p",
    }),
  ).rejects.toThrow(
    "T3 Code is off. Turn it on in the plugin's Handoff tools to link its threads.",
  );
  expect((await t.service.findThreads("p", "item", ["PAY-12"])).offers).toEqual(
    [],
  );
});

it("keeps refreshing the handoffs of a tool turned off, and keeps them on the item", async () => {
  const t = await setup();
  await t.storage.setHandoffToolEnabled("agent", "t3", true);
  const record = await t.start("t3");
  await t.storage.setHandoffToolEnabled("agent", "t3", false);

  t.service.setVisible(true);
  t.clock.now += 30_000;
  await t.service.tick();
  expect(t.calls.reads).toEqual([["t3-thread"]]);
  await t.service.refresh(record.id);
  expect(t.calls.reads).toHaveLength(2);
  expect(await t.service.refreshRefusal(record.id)).toBeUndefined();

  const [kept] = await t.storage.listHandoffs();
  expect(kept).toMatchObject({ id: record.id, toolId: "t3", state: "ready" });
  expect(kept?.paused).toBeUndefined();
});
