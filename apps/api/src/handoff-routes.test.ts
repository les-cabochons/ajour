import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  createAppApiServer,
  addRepositoryFolderForServer,
  stopAppApiServer,
} from "./server.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

it("starts, reads, refreshes and removes a fake tool's thread without logging content, and preserves refused starts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-routes-"));
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  await mkdir(path.join(root, "repo"));
  await writeFile(
    path.join(plugin, "plugin.json"),
    JSON.stringify({
      id: "handoff",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test tools",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [],
      capabilities: {
        handoff: {
          promptTemplate: "Plugin {{item.title}}",
          tools: ["t3", "other"].map((id) => ({
            id,
            label: id,
            iconSvg: "<svg/>",
            settings: [],
          })),
        },
      },
    }),
  );
  await writeFile(
    path.join(plugin, "plugin.mjs"),
    `
export function detectTools() { return { tools: [{ id: 't3', available: true }] }; }
export function startHandoff(request) { if (request.title === 'unsafe') return { threadId: 'bad', native: {}, link: 'javascript:alert(1)' }; if (request.title === 'refuse') throw new Error('Tool says no'); return { threadId: request.title === 'fail-refresh' ? 'fail' : 'thread', native: { label: 'CANARY-HANDOFF' }, link: 'https://example.test/CANARY-HANDOFF' }; }
export function readHandoffStates(request) { if (request.handoffs.some(h => h.threadId === "fail")) throw new Error("Refresh refused by tool"); return request.handoffs.map(h => ({ id: h.id, state: 'needs-you', native: { label: 'CANARY-HANDOFF' }, title: 'CANARY-HANDOFF', branch: 'CANARY-HANDOFF', pullRequests: [{ url: 'https://example.test/CANARY-HANDOFF' }] })); }
`,
  );
  const sink = createRecordingSink();
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(root, "data", "state.json"),
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
    developmentPluginDirectories: [plugin],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
    eventSink: sink,
  });
  const call = (method: string, route: string, body?: unknown) =>
    dispatchJsonRequest(server, {
      method,
      path: route,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    expect((await call("POST", "/api/handoffs/missing/refresh")).status).toBe(
      404,
    );
    const folder = await addRepositoryFolderForServer(
      server,
      "p",
      path.join(root, "repo"),
    );
    expect(
      (
        await call("POST", "/api/plugins/handoff/handoffs/detect", {
          projectId: "p",
        })
      ).status,
    ).toBe(200);
    const input = {
      pluginId: "handoff",
      toolId: "t3",
      workItemId: "i",
      projectId: "p",
      folderId: folder.id,
      projectName: "Project",
      item: {
        key: "CANARY-HANDOFF",
        title: "CANARY-HANDOFF",
        type: "Bug",
        url: "https://example.test/CANARY-HANDOFF",
      },
      settings: {},
    };
    const templatesPath = "/api/plugins/handoff/handoffs/templates";
    expect((await call("GET", templatesPath)).body).toMatchObject({
      prompt: "Plugin {{item.title}}",
      title: "[{{item.key}}] {{item.title}}",
      branch: "{{item.key|slug}}-{{item.title|slug}}",
    });
    const templates = {
      prompt: "{{item.title}}",
      title: "{{item.title}}",
      branch: "{{item.key|slug}}",
    };
    const invalid = await call("POST", templatesPath, {
      ...templates,
      title: "{{item.unknown}}",
    });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(invalid.body)).toContain("item.unknown");
    expect((await call("POST", templatesPath, templates)).status).toBe(200);
    expect((await call("GET", templatesPath)).body).toEqual(templates);
    expect(
      (
        await call("POST", "/api/handoffs", {
          ...input,
          prompt: "Old finished prompt",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", templatesPath, {
          ...templates,
          prompt: "x".repeat(16385),
        })
      ).status,
    ).toBe(400);
    for (const branch of [
      "bad name",
      "@",
      "a..b",
      "-option",
      "a.lock",
      "a/.hidden",
      "a/",
      "a\\b",
    ]) {
      await call("POST", templatesPath, { ...templates, branch });
      const refused = await call("POST", "/api/handoffs", input);
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
      expect(JSON.stringify(refused.body)).toContain("branch template");
    }
    await call("POST", templatesPath, { ...templates, branch: "" });
    const noBranch = await call("POST", "/api/handoffs", input);
    expect(noBranch.status).toBe(200);
    expect(noBranch.body).not.toHaveProperty("branch");
    await call(
      "DELETE",
      `/api/handoffs/${(noBranch.body as { id: string }).id}`,
    );
    await call("POST", templatesPath, {
      ...templates,
      title: "{{item.title}}😀suffix",
      branch: "valid",
    });
    const bounded = await call("POST", "/api/handoffs", {
      ...input,
      branchOverride: "",
      item: { ...input.item, title: "a".repeat(499) },
    });
    expect(bounded.status, JSON.stringify(bounded.body)).toBe(200);
    expect(bounded.body).toMatchObject({ title: "a".repeat(499) });
    expect(bounded.body).not.toHaveProperty("branch");
    await call(
      "DELETE",
      `/api/handoffs/${(bounded.body as { id: string }).id}`,
    );
    await call("POST", templatesPath, templates);
    const multiline = await call("POST", "/api/handoffs", {
      ...input,
      branchOverride: "feature/override",
      item: { ...input.item, title: "first\r\nsecond\nthird" },
    });
    expect(multiline.body).toMatchObject({
      title: "first second third",
      branch: "feature/override",
    });
    await call(
      "DELETE",
      `/api/handoffs/${(multiline.body as { id: string }).id}`,
    );
    expect(
      (
        await call("POST", "/api/handoffs", {
          ...input,
          branchOverride: "bad branch",
        })
      ).status,
    ).toBe(400);
    const started = await call("POST", "/api/handoffs", input);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body).toMatchObject({
      state: "working",
      threadId: "thread",
      history: [],
    });
    const id = (started.body as { id: string }).id;
    const refused = await call("POST", "/api/handoffs", {
      ...input,
      item: { ...input.item, title: "refuse" },
    });
    expect(refused).toMatchObject({
      status: 409,
      body: { error: "Tool says no" },
    });
    expect(
      (
        await call("POST", "/api/handoffs", {
          ...input,
          item: { ...input.item, title: "unsafe" },
        })
      ).status,
    ).toBe(409);
    expect((await call("GET", "/api/handoffs")).body).toHaveLength(1);
    expect(
      (await call("POST", `/api/handoffs/${id}/refresh`)).body,
    ).toMatchObject({
      handoffs: [
        {
          state: "needs-you",
          history: [{ state: "needs-you" }],
          branch: "CANARY-HANDOFF",
        },
      ],
      failures: [],
    });
    expect(
      (await call("POST", "/api/handoffs", { ...input, projectId: "other" }))
        .status,
    ).toBe(409);
    expect((await call("DELETE", `/api/handoffs/${id}`)).body).toEqual([]);
    await call("POST", "/api/handoffs", {
      ...input,
      item: { ...input.item, title: "fail-refresh" },
    });
    const allFailed = await call("POST", "/api/handoffs/refresh");
    expect(allFailed.body).toHaveProperty(
      "error",
      "t3: Refresh refused by tool",
    );
    expect(allFailed).toMatchObject({
      status: 409,
      body: { failures: [{ toolId: "t3", reason: "Refresh refused by tool" }] },
    });
    await call("POST", "/api/handoffs", { ...input, toolId: "other" });
    const partial = await call("POST", "/api/handoffs/refresh");
    expect(partial).toMatchObject({
      status: 200,
      body: {
        failures: [{ toolId: "t3", reason: "Refresh refused by tool" }],
        handoffs: [{ state: "working" }, { state: "needs-you" }],
      },
    });
    const events = sink.events;
    expect(events.map((e) => e.name)).toEqual(
      expect.arrayContaining([
        "handoff.start",
        "handoff.refresh",
        "handoff.remove",
        "handoff.detect",
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("CANARY-HANDOFF");
  } finally {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

it("opens a handoff through its link, else its resume command, behind the broker's gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-open-"));
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  await mkdir(path.join(root, "repo"));
  await writeFile(
    path.join(plugin, "plugin.json"),
    JSON.stringify({
      id: "handoff",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test tools",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [],
      processes: {
        executables: { t3: { names: ["t3"] } },
        commands: [
          {
            id: "resume",
            executable: "t3",
            args: ["thread", "open", "{thread:id}", "{folder:folder}"],
            mode: "terminal",
          },
        ],
        openSchemes: [],
      },
      capabilities: {
        handoff: {
          tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
        },
      },
    }),
  );
  await writeFile(
    path.join(plugin, "plugin.mjs"),
    `
export function detectTools() { return { tools: [{ id: 't3', available: true }] }; }
export function startHandoff(request) {
  if (request.title === 'resume') return { threadId: 'r', native: {}, resume: { command: 'resume', args: { thread: 'r' } } };
  return { threadId: 'l', native: {}, link: 'https://example.test/thread' };
}
export function readHandoffStates(request) { return request.handoffs.map(h => ({ id: h.id, state: 'working', native: {} })); }
`,
  );
  const opened: string[] = [];
  const sink = createRecordingSink();
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(root, "data", "state.json"),
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
    developmentPluginDirectories: [plugin],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
    openExternal: async (url) => {
      opened.push(url);
    },
    eventSink: sink,
  });
  const call = (method: string, route: string, body?: unknown) =>
    dispatchJsonRequest(server, {
      method,
      path: route,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    // The user allows the plugin's access, its commands included.
    expect(
      (
        await call("POST", "/api/plugins/handoff/activation", {
          enabled: true,
          version: "1.0.0",
        })
      ).status,
    ).toBe(200);
    const folder = await addRepositoryFolderForServer(
      server,
      "p",
      path.join(root, "repo"),
    );
    const input = {
      pluginId: "handoff",
      toolId: "t3",
      workItemId: "i",
      projectId: "p",
      folderId: folder.id,
      projectName: "Project",
      item: { key: "K-1", title: "link", type: "Bug", url: "" },
      branchOverride: "",
      settings: {},
    };
    await call("POST", "/api/plugins/handoff/handoffs/templates", {
      prompt: "{{item.title}}",
      title: "{{item.title}}",
      branch: "",
    });
    const link = await call("POST", "/api/handoffs", input);
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const linkId = (link.body as { id: string }).id;
    expect(await call("POST", `/api/handoffs/${linkId}/open`)).toMatchObject({
      status: 200,
      body: { opened: "link" },
    });
    expect(opened).toEqual(["https://example.test/thread"]);

    const resume = await call("POST", "/api/handoffs", {
      ...input,
      item: { ...input.item, title: "resume" },
    });
    expect(resume.status, JSON.stringify(resume.body)).toBe(200);
    const resumeId = (resume.body as { id: string }).id;
    // A development plugin starts no process until the user allows it.
    expect(await call("POST", `/api/handoffs/${resumeId}/open`)).toMatchObject({
      status: 409,
      body: { error: expect.stringContaining("Settings › Plugins") },
    });
    // At most five terminals a minute per plugin, as for links.
    for (let i = 0; i < 4; i++)
      await call("POST", `/api/handoffs/${resumeId}/open`);
    expect(await call("POST", `/api/handoffs/${resumeId}/open`)).toMatchObject({
      status: 409,
      body: { error: expect.stringContaining("Too many threads") },
    });
    expect(
      sink.events.filter((e) => e.name === "handoff.open").at(-1),
    ).toMatchObject({ outcome_reason: "rate_limit" });
    expect((await call("POST", "/api/handoffs/missing/open")).status).toBe(404);
    expect(sink.events.map((e) => e.name)).toContain("handoff.open");
  } finally {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

it("starts a tool that doesn't follow state as started, with a plugin that has no state read, and refuses to refresh it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-started-"));
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  await mkdir(path.join(root, "repo"));
  await writeFile(
    path.join(plugin, "plugin.json"),
    JSON.stringify({
      id: "handoff",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test tools",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [],
      capabilities: {
        handoff: {
          tools: [
            {
              id: "copilot",
              label: "Copilot CLI",
              iconSvg: "<svg/>",
              settings: [],
              followsState: false,
            },
          ],
        },
      },
      // Another tool's start could receive a hook; the overview says so.
      processes: {
        executables: { claude: { names: ["claude"] } },
        commands: [
          {
            id: "start",
            executable: "claude",
            args: ["--hook", "{hook:hook-url}"],
            mode: "detached",
          },
        ],
      },
    }),
  );
  // No readHandoffStates: no tool of the plugin follows state.
  await writeFile(
    path.join(plugin, "plugin.mjs"),
    `export function startHandoff(request) { return { threadId: 'thread', native: {} }; }`,
  );
  const sink = createRecordingSink();
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(root, "data", "state.json"),
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
    developmentPluginDirectories: [plugin],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
    eventSink: sink,
  });
  const call = (method: string, route: string, body?: unknown) =>
    dispatchJsonRequest(server, {
      method,
      path: route,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const folder = await addRepositoryFolderForServer(
      server,
      "p",
      path.join(root, "repo"),
    );
    expect(
      (await call("GET", "/api/plugins")).body as {
        connectionGroups: Array<{ plugin: { id: string } }>;
      },
    ).toMatchObject({
      connectionGroups: [
        {
          plugin: {
            id: "handoff",
            capabilities: {
              handoff: { tools: [{ id: "copilot", followsState: false }] },
            },
          },
          handoffHooks: true,
        },
      ],
    });
    const started = await call("POST", "/api/handoffs", {
      pluginId: "handoff",
      toolId: "copilot",
      workItemId: "i",
      projectId: "p",
      folderId: folder.id,
      projectName: "Project",
      item: { key: "PAY-12", title: "Fix login", type: "Bug", url: "" },
      settings: {},
    });
    expect(started).toMatchObject({ status: 200, body: { state: "started" } });
    const id = (started.body as { id: string }).id;
    expect(await call("POST", "/api/handoffs/refresh")).toMatchObject({
      status: 200,
      body: { failures: [], handoffs: [{ id, state: "started" }] },
    });
    const single = await call("POST", `/api/handoffs/${id}/refresh`);
    expect(single).toMatchObject({
      status: 409,
      body: {
        error:
          "Copilot CLI doesn't report progress here; open it there to follow it.",
      },
    });
    expect(
      sink.events.filter(
        (event) =>
          event.name === "handoff.refresh" &&
          event.outcome_reason === "handoff_refused",
      ),
    ).toHaveLength(1);
    // Nothing asked the plugin for a state it doesn't export.
    expect(
      sink.events.filter(
        (event) =>
          event.name === "handoff.refresh" && event.kind === "plugin_operation",
      ),
    ).toEqual([]);
  } finally {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  }
});
