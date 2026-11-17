import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { Handoffs, THREAD_LISTING_INTERVAL_MS } from "./handoffs.ts";
import { AppApiStorage } from "./storage.ts";
import type {
  ListThreadsRequest,
  ListThreadsResult,
} from "../../../packages/shared/handoffs.ts";

async function setup(
  answer: (
    request: ListThreadsRequest,
  ) => ListThreadsResult | Promise<ListThreadsResult>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-threads-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const statePath = path.join(root, "state.json");
  const storage = new AppApiStorage(statePath);
  const folder = await storage.addRepositoryFolder("p", root, "Repo");
  const clock = { now: 1_000_000 };
  const listings: Array<ListThreadsRequest & { pluginId: string }> = [];
  const reads: string[][] = [];
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
                  { id: "claude", label: "Claude Code" },
                ],
              },
            },
          },
        ];
      },
      async startHandoff() {
        throw new Error("not used");
      },
      async listThreads(pluginId, request) {
        listings.push({ ...request, pluginId });
        return answer(request);
      },
      async readHandoffStates(_plugin, request) {
        reads.push(request.handoffs.map((h) => h.threadId));
        return request.handoffs.map((h) => ({
          id: h.id,
          state: "ready" as const,
          native: { status: "idle", label: "Idle" },
        }));
      },
    },
  });
  return {
    root,
    statePath,
    storage,
    folder,
    clock,
    listings,
    reads,
    service,
  };
}

const threads: ListThreadsResult = {
  threads: [
    {
      threadId: "t-12",
      title: "[PAY-12] Fix login redirect",
      link: "https://example.test/t-12",
      native: { status: "idle" },
      updatedAt: 900_000,
    },
    {
      threadId: "t-both",
      title: "[PAY-11] [PAY-12] Split the job",
      native: {},
      updatedAt: 950_000,
    },
    { threadId: "t-13", title: "[PAY-13] Another item", native: {} },
    { threadId: "t-none", title: "Unrelated chat", native: {} },
  ],
};

it("lists each folder's threads per tool that lists them, at most once every few minutes, and offers those that name the key", async () => {
  const t = await setup(() => threads);
  const found = await t.service.findThreads("p", "PAY-12");
  expect(found.offers.map((offer) => offer.threadId)).toEqual([
    "t-both",
    "t-12",
  ]);
  expect(found.offers[1]).toEqual({
    pluginId: "agent",
    toolId: "t3",
    folderId: t.folder.id,
    threadId: "t-12",
    title: "[PAY-12] Fix login redirect",
    updatedAt: 900_000,
  });
  expect(found.listed).toBe(1);
  // Only the tool that declares it lists, for the item's project's folder.
  expect(t.listings).toEqual([
    {
      pluginId: "agent",
      tool: "t3",
      folder: { id: t.folder.id },
      since: expect.any(Number),
      limit: 50,
    },
  ]);
  // Another item of the project reads the same listing.
  const other = await t.service.findThreads("p", "PAY-13");
  expect(other.offers.map((offer) => offer.threadId)).toEqual(["t-13"]);
  expect(other.listed).toBe(0);
  expect(t.listings).toHaveLength(1);
  t.clock.now += THREAD_LISTING_INTERVAL_MS - 1;
  await t.service.findThreads("p", "PAY-12");
  expect(t.listings).toHaveLength(1);
  t.clock.now += 1;
  await t.service.findThreads("p", "PAY-12");
  expect(t.listings).toHaveLength(2);
  // A project without folders, or an item without a key, lists nothing.
  expect((await t.service.findThreads("p2", "PAY-12")).offers).toEqual([]);
  expect((await t.service.findThreads("p", "")).offers).toEqual([]);
  expect(t.listings).toHaveLength(2);
});

it("remembers a failed listing as long as a good one, so a failing tool isn't asked on every open", async () => {
  let fail = true;
  const t = await setup(() => {
    if (fail) throw new Error("t3 isn't on PATH");
    return threads;
  });
  const found = await t.service.findThreads("p", "PAY-12");
  expect(found).toMatchObject({ offers: [], listed: 1, failed: 1 });
  fail = false;
  expect((await t.service.findThreads("p", "PAY-12")).offers).toEqual([]);
  expect(t.listings).toHaveLength(1);
  t.clock.now += THREAD_LISTING_INTERVAL_MS;
  expect((await t.service.findThreads("p", "PAY-12")).offers).toHaveLength(2);
});

it("shares one listing between item pages that open at once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const t = await setup(async () => {
    await gate;
    return threads;
  });
  const first = t.service.findThreads("p", "PAY-12");
  const second = t.service.findThreads("p", "PAY-13");
  release();
  expect((await first).offers).toHaveLength(2);
  expect((await second).offers).toHaveLength(1);
  expect(t.listings).toHaveLength(1);
});

