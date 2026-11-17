import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  addRepositoryFolderForServer,
  createAppApiServer,
  stopAppApiServer,
} from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

const MANIFEST = {
  id: "agent",
  version: "1.0.0",
  apiVersion: 4,
  displayName: "Agent handoff",
  description: "Test",
  iconSvg: "<svg/>",
  entrypoint: "plugin.mjs",
  connectionFields: [],
  capabilities: {
    handoff: {
      tools: [
        { id: "t3", label: "T3 Code", iconSvg: "<svg/>", settings: [] },
        { id: "codex", label: "Codex", iconSvg: "<svg/>", settings: [] },
      ],
    },
  },
};

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-switch-routes-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const handoff = path.join(root, "agent");
  await mkdir(handoff);
  await writeFile(path.join(handoff, "plugin.json"), JSON.stringify(MANIFEST));
  await writeFile(
    path.join(handoff, "plugin.mjs"),
    `
export function detectTools() { return { tools: [{ id: 't3', available: true }, { id: 'codex', available: true }] }; }
export function startHandoff(request) { return { threadId: request.tool + '-thread', native: {} }; }
export function readHandoffStates(request) { return request.handoffs.map(h => ({ id: h.id, state: 'working', native: {} })); }
`,
  );
  await mkdir(path.join(root, "repo"));
  const sink = createRecordingSink<AjourEvent>();
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(root, "data", "state.json"),
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
    developmentPluginDirectories: [handoff],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
    eventSink: sink,
  });
  onTestFinished(() => stopAppApiServer(server));
  const call = (method: string, route: string, body?: unknown) =>
    dispatchJsonRequest(server, {
      method,
      path: route,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const folder = await addRepositoryFolderForServer(
    server,
    "p",
    path.join(root, "repo"),
  );
  const start = (toolId: string) =>
    call("POST", "/api/handoffs", {
      pluginId: "agent",
      toolId,
      workItemId: "i",
      projectId: "p",
      folderId: folder.id,
      projectName: "Project",
      item: { key: "PAY-1", title: "Title", type: "Bug", url: "" },
      settings: {},
    });
  const overviewTools = async () =>
    (
      (await call("GET", "/api/plugins")).body as {
        connectionGroups: Array<{
          plugin: { id: string };
          enabledHandoffTools?: string[];
        }>;
      }
    ).connectionGroups.find((group) => group.plugin.id === "agent")
      ?.enabledHandoffTools;
  return { call, start, sink, overviewTools };
}

const toolsPath = "/api/plugins/agent/handoffs/tools";

it("starts every tool off, turns one on or off per device, and starts only the tools that are on", async () => {
  const { call, start, sink, overviewTools } = await setup();
  expect((await call("GET", toolsPath)).body).toEqual({ enabled: [] });
  expect(await overviewTools()).toEqual([]);

  const off = await start("t3");
  expect(off.status).toBe(409);
  expect(off.body).toEqual({
    error:
      "T3 Code is off. Turn it on in the plugin's Handoff tools to hand off to it.",
  });
  expect(
    (
      await call("POST", "/api/plugins/agent/handoffs/detect", {
        projectId: "p",
      })
    ).body,
  ).toEqual({ tools: [] });

  const on = await call("POST", toolsPath, { toolId: "t3", enabled: true });
  expect(on.status).toBe(200);
  expect(on.body).toEqual({ enabled: ["t3"] });
  expect(await overviewTools()).toEqual(["t3"]);
  expect((await start("t3")).status).toBe(200);
  expect((await start("codex")).status).toBe(409);
  expect(
    (
      await call("POST", "/api/plugins/agent/handoffs/detect", {
        projectId: "p",
      })
    ).body,
  ).toEqual({ tools: [{ id: "t3", available: true }] });

  // Off again: the handoff it started stays, and new starts are refused.
  expect(
    (await call("POST", toolsPath, { toolId: "t3", enabled: false })).body,
  ).toEqual({ enabled: [] });
  expect((await start("t3")).status).toBe(409);
  const kept = (await call("GET", "/api/handoffs")).body as Array<{
    toolId: string;
  }>;
  expect(kept.map((handoff) => handoff.toolId)).toEqual(["t3"]);
  expect((await call("POST", "/api/handoffs/refresh")).status).toBe(200);

  const updates = sink.events.filter(
    (event) => event.name === "handoff.tools_update",
  );
  expect(updates.map((event) => [event.kind, event.outcome])).toEqual([
    ["request", "ok"],
    ["request", "ok"],
  ]);
  expect(updates[0]).toMatchObject({
    plugin: { id: "agent" },
    handoff: { tool: "t3", enabled: true },
  });
  expect(updates[1]).toMatchObject({
    handoff: { tool: "t3", enabled: false },
  });
  expect(
    sink.events.find((event) => event.name === "handoff.tools_read"),
  ).toMatchObject({ kind: "request", outcome: "ok" });
});

it("refuses a tool the plugin doesn't declare, a malformed switch and a plugin without handoff tools", async () => {
  const { call, sink, overviewTools } = await setup();
  const unknown = await call("POST", toolsPath, {
    toolId: "claude",
    enabled: true,
  });
  expect(unknown.status).toBe(400);
  expect(unknown.body).toEqual({
    error: 'The plugin has no handoff tool "claude".',
  });
  expect(
    sink.events.find((event) => event.name === "handoff.tools_update"),
  ).toMatchObject({
    outcome: "refused",
    outcome_reason: "unknown_tool",
    handoff: { tool: "claude", enabled: true },
  });
  expect(
    (await call("POST", toolsPath, { toolId: "t3", enabled: "yes" })).status,
  ).toBe(400);
  expect(
    (
      await call("POST", "/api/plugins/missing/handoffs/tools", {
        toolId: "t3",
        enabled: true,
      })
    ).status,
  ).toBe(404);
  expect(
    (await call("GET", "/api/plugins/missing/handoffs/tools")).status,
  ).toBe(404);
  expect(await overviewTools()).toEqual([]);
});
