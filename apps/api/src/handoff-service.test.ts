import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    let publishes = 0;
    const service = new Handoffs({
      storage,
      now: () => now,
      onChange: () => {
        publishes++;
      },
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
    service.setVisible(true);
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
    expect(publishes).toBe(3);
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

it("continues failed batches, pauses unavailable tools once and resumes them when restored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-recovery-"));
  try {
    const storage = new AppApiStorage(path.join(root, "state.json"));
    let now = 1000,
      mode = "fail",
      writes = 0;
    const calls: string[] = [];
    const service = new Handoffs({
      storage,
      now: () => now,
      onChange: () => {
        writes++;
      },
      unavailableReason: async () =>
        mode === "disabled" ? "Plugin is disabled." : undefined,
      plugins: {
        async listPlugins() {
          return mode === "missing"
            ? []
            : [
                {
                  id: "agent",
                  capabilities: {
                    handoff: {
                      tools:
                        mode === "removed" ? [] : [{ id: "a" }, { id: "b" }],
                    },
                  },
                },
              ];
        },
        async startHandoff() {
          return { threadId: "t", native: {} };
        },
        async readHandoffStates(_plugin, request) {
          calls.push(request.tool);
          now += 100;
          if (mode === "fail" && request.tool === "a")
            throw new Error("Tool A unavailable");
          return request.handoffs.map((h) => ({
            id: h.id,
            state: "ready" as const,
            native: {},
          }));
        },
      },
    });
    const folder = await storage.addRepositoryFolder("p", root, "Repo");
    const input = {
      pluginId: "agent",
      toolId: "a",
      projectId: "p",
      folderId: folder.id,
      workItemId: "i",
      title: "Title",
      prompt: "P",
      item: { key: "", url: "" },
      settings: {},
    };
    await service.start(input);
    await service.start({ ...input, toolId: "b" });
    expect(await service.refresh()).toEqual({
      succeeded: 1,
      failures: [
        {
          pluginId: "agent",
          toolId: "a",
          projectId: "p",
          reason: "Tool A unavailable",
        },
      ],
    });
    expect(calls).toEqual(["a", "b"]);
    expect((await storage.listHandoffs()).map((h) => h.checkedAt)).toEqual([
      1000, 1100,
    ]);
    for (const unavailable of ["missing", "disabled", "removed"]) {
      mode = unavailable;
      now += 120000;
      await service.tick();
      const records = await storage.listHandoffs();
      expect(records.every((h) => h.state === "unknown")).toBe(true);
      const published = writes;
      now += 120000;
      await service.tick();
      expect(writes).toBe(published);
      expect(await storage.listHandoffs()).toEqual(records);
      expect(calls).toEqual(["a", "b"]);
    }
    mode = "ok";
    now += 120000;
    await service.tick();
    expect(calls).toEqual(["a", "b", "a", "b"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("retains pre-review records while compacting their native history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-legacy-"));
  try {
    const file = path.join(root, "state.json");
    const storage = new AppApiStorage(file);
    const { startHandoff } = await import("./handoff-state.ts");
    const record = startHandoff(
      {
        id: "h",
        pluginId: "p",
        toolId: "t",
        workItemId: "i",
        projectId: "p",
        folderId: "f",
        title: "Title",
      },
      { threadId: "t", native: {} },
      1,
    );
    await storage.addHandoff(record);
    const state = JSON.parse(await readFile(file, "utf8"));
    state.handoffs[0].history = [
      {
        state: "ready",
        at: 2,
        native: { status: "ready", label: "Ready", payload: "x".repeat(32000) },
      },
    ];
    await writeFile(file, JSON.stringify(state));
    expect(await new AppApiStorage(file).listHandoffs()).toMatchObject([
      {
        id: "h",
        history: [{ state: "ready", at: 2, status: "ready", label: "Ready" }],
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("lets a manual refresh run after the active batch before the remaining tick batches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-queue-"));
  try {
    const storage = new AppApiStorage(path.join(root, "state.json"));
    let now = 1;
    const calls: string[] = [];
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const service = new Handoffs({
      storage,
      now: () => now,
      onChange() {},
      plugins: {
        async listPlugins() {
          return [
            {
              id: "p",
              capabilities: { handoff: { tools: [{ id: "a" }, { id: "b" }] } },
            },
          ];
        },
        async startHandoff() {
          return { threadId: "t", native: {} };
        },
        async readHandoffStates(_plugin, request) {
          calls.push(request.tool);
          if (calls.length === 1) {
            started();
            await gate;
          }
          return request.handoffs.map((h) => ({
            id: h.id,
            state: "working" as const,
            native: {},
          }));
        },
      },
    });
    const folder = await storage.addRepositoryFolder("p", root, "Repo");
    const input = {
      pluginId: "p",
      toolId: "a",
      projectId: "p",
      folderId: folder.id,
      workItemId: "i",
      title: "Title",
      prompt: "P",
      item: { key: "", url: "" },
      settings: {},
    };
    const a = await service.start(input);
    await service.start({ ...input, toolId: "b" });
    service.setVisible(true);
    now = 31000;
    const tick = service.tick();
    await active;
    const manual = service.refresh(a.id);
    // Storage reads have completed before this FIFO marker is admitted.
    await storage.listHandoffs();
    await new Promise((resolve) => setImmediate(resolve));
    now = 32000;
    release();
    await Promise.all([tick, manual]);
    expect(calls).toEqual(["a", "a", "b"]);
    expect((await storage.listHandoffs()).map((h) => h.checkedAt)).toEqual([
      32000, 32000,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