it("links a listed thread as a handoff, unknown until refreshed right away, and stops offering it", async () => {
  const t = await setup(() => threads);
  await t.service.findThreads("p", "PAY-12");
  const record = await t.service.adopt({
    pluginId: "agent",
    toolId: "t3",
    folderId: t.folder.id,
    threadId: "t-12",
    projectId: "p",
    workItemId: "item-12",
  });
  expect(record).toMatchObject({
    pluginId: "agent",
    toolId: "t3",
    folderId: t.folder.id,
    projectId: "p",
    workItemId: "item-12",
    threadId: "t-12",
    title: "[PAY-12] Fix login redirect",
    link: "https://example.test/t-12",
    state: "ready",
    native: { status: "idle", label: "Idle" },
  });
  // It was unknown until the refresh that ran at once.
  expect(record.history).toEqual([
    { state: "ready", status: "idle", label: "Idle", at: t.clock.now },
  ]);
  expect(t.reads).toEqual([["t-12"]]);
  expect(await t.storage.listHandoffs()).toEqual([record]);
  // Linked to any item, it's offered to none.
  expect(
    (await t.service.findThreads("p", "PAY-12")).offers.map((o) => o.threadId),
  ).toEqual(["t-both"]);
  await expect(
    t.service.adopt({
      pluginId: "agent",
      toolId: "t3",
      folderId: t.folder.id,
      threadId: "t-12",
      projectId: "p",
      workItemId: "item-other",
    }),
  ).rejects.toThrow(/already linked/);
});

it("keeps a linked thread unknown when its first refresh fails", async () => {
  const t = await setup(() => threads);
  await t.service.findThreads("p", "PAY-12");
  const failing = new Handoffs({
    storage: t.storage,
    now: () => t.clock.now,
    onChange: () => {},
    plugins: {
      listPlugins: async () => [
        {
          id: "agent",
          capabilities: {
            handoff: { tools: [{ id: "t3", listsThreads: true }] },
          },
        },
      ],
      startHandoff: async () => {
        throw new Error("not used");
      },
      listThreads: async () => threads,
      readHandoffStates: async () => {
        throw new Error("t3 isn't answering");
      },
    },
  });
  await failing.findThreads("p", "PAY-12");
  const record = await failing.adopt({
    pluginId: "agent",
    toolId: "t3",
    folderId: t.folder.id,
    threadId: "t-12",
    projectId: "p",
    workItemId: "item-12",
  });
  expect(record).toMatchObject({ state: "unknown", history: [] });
});

it("refuses to link a thread it didn't list, or into another project's folder", async () => {
  const t = await setup(() => threads);
  const input = {
    pluginId: "agent",
    toolId: "t3",
    folderId: t.folder.id,
    threadId: "t-12",
    projectId: "p",
    workItemId: "item-12",
  };
  // Nothing was listed yet: the window can't name a thread of its own.
  await expect(t.service.adopt(input)).rejects.toThrow(/no longer listed/);
  await t.service.findThreads("p", "PAY-12");
  await expect(
    t.service.adopt({ ...input, threadId: "made-up" }),
  ).rejects.toThrow(/no longer listed/);
  await expect(t.service.adopt({ ...input, toolId: "claude" })).rejects.toThrow(
    /no longer listed/,
  );
  await expect(t.service.adopt({ ...input, projectId: "p2" })).rejects.toThrow(
    /folder/,
  );
  expect(await t.storage.listHandoffs()).toEqual([]);
});

it("remembers Not this one across restarts, by plugin, tool and thread", async () => {
  const t = await setup(() => threads);
  await t.service.findThreads("p", "PAY-12");
  await t.service.dismissThread({
    pluginId: "agent",
    toolId: "t3",
    threadId: "t-12",
  });
  expect(
    (await t.service.findThreads("p", "PAY-12")).offers.map((o) => o.threadId),
  ).toEqual(["t-both"]);
  const reloaded = new AppApiStorage(t.statePath);
  expect(await reloaded.listHandoffThreadDismissals()).toEqual([
    { pluginId: "agent", toolId: "t3", threadId: "t-12" },
  ]);
  const restarted = new Handoffs({
    storage: reloaded,
    now: () => t.clock.now,
    onChange: () => {},
    plugins: {
      listPlugins: async () => [
        {
          id: "agent",
          capabilities: {
            handoff: { tools: [{ id: "t3", listsThreads: true }] },
          },
        },
      ],
      startHandoff: async () => {
        throw new Error("not used");
      },
      listThreads: async () => threads,
      readHandoffStates: async () => [],
    },
  });
  expect(
    (await restarted.findThreads("p", "PAY-12")).offers.map((o) => o.threadId),
  ).toEqual(["t-both"]);
  // Dismissing twice keeps one record; uninstalling the plugin forgets it.
  await restarted.dismissThread({
    pluginId: "agent",
    toolId: "t3",
    threadId: "t-12",
  });
  expect(await reloaded.listHandoffThreadDismissals()).toHaveLength(1);
  await reloaded.removePluginData("agent");
  expect(await reloaded.listHandoffThreadDismissals()).toEqual([]);
});
