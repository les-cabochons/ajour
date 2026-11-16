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
          tools: [{ id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] }],
        },
      },
    }),
  );
  await writeFile(
    path.join(plugin, "plugin.mjs"),
    `
export function detectTools() { return { tools: [{ id: 't3', available: true }] }; }
export function startHandoff(request) { if (request.title === 'refuse') throw new Error('Tool says no'); return { threadId: 'thread', native: { label: 'CANARY-HANDOFF' }, link: 'https://example.test/CANARY-HANDOFF' }; }
export function readHandoffStates(request) { return request.handoffs.map(h => ({ id: h.id, state: 'needs-you', native: { label: 'CANARY-HANDOFF' }, title: 'CANARY-HANDOFF', branch: 'CANARY-HANDOFF', pullRequests: [{ url: 'https://example.test/CANARY-HANDOFF' }] })); }
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
      title: "CANARY-HANDOFF",
      prompt: "CANARY-HANDOFF",
      item: {
        key: "CANARY-HANDOFF",
        url: "https://example.test/CANARY-HANDOFF",
      },
      settings: {},
    };
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
      title: "refuse",
    });
    expect(refused).toMatchObject({
      status: 409,
      body: { error: "Tool says no" },
    });
    expect((await call("GET", "/api/handoffs")).body).toHaveLength(1);
    expect(
      (await call("POST", `/api/handoffs/${id}/refresh`)).body,
    ).toMatchObject([
      {
        state: "needs-you",
        history: [{ state: "needs-you" }],
        branch: "CANARY-HANDOFF",
      },
    ]);
    expect(
      (await call("POST", "/api/handoffs", { ...input, projectId: "other" }))
        .status,
    ).toBe(409);
    expect((await call("DELETE", `/api/handoffs/${id}`)).body).toEqual([]);
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
