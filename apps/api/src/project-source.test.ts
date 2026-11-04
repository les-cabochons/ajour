import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { projectSourceManifest } from "../../../packages/example/project-source.ts";
import { createAppApiServer } from "./server.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(source?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-project-source-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const pluginDir = path.join(root, "plugin");
  await mkdir(pluginDir);
  await writeFile(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify({ ...projectSourceManifest, entrypoint: "plugin.ts" }),
  );
  await writeFile(
    path.join(pluginDir, "plugin.ts"),
    source ??
      (await readFile(
        new URL("../../../packages/example/project-source.ts", import.meta.url),
        "utf8",
      )),
  );
  const sink = createRecordingSink<AjourEvent>();
  const options = {
    eventSink: sink,
    ...windowServerOptions,
    vault: new MemorySecretVault(),
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    developmentPluginDirectories: [pluginDir],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
  };
  const start = () => {
    const server = createAppApiServer(options);
    cleanups.push(async () => {
      server.emit("close");
    });
    return server;
  };
  const server = start();
  const saved = await dispatchJsonRequest(server, {
    method: "POST",
    path: "/api/plugins/example-project-source/connections",
    body: JSON.stringify({
      values: {
        label: "Work",
        tenantLabel: "Planning",
        autoSync: false,
        autoSyncIntervalMinutes: 10,
      },
    }),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const id = (saved.body as { connection: { id: string } }).connection.id;
  const sync = (target = server) =>
    dispatchJsonRequest(target, {
      method: "POST",
      path: `/api/plugins/example-project-source/connections/${id}/sync-projects`,
      body: "{}",
    });
  return { server, start, sync, id, events: sink.events };
}
it("loads the example source, returns a snapshot, and keeps its cursor across restart", async () => {
  const { sync, start, events } = await setup();
  expect(await sync()).toMatchObject({
    status: 200,
    body: {
      cursor: "fixture-1",
      snapshot: { projects: [{ remoteId: "project-1" }] },
    },
  });
  expect(await sync()).toMatchObject({
    status: 200,
    body: { unchanged: true },
  });
  expect(await sync(start())).toMatchObject({
    status: 200,
    body: { unchanged: true },
  });
  expect(events.filter((e) => e.name === "project_source.sync")).toHaveLength(
    6,
  );
  expect(JSON.stringify(events)).not.toMatch(
    /Example project|fixture-1|Development/,
  );
});

it("surfaces plugin errors and refuses invalid snapshots with their field path", async () => {
  const validation =
    "export function validateConnection(c) { return { normalizedConfig: c.config }; }";
  const failed = await setup(
    `${validation}\nexport function syncProjects() { throw new Error('Source unavailable'); }`,
  );
  expect(await failed.sync()).toMatchObject({
    status: 502,
    body: { error: expect.stringContaining("Source unavailable") },
  });
  const invalid = await setup(
    `${validation}\nexport function syncProjects(c, request) { if (request.cursor) throw new Error('Invalid cursor was saved'); return { snapshot: { source: { label: 'Planning' }, asOf: 'yesterday', projects: [] }, cursor: 'must-not-save' }; }`,
  );
  expect(await invalid.sync()).toMatchObject({
    status: 502,
    body: { error: expect.stringContaining("asOf") },
  });
  expect(await invalid.sync(invalid.start())).toMatchObject({
    status: 502,
    body: { error: expect.stringContaining("asOf") },
  });
});

it("refuses inactive sources, missing connections and disabled capabilities", async () => {
  const { server, sync } = await setup();
  const missing =
    "/api/plugins/example-project-source/connections/missing/sync-projects";
  expect(
    await dispatchJsonRequest(server, {
      method: "POST",
      path: missing,
      body: "{}",
    }),
  ).toMatchObject({ status: 404 });
  const activationPath = "/api/plugins/example-project-source/activation";
  expect(
    await dispatchJsonRequest(server, {
      method: "POST",
      path: activationPath,
      body: JSON.stringify({ enabled: false, capability: "projectSource" }),
    }),
  ).toMatchObject({ status: 200 });
  expect(await sync()).toMatchObject({ status: 409 });
  await dispatchJsonRequest(server, {
    method: "POST",
    path: activationPath,
    body: JSON.stringify({ enabled: true, capability: "projectSource" }),
  });
  await dispatchJsonRequest(server, {
    method: "POST",
    path: activationPath,
    body: JSON.stringify({ enabled: false }),
  });
  expect(await sync()).toMatchObject({ status: 409 });
});

it("rejects caller cursors and clears the cursor after connection settings change", async () => {
  const { server, sync, id } = await setup();
  const route = `/api/plugins/example-project-source/connections/${id}`;
  expect(
    await dispatchJsonRequest(server, {
      method: "POST",
      path: `${route}/sync-projects`,
      body: JSON.stringify({ cursor: "caller-value" }),
    }),
  ).toMatchObject({ status: 400 });
  expect(await sync()).toMatchObject({
    status: 200,
    body: { cursor: "fixture-1" },
  });
  const saved = await dispatchJsonRequest(server, {
    method: "POST",
    path: "/api/plugins/example-project-source/connections",
    body: JSON.stringify({
      id,
      values: {
        label: "Updated",
        tenantLabel: "Planning",
        autoSync: false,
        autoSyncIntervalMinutes: 10,
      },
    }),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(await sync()).toMatchObject({
    status: 200,
    body: { snapshot: { projects: [{ remoteId: "project-1" }] } },
  });
});
