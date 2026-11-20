import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
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
import { turnOnServerHandoffTools } from "./test-support/handoff-tool-switches.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/**
 * Close through the real local API and plugin host (#850): the plugin's
 * `closeThread` gets the handoff as a state read does, the route forgets
 * the handoff once it answers, and a tool's refusal keeps it. No thread
 * content reaches an event.
 */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-close-routes-"));
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  const repo = path.join(root, "CANARY-CLOSE-REPO");
  await mkdir(repo);
  const closed = path.join(root, "closed.json");
  const tool = (id: string, extra: Record<string, unknown>) => ({
    id,
    label: id === "codex" ? "Codex" : "T3",
    iconSvg: "<svg/>",
    settings: [],
    ...extra,
  });
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
          tools: [tool("codex", { closesThreads: "archive" }), tool("t3", {})],
        },
      },
    }),
  );
  await writeFile(
    path.join(plugin, "plugin.mjs"),
    `
const closed = ${JSON.stringify(closed)};
export function startHandoff(request) {
  return { threadId: request.item.key, native: { label: 'CANARY-CLOSE-NATIVE' } };
}
export function readHandoffStates(request) {
  return request.handoffs.map(h => ({ id: h.id, state: 'working', native: h.native }));
}
export async function closeThread(request) {
  if (request.handoff.threadId === 'CANARY-CLOSE-REFUSED')
    throw new Error('The worktree has unpushed work.');
  globalThis.__closed = [...(globalThis.__closed ?? []), request];
  const { writeFile } = await import('node:fs/promises');
  await writeFile(closed, JSON.stringify(globalThis.__closed));
  return {};
}
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
  const start = async (toolId: string, key: string, folderId: string) => {
    const response = await call("POST", "/api/handoffs", {
      pluginId: "handoff",
      toolId,
      workItemId: "item",
      projectId: "p",
      folderId,
      projectName: "Project",
      item: { key, title: key, type: "Bug", url: "" },
      settings: {},
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return (response.body as { id: string }).id;
  };
  const closes = async () =>
    JSON.parse(await readFile(closed, "utf8").catch(() => "[]")) as unknown[];
  return { root, repo, sink, server, call, start, closes };
}

it("closes a thread in its tool and forgets the handoff, keeping it when the tool refuses", async () => {
  const { root, repo, sink, server, call, start, closes } = await setup();
  try {
    const folder = await addRepositoryFolderForServer(server, "p", repo);
    await turnOnServerHandoffTools(server, { handoff: ["codex", "t3"] });
    const open = await start("codex", "CANARY-CLOSE-OPEN", folder.id);
    const refused = await start("codex", "CANARY-CLOSE-REFUSED", folder.id);
    const t3 = await start("t3", "CANARY-CLOSE-T3", folder.id);

    const done = await call("POST", `/api/handoffs/${open}/close`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((done.body as Array<{ id: string }>).map((h) => h.id)).toEqual(
      expect.not.arrayContaining([open]),
    );
    expect(await closes()).toEqual([
      {
        tool: "codex",
        handoff: {
          id: open,
          threadId: "CANARY-CLOSE-OPEN",
          folderId: folder.id,
          native: { label: "CANARY-CLOSE-NATIVE" },
        },
      },
    ]);

    const kept = await call("POST", `/api/handoffs/${refused}/close`);
    expect(kept).toMatchObject({
      status: 409,
      body: { error: "The worktree has unpushed work." },
    });
    const notClosing = await call("POST", `/api/handoffs/${t3}/close`);
    expect(notClosing).toMatchObject({
      status: 409,
      body: {
        error: "T3 can't close its threads. Remove it from the item instead.",
      },
    });
    expect((await call("POST", "/api/handoffs/missing/close")).status).toBe(
      404,
    );
    const left = (await call("GET", "/api/handoffs")).body as Array<{
      id: string;
    }>;
    expect(left.map((h) => h.id).sort()).toEqual([refused, t3].sort());

    const requests = sink.events
      .filter(
        (event) => event.name === "handoff.close" && event.kind === "request",
      )
      .map(({ outcome, outcome_reason, plugin, handoff }) => ({
        outcome,
        outcome_reason,
        plugin,
        handoff,
      }));
    expect(requests).toEqual([
      {
        outcome: "ok",
        plugin: { id: "handoff" },
        handoff: { id: open, tool: "codex", closes: "archive" },
      },
      {
        outcome: "refused",
        outcome_reason: "handoff_refused",
        plugin: { id: "handoff" },
        handoff: { id: refused, tool: "codex" },
      },
      {
        outcome: "refused",
        outcome_reason: "handoff_refused",
        plugin: { id: "handoff" },
        handoff: { id: t3, tool: "t3" },
      },
      { outcome: "refused", handoff: { id: "missing" } },
    ]);
    const operations = sink.events.filter(
      (event) =>
        event.name === "handoff.close" && event.kind === "plugin_operation",
    );
    // Ajour refuses the tool that doesn't close threads before the plugin
    // runs. The tool's refusal is the plugin operation's error, as for a
    // start or a refresh.
    expect(
      operations.map((event) => [event.outcome, event.outcome_reason]),
    ).toEqual([
      ["ok", undefined],
      ["error", "plugin_error"],
    ]);
    expect(JSON.stringify(sink.events)).not.toContain("CANARY-CLOSE");
  } finally {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  }
});
