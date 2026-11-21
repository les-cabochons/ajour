import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { Handoffs, HandoffRefused } from "./handoffs.ts";
import { startHandoff } from "./handoff-state.ts";
import { AppApiStorage } from "./storage.ts";
import { turnOnHandoffTools } from "./test-support/handoff-tool-switches.ts";
import type {
  CloseThreadRequest,
  HandoffCloseKind,
} from "../../../packages/shared/handoffs.ts";

/**
 * Closing a handoff's thread in its tool (#850): the service asks the
 * plugin only for a tool that declares `closesThreads`, forgets the handoff
 * once the tool answers, and keeps it, with the tool's reason, when not.
 */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-close-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const storage = new AppApiStorage(path.join(root, "state.json"));
  // What the plugin declares and how it answers, changed by tests.
  const plugin = {
    tools: [
      { id: "codex", label: "Codex", closesThreads: "archive" },
      { id: "opencode", label: "OpenCode", closesThreads: "delete" },
      { id: "vscode", label: "VS Code", followsState: false },
    ] as Array<{
      id: string;
      label: string;
      closesThreads?: HandoffCloseKind;
      followsState?: boolean;
    }>,
    installed: true,
    unavailable: undefined as string | undefined,
    refusal: undefined as string | undefined,
    actions: [] as Array<string | undefined>,
  };
  const closes: Array<CloseThreadRequest & { pluginId: string }> = [];
  const removed: string[] = [];
  const service = new Handoffs({
    storage,
    onChange: () => {},
    onRemove: (id) => removed.push(id),
    unavailableReason: async (_pluginId, _toolId, action) => {
      plugin.actions.push(action);
      return plugin.unavailable;
    },
    plugins: {
      async listPlugins() {
        return plugin.installed
          ? [
              {
                id: "agent",
                capabilities: { handoff: { tools: plugin.tools } },
              },
            ]
          : [];
      },
      async startHandoff() {
        throw new Error("not used");
      },
      async readHandoffStates() {
        throw new Error("not used");
      },
      async closeThread(pluginId, request) {
        closes.push({ ...request, pluginId });
        if (plugin.refusal) throw new Error(plugin.refusal);
        return {};
      },
    },
  });
  const add = async (id: string, toolId: string) =>
    storage.addHandoff(
      startHandoff(
        {
          id,
          pluginId: "agent",
          toolId,
          workItemId: "item-12",
          projectId: "p",
          folderId: "f",
          title: "[PAY-12] Fix login redirect",
        },
        { threadId: `thread-${id}`, native: { status: "busy" } },
        1000,
      ),
    );
  const ids = async () => (await storage.listHandoffs()).map((h) => h.id);
  return { storage, plugin, closes, removed, service, add, ids };
}

it("asks the tool to close the thread, then forgets the handoff", async () => {
  const t = await setup();
  await t.add("h1", "codex");
  await t.add("h2", "codex");
  // A working thread is closed too: the plugin stops it first.
  await t.storage.updateHandoffs(
    [{ id: "h1", state: "working", native: { status: "busy" } }],
    2000,
  );

  await expect(t.service.close("h1")).resolves.toEqual({
    pluginId: "agent",
    toolId: "codex",
    closesThreads: "archive",
  });

  expect(t.closes).toEqual([
    {
      pluginId: "agent",
      tool: "codex",
      handoff: {
        id: "h1",
        threadId: "thread-h1",
        folderId: "f",
        native: { status: "busy" },
      },
    },
  ]);
  expect(await t.ids()).toEqual(["h2"]);
  // Its hook state goes with it, as with Remove from item.
  expect(t.removed).toEqual(["h1"]);
  expect(t.plugin.actions).toEqual(["closing its thread"]);
});

it("keeps the handoff with the tool's reason when the tool refuses", async () => {
  const t = await setup();
  await t.add("h1", "opencode");
  t.plugin.refusal = "OpenCode is not running.";

  const refusal = await t.service.close("h1").catch((error: unknown) => error);

  expect(refusal).toBeInstanceOf(HandoffRefused);
  expect((refusal as Error).message).toBe("OpenCode is not running.");
  expect(await t.ids()).toEqual(["h1"]);
  expect(t.removed).toEqual([]);
});

