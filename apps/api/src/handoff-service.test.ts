import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { Handoffs } from "./handoffs.ts";
import { AppApiStorage } from "./storage.ts";
import type { Handoff } from "../../../packages/shared/handoffs.ts";

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
          if (request.title.endsWith("refuse"))
            throw new Error("Tool unavailable");
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
      projectName: "Project",
      item: { key: "PAY-12", title: "one", type: "Bug", url: "" },
      settings: {},
    };
    await service.start(input);
    await service.start({ ...input, item: { ...input.item, title: "two" } });
    await expect(
      service.start({ ...input, item: { ...input.item, title: "refuse" } }),
    ).rejects.toThrow("Tool unavailable");
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
    let snapshot: Handoff[] = [];
    const service = new Handoffs({
      storage,
      now: () => now,
      onChange: (records) => {
        snapshot = records;
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
          return { threadId: "t", native: { sessionKey: "opaque" } };
        },
        async readHandoffStates(_plugin, request) {
          calls.push(request.tool);
          expect(
            request.handoffs.every((h) => h.native.sessionKey === "opaque"),
          ).toBe(true);
          now += 100;
          if (mode === "fail" && request.tool === "a")
            throw new Error("Tool A unavailable");
          return request.handoffs.map((h) => ({
            id: h.id,
            state: "ready" as const,
            native: h.native,
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
      projectName: "Project",
      item: { key: "", title: "Title", type: "", url: "" },
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
      const previousCalls = [...calls];
      mode = unavailable;
      now += 120000;
      await service.tick();
      const records = await storage.listHandoffs();
      expect(records.every((h) => h.state === "unknown")).toBe(true);
      expect(records.every((h) => h.native.sessionKey === "opaque")).toBe(true);
      const reason =
        unavailable === "missing"
          ? "The handoff plugin is unavailable."
          : unavailable === "disabled"
            ? "Plugin is disabled."
            : "The handoff tool was removed.";
      expect(records.every((h) => h.paused?.reason === reason)).toBe(true);
      expect(records.every((h) => h.paused?.since === now)).toBe(true);
      expect(snapshot).toEqual(records);
      expect(
        await new AppApiStorage(path.join(root, "state.json")).listHandoffs(),
      ).toEqual(records);
      const published = writes;
      now += 120000;
      await service.tick();
      expect(writes).toBe(published);
      expect(await storage.listHandoffs()).toEqual(records);
      expect(calls).toEqual(previousCalls);
      mode = "ok";
      now += 120000;
      await service.tick();
      expect(calls).toEqual([...previousCalls, "a", "b"]);
      expect(
        (await storage.listHandoffs()).every(
          (h) => h.state === "ready" && h.paused === undefined,
        ),
      ).toBe(true);
    }
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

it("retains a legacy handoff with a 5 KB native and replaces it on refresh", async () => {
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
    state.handoffs[0].native = {
      status: "s".repeat(80),
      label: "l".repeat(240),
      payload: "x".repeat(5120),
    };
    await writeFile(file, JSON.stringify(state));
    const reloaded = new AppApiStorage(file);
    expect(await reloaded.listHandoffs()).toEqual([
      {
        ...record,
        native: {
          status: "s".repeat(64),
          label: "l".repeat(200),
          truncated: true,
        },
      },
    ]);
    const service = new Handoffs({
      storage: reloaded,
      now: () => 3,
      onChange() {},
      plugins: {
        async listPlugins() {
          return [
            { id: "p", capabilities: { handoff: { tools: [{ id: "t" }] } } },
          ];
        },
        async startHandoff() {
          throw new Error("Unused");
        },
        async readHandoffStates(_plugin, request) {
          expect(request.handoffs[0]?.native).toEqual({
            status: "s".repeat(64),
            label: "l".repeat(200),
            truncated: true,
          });
          return [{ id: "h", state: "ready", native: { session: "fresh" } }];
        },
      },
    });
    expect(await service.refresh("h")).toEqual({ succeeded: 1, failures: [] });
    expect((await new AppApiStorage(file).listHandoffs())[0]?.native).toEqual({
      session: "fresh",
    });
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
      projectName: "Project",
      item: { key: "", title: "Title", type: "", url: "" },
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

it("splits a large tool group into refresh batches below the runtime's result limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoffs-"));
  try {
    const storage = new AppApiStorage(path.join(root, "state.json"));
    const folder = await storage.addRepositoryFolder("p", root, "Repo");
    const calls: number[] = [];
    const service = new Handoffs({
      storage,
      refreshBatchSize: 2,
      onChange: () => {},
      plugins: {
        async listPlugins() {
          return [
            {
              id: "agent",
              capabilities: { handoff: { tools: [{ id: "t3" }] } },
            },
          ];
        },
        async startHandoff(_plugin, request) {
          return { threadId: request.title, native: {} };
        },
        async readHandoffStates(_plugin, request) {
          calls.push(request.handoffs.length);
          return request.handoffs.map((h) => ({
            id: h.id,
            state: "ready" as const,
            native: {},
          }));
        },
      },
    });
    for (const title of ["one", "two", "three", "four", "five"])
      await service.start({
        pluginId: "agent",
        toolId: "t3",
        projectId: "p",
        folderId: folder.id,
        workItemId: title,
        projectName: "Project",
        item: { key: title, title, type: "", url: "" },
        settings: {},
      });
    await service.refresh();
    expect(calls).toEqual([2, 2, 1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("fills persisted templates at start, preserves overrides and bounds titles before calling the plugin", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-templates-"));
  try {
    const statePath = path.join(root, "state.json");
    const storage = new AppApiStorage(statePath);
    const folder = await storage.addRepositoryFolder("p", root, "Repo");
    await storage.setHandoffTemplates("agent", {
      prompt: "{{item.description}} {{project.name}} {{repo.name}}",
      title: "{{item.title}}",
      branch: "{{item.key|slug}}",
    });
    const reopened = new AppApiStorage(statePath);
    expect(await reopened.getHandoffTemplates("agent")).toMatchObject({
      branch: "{{item.key|slug}}",
    });
    let received: unknown;
    let calls = 0;
    const service = new Handoffs({
      storage: reopened,
      onChange: () => {},
      plugins: {
        listPlugins: async () => [
          {
            id: "agent",
            capabilities: {
              handoff: {
                promptTemplate: "Plugin {{item.title}}",
                tools: [{ id: "t3" }],
              },
            },
          },
        ],
        startHandoff: async (_id, request) => {
          received = request;
          calls++;
          return { threadId: "thread", native: {} };
        },
        readHandoffStates: async () => [],
      },
    });
    const input = {
      pluginId: "agent",
      toolId: "t3",
      projectId: "p",
      projectName: "Project",
      folderId: folder.id,
      workItemId: "item",
      item: {
        key: "PAY-12",
        title: "Fix",
        type: "Bug",
        url: "",
        description: "---\ntimelog: private\n---\nBody",
      },
      settings: {},
    };
    await service.start(input);
    expect(received).toMatchObject({
      prompt: "Body Project Repo",
      title: "Fix",
      branch: "pay-12",
      item: { key: "PAY-12", url: "" },
    });
    await service.start({ ...input, promptOverride: "One-off prompt" });
    expect(received).toMatchObject({
      prompt: "One-off prompt",
      title: "Fix",
      branch: "pay-12",
    });
    expect(await reopened.getHandoffTemplates("agent")).toMatchObject({
      prompt: "{{item.description}} {{project.name}} {{repo.name}}",
    });
    await reopened.setHandoffTemplates("agent", {
      prompt: "P",
      title: "x".repeat(501),
      branch: "B",
    });
    await service.start(input);
    expect(received).toMatchObject({ title: "x".repeat(500) });
    expect(calls).toBe(3);
    // An empty filled title falls back to the item's title.
    await reopened.setHandoffTemplates("agent", {
      prompt: "P",
      title: "{{item.parent.title}}",
      branch: "",
    });
    await service.start(input);
    expect(received).toMatchObject({ title: "Fix" });
    expect(received).not.toHaveProperty("branch");
    // An empty filled prompt is refused with the template named, before the plugin.
    await reopened.setHandoffTemplates("agent", {
      prompt: "{{item.parent.key}}",
      title: "T",
      branch: "",
    });
    await expect(service.start(input)).rejects.toThrow(/prompt template/);
    expect(calls).toBe(4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("revokes a hook token when a refresh updates a handoff done or gone for 24 hours", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-hook-expiry-"));
  try {
    const storage = new AppApiStorage(path.join(root, "state.json"));
    const { startHandoff } = await import("./handoff-state.ts");
    const base = {
      pluginId: "p",
      toolId: "t",
      workItemId: "i",
      projectId: "p",
      folderId: "f",
      title: "Title",
    };
    const hash = "a".repeat(64);
    for (const id of ["recent", "old"])
      await storage.addHandoff(
        startHandoff({ ...base, id }, { threadId: id, native: {} }, 1),
        hash,
      );
    const update = (id: string, state: "done" | "gone" | "working") => ({
      id,
      state,
      native: {},
      paused: undefined,
    });
    const hour = 3_600_000;
    await storage.updateHandoffs(
      [update("recent", "done"), update("old", "gone")],
      10,
    );

    // Within the day a done thread may start again, and keeps its token.
    await storage.updateHandoffs([update("recent", "working")], 10 + 23 * hour);
    expect(await storage.findHandoffHook("recent")).toBeDefined();

    // After it, the update that would bring it back revokes the token first.
    await storage.updateHandoffs([update("old", "working")], 10 + 25 * hour);
    expect(await storage.findHandoffHook("old")).toBeUndefined();
    expect(
      (await storage.listHandoffs()).find((h) => h.id === "old")?.state,
    ).toBe("working");
    expect(await storage.findHandoffHook("recent")).toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
