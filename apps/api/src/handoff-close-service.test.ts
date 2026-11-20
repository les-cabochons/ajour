import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { Handoffs, HandoffRefused } from "./handoffs.ts";
import { startHandoff } from "./handoff-state.ts";
import { AppApiStorage } from "./storage.ts";
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
