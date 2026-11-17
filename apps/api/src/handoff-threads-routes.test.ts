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
import { turnOnServerHandoffTools } from "./test-support/handoff-tool-switches.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

const KEY = "CANARY-THREAD-12";

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-threads-routes-"));
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  const repo = path.join(root, "CANARY-THREAD-REPO");
  await mkdir(repo);
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
              id: "t3",
              label: "T3",
              iconSvg: "<svg/>",
              settings: [],
              listsThreads: true,
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    path.join(plugin, "plugin.mjs"),
    `
export function listThreads(request) {
  if (request.folder.path !== undefined) throw new Error('A listing never gets a path.');
  return { threads: [
    { threadId: 'linked', title: '[${KEY}] First', native: { label: 'CANARY-THREAD-NATIVE' }, link: 'https://example.test/CANARY-THREAD-LINK', updatedAt: 2 },
    { threadId: 'dismissed', title: '[${KEY}] Second', native: {}, updatedAt: 1 },
  ] };
}
export function readHandoffStates(request) {
  return request.handoffs.map(h => ({ id: h.id, state: 'ready', native: { label: 'CANARY-THREAD-NATIVE' } }));
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
  return { root, repo, sink, server, call };
}

it("offers, links and dismisses a tool's listed threads without logging titles, keys or paths", async () => {
  const { root, repo, sink, server, call } = await setup();
  try {
    const folder = await addRepositoryFolderForServer(server, "p", repo);
    await turnOnServerHandoffTools(server, { handoff: ["t3"] });
    const found = await call("POST", "/api/handoffs/threads", {
      projectId: "p",
      workItemId: "item",
      keys: [KEY],
    });
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body).toEqual({
      offers: [
        {
          pluginId: "handoff",
          toolId: "t3",
          folderId: folder.id,
          threadId: "linked",
          title: `[${KEY}] First`,
          updatedAt: 2,
        },
        {
          pluginId: "handoff",
          toolId: "t3",
          folderId: folder.id,
          threadId: "dismissed",
          title: `[${KEY}] Second`,
          updatedAt: 1,
        },
      ],
    });
    const adopt = {
      pluginId: "handoff",
      toolId: "t3",
      folderId: folder.id,
      threadId: "linked",
      projectId: "p",
      workItemId: "item",
    };
    const linked = await call("POST", "/api/handoffs/adopt", adopt);
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(linked.body).toMatchObject({
      threadId: "linked",
      workItemId: "item",
      state: "ready",
      link: "https://example.test/CANARY-THREAD-LINK",
    });
    expect((await call("GET", "/api/handoffs")).body).toHaveLength(1);
    expect(
      await call("POST", "/api/handoffs/adopt", {
        ...adopt,
        workItemId: "other",
      }),
    ).toMatchObject({
      status: 409,
      body: { error: "This thread is already linked to an item." },
    });
    expect(
      (
        await call("POST", "/api/handoffs/threads/dismiss", {
          pluginId: "handoff",
          toolId: "t3",
          threadId: "dismissed",
          workItemId: "item",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", "/api/handoffs/threads", {
          projectId: "p",
          workItemId: "item",
          keys: [KEY],
        })
      ).body,
    ).toEqual({ offers: [] });
    expect(
      (
        await call("POST", "/api/handoffs/adopt", {
          ...adopt,
          path: "C:\\elsewhere",
        })
      ).status,
    ).toBe(400);

    const names = sink.events.map((event) => event.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "handoff.threads",
        "handoff.adopt",
        "handoff.dismiss_thread",
        "handoff.refresh",
      ]),
    );
    const listing = sink.events.find(
      (event) =>
        event.name === "handoff.threads" && event.kind === "plugin_operation",
    );
    expect(listing).toMatchObject({ outcome: "ok" });
    const firstFind = sink.events.find(
      (event) => event.name === "handoff.threads" && event.kind === "request",
    );
    expect(firstFind).toMatchObject({
      handoff: { listed: 1, failed: 0, count: 2 },
    });
    const refused = sink.events.filter(
      (event) =>
        event.name === "handoff.adopt" &&
        event.outcome_reason === "handoff_refused",
    );
    expect(refused).toHaveLength(1);
    expect(JSON.stringify(sink.events)).not.toContain("CANARY-THREAD");
  } finally {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses an item named with a project other than its handoffs', for finding and linking", async () => {
  const { root, repo, server, call } = await setup();
  try {
    const folder = await addRepositoryFolderForServer(server, "p", repo);
    await turnOnServerHandoffTools(server, { handoff: ["t3"] });
    const other = path.join(root, "other-repo");
    await mkdir(other);
    const otherFolder = await addRepositoryFolderForServer(server, "q", other);
    await turnOnServerHandoffTools(server, { handoff: ["t3"] });
    const find = (projectId: string, workItemId: string) =>
      call("POST", "/api/handoffs/threads", {
        projectId,
        workItemId,
        keys: [KEY],
      });
    expect((await find("p", "item")).status).toBe(200);
    const linked = await call("POST", "/api/handoffs/adopt", {
      pluginId: "handoff",
      toolId: "t3",
      folderId: folder.id,
      threadId: "linked",
      projectId: "p",
      workItemId: "item",
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);

    // The item's handoff is in p: its keys never match q's threads.
    expect(await find("q", "item")).toMatchObject({
      status: 409,
      body: { error: "This item's threads are in another project." },
    });
    expect(
      await call("POST", "/api/handoffs/adopt", {
        pluginId: "handoff",
        toolId: "t3",
        folderId: otherFolder.id,
        threadId: "dismissed",
        projectId: "q",
        workItemId: "item",
      }),
    ).toMatchObject({
      status: 409,
      body: { error: "This item's threads are in another project." },
    });
    // An item without handoffs is taken at the window's word.
    expect((await find("q", "fresh")).status).toBe(200);
    expect((await call("GET", "/api/handoffs")).body).toHaveLength(1);
  } finally {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses keys no title's bracketed token could hold", async () => {
  const { root, repo, server, call } = await setup();
  try {
    await addRepositoryFolderForServer(server, "p", repo);
    await turnOnServerHandoffTools(server, { handoff: ["t3"] });
    for (const keys of [
      [""],
      [`[${KEY}]`],
      [`${KEY}]`],
      [`${KEY}\n`],
      [` ${KEY}`],
      [`${KEY}\u0000`],
      [`${KEY}\u202e`],
      [KEY, KEY],
      ["a".repeat(501)],
      ["a", "b", "c", "d", "e"],
    ]) {
      const found = await call("POST", "/api/handoffs/threads", {
        projectId: "p",
        workItemId: "item",
        keys,
      });
      expect(found.status, JSON.stringify(keys)).toBe(400);
    }
    expect(
      (
        await call("POST", "/api/handoffs/threads", {
          projectId: "p",
          workItemId: "item",
          keys: ["acme/api#12", "#12", "PAY-12"],
        })
      ).status,
    ).toBe(200);
  } finally {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  }
});
