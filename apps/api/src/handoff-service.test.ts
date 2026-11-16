import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { Handoffs } from "./handoffs.ts";
import { AppApiStorage } from "./storage.ts";

it("batches refresh by tool and project, respects visibility, and preserves a refused start", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoffs-"));
  try {
    const storage = new AppApiStorage(path.join(root, "state.json"));
    const folder = await storage.addRepositoryFolder("p", root, "Repo");
    let now = 1000;
    const calls: string[][] = [];
    const service = new Handoffs({
      storage,
      now: () => now,
      onChange: () => {},
      plugins: {
        async listPlugins() {
          return [
            {
              id: "agent",
              capabilities: {
                handoff: { tools: [{ id: "t3" }, { id: "other" }] },
              },
            },
          ];
        },
        async startHandoff(_plugin, request) {
          if (request.title === "refuse") throw new Error("Tool unavailable");
          return { threadId: request.title, native: {} };
        },
        async readHandoffStates(_plugin, request, projectId) {
          expect(["p", "p2"]).toContain(projectId);
          if (request.handoffs.length > 1) expect(projectId).toBe("p");
          calls.push(request.handoffs.map((h) => h.id));
          return request.handoffs.map((h) => ({
            id: h.id,
            state: "ready" as const,
            native: { label: "Ready" },
          }));
        },
      },
    });
    const input = {
      pluginId: "agent",
      toolId: "t3",
      projectId: "p",
      folderId: folder.id,
      workItemId: "item",
      title: "one",
      prompt: "private prompt",
      item: { key: "PAY-12", url: "" },
      settings: {},
    };
    await service.start(input);
    await service.start({ ...input, title: "two" });
    await expect(service.start({ ...input, title: "refuse" })).rejects.toThrow(
      "Tool unavailable",
    );
    expect(await storage.listHandoffs()).toHaveLength(2);
    await service.tick();
    expect(calls).toHaveLength(0);
    now += 30_000;
    await service.tick();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    service.setVisible(false);
    now += 30_000;
    await service.tick();
    expect(calls).toHaveLength(1);
    now += 90_000;
    await service.tick();
    expect(calls).toHaveLength(2);
    const records = await storage.listHandoffs();
    expect(records[0]?.history).toHaveLength(1);
    await service.remove(records[0]!.id);
    expect(await storage.listHandoffs()).toHaveLength(1);
    const secondFolder = await storage.addRepositoryFolder(
      "p2",
      root,
      "Other repo",
    );
    await service.start({
      ...input,
      projectId: "p2",
      folderId: secondFolder.id,
    });
    await service.start({ ...input, toolId: "other" });
    const before = calls.length;
    await service.refresh();
    expect(calls.slice(before).map((batch) => batch.length)).toEqual([1, 1, 1]);
    const reloaded = new AppApiStorage(path.join(root, "state.json"));
    expect(await reloaded.listHandoffs()).toEqual(await storage.listHandoffs());
    expect(await readFile(path.join(root, "state.json"), "utf8")).not.toContain(
      "private prompt",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
