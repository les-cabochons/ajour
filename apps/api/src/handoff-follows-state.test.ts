import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { Handoffs } from "./handoffs.ts";
import { AppApiStorage } from "./storage.ts";
import type { StartHandoffRequest } from "../../../packages/shared/handoffs.ts";

/**
 * A plugin whose `copilot` tool only starts threads (`followsState: false`)
 * and whose `claude` tool follows them, as ticket #759 has it.
 */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-follows-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const folder = await storage.addRepositoryFolder("p", root, "Repo");
  const clock = { now: 1_000_000 };
  const starts: StartHandoffRequest[] = [];
  const reads: string[][] = [];
  const tools: Array<{
    id: string;
    label: string;
    followsState?: boolean;
    listsThreads?: boolean;
  }> = [
    { id: "copilot", label: "Copilot CLI", followsState: false },
    { id: "claude", label: "Claude Code" },
  ];
  const service = new Handoffs({
    storage,
    now: () => clock.now,
    onChange: () => {},
    hookUrl: (id, token) =>
      `http://127.0.0.1:8787/hooks/handoff/${id}?token=${token}`,
    plugins: {
      async listPlugins() {
        return [{ id: "agent", capabilities: { handoff: { tools } } }];
      },
      async startHandoff(_plugin, request) {
        starts.push(request);
        return { threadId: `thread-${starts.length}`, native: {} };
      },
      async readHandoffStates(_plugin, request) {
        reads.push(request.handoffs.map((h) => h.threadId));
        return request.handoffs.map((h) => ({
          id: h.id,
          state: "done" as const,
          native: {},
        }));
      },
      async listThreads() {
        return {
          threads: [{ threadId: "own", title: "[PAY-12] Mine", native: {} }],
        };
      },
    },
  });
  service.setVisible(true);
  const input = (toolId: string) => ({
    pluginId: "agent",
    toolId,
    projectId: "p",
    folderId: folder.id,
    workItemId: "item",
    projectName: "Project",
    item: { key: "PAY-12", title: "Fix login", type: "Bug", url: "" },
    settings: {},
  });
  return { storage, folder, clock, starts, reads, tools, service, input };
}

it("saves a start with a tool that doesn't follow state as started, with no hook, and never reads it", async () => {
  const t = await setup();
  const record = await t.service.start(t.input("copilot"));
  expect(record.state).toBe("started");
  expect(record.startedAt).toBe(1_000_000);
  // A hook would only make Ajour read a state the tool can't give.
  expect(t.starts[0]).not.toHaveProperty("hook");
  expect(await t.storage.findHandoffHook(record.id)).toBeUndefined();

  t.clock.now += 3_600_000;
  await t.service.tick();
  expect(await t.service.refresh()).toEqual({ succeeded: 0, failures: [] });
  expect(await t.service.refresh(record.id)).toEqual({
    succeeded: 0,
    failures: [],
  });
  await t.service.refreshFromHook(record.id);
  expect(t.reads).toEqual([]);
  expect((await t.storage.listHandoffs())[0]).toMatchObject({
    state: "started",
    checkedAt: 1_000_000,
  });
});

it("reads a tool that follows state beside one that doesn't", async () => {
  const t = await setup();
  await t.service.start(t.input("copilot"));
  const followed = await t.service.start(t.input("claude"));
  expect(followed.state).toBe("working");
  expect(t.starts[1]?.hook?.url).toContain("/hooks/handoff/");
  t.clock.now += 30_000;
  await t.service.tick();
  expect(t.reads).toEqual([["thread-2"]]);
});

it("hands an item off again while it has a live and a finished handoff", async () => {
  const t = await setup();
  const first = await t.service.start(t.input("claude"));
  await t.storage.updateHandoffs(
    [{ id: first.id, state: "done", native: {} }],
    t.clock.now,
  );
  await t.service.start(t.input("claude"));
  await t.service.start(t.input("copilot"));
  expect((await t.storage.listHandoffs()).map((h) => h.state)).toEqual([
    "done",
    "working",
    "started",
  ]);
});

it("adopts a thread from a tool that doesn't follow state as started, without reading it", async () => {
  const t = await setup();
  t.tools[0]!.listsThreads = true;
  await t.service.findThreads("p", "item", ["PAY-12"]);
  const record = await t.service.adopt({
    pluginId: "agent",
    toolId: "copilot",
    folderId: t.folder.id,
    threadId: "own",
    projectId: "p",
    workItemId: "item",
  });
  expect(record.state).toBe("started");
  expect(t.reads).toEqual([]);
});

it("turns a handoff whose tool stopped following state into started, without reading it", async () => {
  const t = await setup();
  const record = await t.service.start(t.input("claude"));
  t.tools[1]!.followsState = false;
  t.clock.now += 30_000;
  await t.service.tick();
  expect(t.reads).toEqual([]);
  const [saved] = await t.storage.listHandoffs();
  expect(saved).toMatchObject({ id: record.id, state: "started" });
  // Its hook goes with it: nothing reads the state it would announce.
  expect(await t.storage.findHandoffHook(record.id)).toBeUndefined();
});

it("still pauses a started handoff whose connection was deleted, without reading it", async () => {
  const t = await setup();
  t.tools[0] = { ...t.tools[0]!, connection: "required" } as never;
  let deleted = false;
  const service = new Handoffs({
    storage: t.storage,
    now: () => t.clock.now,
    onChange: () => {},
    connection: async (_pluginId, id) =>
      id === "c1" && !deleted
        ? {
            id: "c1",
            pluginId: "agent",
            label: "Copilot",
            tenantLabel: "Local",
            autoSync: false,
            autoSyncIntervalMinutes: 60,
            connectedAt: 1,
            config: {},
          }
        : undefined,
    plugins: {
      async listPlugins() {
        return [{ id: "agent", capabilities: { handoff: { tools: t.tools } } }];
      },
      async startHandoff() {
        return { threadId: "thread", native: {} };
      },
      async readHandoffStates() {
        throw new Error("never read");
      },
    },
  });
  const record = await service.start({
    ...t.input("copilot"),
    connectionId: "c1",
  });
  expect(record.state).toBe("started");
  expect(await service.refreshConnection("agent", "c1")).toEqual({
    succeeded: 0,
    failures: [],
  });
  deleted = true;
  await service.refreshConnection("agent", "c1");
  expect((await t.storage.listHandoffs())[0]).toMatchObject({
    state: "unknown",
    paused: { reason: "The connection this handoff ran through was deleted." },
  });
});