it("never asks a tool that doesn't close threads, or one that can't run", async () => {
  const t = await setup();
  await t.add("h1", "vscode");
  await t.add("h2", "codex");
  await t.add("h3", "gone-tool");

  await expect(t.service.close("h1")).rejects.toThrow(
    "VS Code can't close its threads. Remove it from the item instead.",
  );
  await expect(t.service.close("h3")).rejects.toThrow(
    "The handoff tool was removed.",
  );
  t.plugin.unavailable = "Turn the plugin on before closing its thread.";
  await expect(t.service.close("h2")).rejects.toThrow(
    "Turn the plugin on before closing its thread.",
  );
  t.plugin.installed = false;
  await expect(t.service.close("h2")).rejects.toThrow(
    "The handoff plugin is unavailable.",
  );
  await expect(t.service.close("missing")).rejects.toThrow(
    "This handoff no longer exists.",
  );

  expect(t.closes).toEqual([]);
  expect(await t.ids()).toEqual(["h1", "h2", "h3"]);
});

/**
 * A closed thread leaves the listings taken before the close, cached or
 * under way: the item page offers it no more, and Link refuses it. The
 * Codex review of #851 found that the five-minute listing cache offered it
 * again.
 */
async function listingSetup() {
  const t = await setup();
  await turnOnHandoffTools(t.storage, { agent: ["codex"] });
  const folder = await t.storage.addRepositoryFolder("p", os.tmpdir(), "Repo");
  const listed = {
    threadId: "thread-h1",
    title: "[PAY-12] Fix login redirect",
    native: {},
  };
  let answer: () => Promise<{ threads: (typeof listed)[] }> = async () => ({
    threads: [listed],
  });
  const service = new Handoffs({
    storage: t.storage,
    onChange: () => {},
    plugins: {
      listPlugins: async () => [
        {
          id: "agent",
          capabilities: {
            handoff: {
              tools: [
                {
                  id: "codex",
                  label: "Codex",
                  listsThreads: true,
                  closesThreads: "archive",
                },
              ],
            },
          },
        },
      ],
      startHandoff: async () => {
        throw new Error("not used");
      },
      readHandoffStates: async (_plugin, request) =>
        request.handoffs.map((h) => ({ id: h.id, state: "ready", native: {} })),
      listThreads: () => answer(),
      closeThread: async () => ({}),
    },
  });
  const offered = async () =>
    (await service.findThreads("p", "item-12", ["PAY-12"])).offers.map(
      (offer) => offer.threadId,
    );
  const link = () =>
    service.adopt({
      pluginId: "agent",
      toolId: "codex",
      folderId: folder.id,
      threadId: "thread-h1",
      projectId: "p",
      workItemId: "item-12",
    });
  return {
    ...t,
    service,
    offered,
    link,
    answerWith: (next: typeof answer) => {
      answer = next;
    },
  };
}

it("stops offering a closed thread from the listing taken before the close", async () => {
  const t = await listingSetup();
  expect(await t.offered()).toEqual(["thread-h1"]);
  const linked = await t.link();

  await t.service.close(linked.id);

  expect(await t.offered()).toEqual([]);
  await expect(t.link()).rejects.toThrow("This thread is no longer listed.");
});

it("leaves a closed thread out of a listing that was under way during the close", async () => {
  const t = await listingSetup();
  await t.add("h1", "codex");
  let release!: () => void;
  t.answerWith(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            threads: [
              {
                threadId: "thread-h1",
                title: "[PAY-12] Fix login redirect",
                native: {},
              },
            ],
          });
      }),
  );
  const finding = t.offered();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));

  await t.service.close("h1");
  release();

  expect(await finding).toEqual([]);
  expect(await t.offered()).toEqual([]);
});
