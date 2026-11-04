import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createAppApiServer } from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";
import {
  exampleProjectSourceDirectory,
  FIXTURE_CURSOR,
  fixtureSnapshot,
} from "../../../packages/example/index.ts";

/*
 * The project source route (#504): `POST .../sync-projects` runs a plugin
 * API 4 plugin's `syncProjects` with the cursor Ajour kept for the
 * connection, validates the snapshot, and keeps the cursor it answers.
 */

const ICON = "<svg viewBox='0 0 16 16' />";

/** A development plugin that only declares the capability `capabilities` holds. */
function manifest(capabilities: Record<string, unknown>) {
  return {
    id: "planner",
    version: "4.0.0",
    apiVersion: 4,
    displayName: "Planner",
    iconSvg: ICON,
    entrypoint: "plugin.mjs",
    connectionFields: [
      { id: "label", label: "Label", type: "text", required: true },
      { id: "tenantLabel", label: "Workspace", type: "text", required: true },
      { id: "serviceUrl", label: "Service URL", type: "url", required: true },
    ],
    capabilities,
  };
}

/**
 * The fixture plugin answers whatever the test put on a global, and keeps
 * every request it received there too.
 */
const PLUGIN_SOURCE = `
export async function validateConnection(connection) {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}
export async function syncProjects(connection, request) {
  (globalThis.__plannerSeen ??= []).push(request);
  const answer = globalThis.__plannerAnswer;
  if (answer instanceof Error) throw answer;
  return answer;
}
`;

const snapshot = {
  source: { label: "Planner", url: "https://planner.example" },
  asOf: "2026-10-31T23:59:59.000Z",
  me: { hoursAvailable: true },
  projects: [
    {
      remoteId: "ACME-SUP",
      name: "Acme - Support",
      code: "ACME-SUP",
      complete: false,
      budget: { unit: "hours", total: 40, consumed: 31.5, status: "warning" },
      tasks: [
        { remoteId: "1001", name: "Login", closed: false, assigned: true },
        { remoteId: "1002", name: "Export", closed: true, assigned: false },
      ],
    },
    {
      remoteId: "GLOBEX",
      name: "Globex",
      code: "GLOBEX",
      complete: true,
      tasks: [
        { remoteId: "2001", name: "Review", closed: false, assigned: true },
      ],
    },
  ],
};

type Fixture = { __plannerSeen?: unknown[]; __plannerAnswer?: unknown };
const fixture = globalThis as Fixture;

describe("the project source sync route", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) server.emit("close");
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
    delete fixture.__plannerSeen;
    delete fixture.__plannerAnswer;
  });

  /**
   * A server with the fixture plugin declaring `capabilities`, or with the
   * example project source of `packages/example` when `pluginDirectory`
   * names it, and one saved connection.
   */
  async function setup(
    capabilities: Record<string, unknown> = { projectSource: {} },
    pluginDirectory?: string,
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-project-source-"));
    tempDirs.push(root);
    const pluginId = pluginDirectory ? "example-project-source" : "planner";
    if (!pluginDirectory) {
      pluginDirectory = path.join(root, pluginId);
      await mkdir(pluginDirectory, { recursive: true });
      await writeFile(
        path.join(pluginDirectory, "plugin.json"),
        JSON.stringify(manifest(capabilities)),
      );
      await writeFile(path.join(pluginDirectory, "plugin.mjs"), PLUGIN_SOURCE);
    }
    const sink = createRecordingSink<AjourEvent>();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      projectDataShapePluginDirectories: [],
      allowDevelopmentPlugins: true,
      pluginRuntime: new InProcessPluginRuntime(),
      eventSink: sink,
    });
    servers.push(server);
    const saved = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/${pluginId}/connections`,
      body: JSON.stringify({
        values: {
          label: "Planner",
          tenantLabel: "Acme",
          autoSync: true,
          autoSyncIntervalMinutes: 15,
          serviceUrl: "https://planner.example",
        },
      }),
    });
    expect(saved.status).toBe(200);
    const connectionId = (saved.body as { connection: { id: string } })
      .connection.id;
    const sync = (trigger: "manual" | "auto" = "manual") =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/${pluginId}/connections/${connectionId}/sync-projects`,
        body: JSON.stringify({ trigger }),
      });
    const connectionSummary = async () => {
      const overview = await dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/plugins",
      });
      return (
        overview.body as {
          connectionGroups: {
            connections: { lastError?: string; lastSyncAt?: number }[];
          }[];
        }
      ).connectionGroups[0]!.connections[0]!;
    };
    const seen = () => fixture.__plannerSeen ?? [];
    return { server, sink, connectionId, sync, connectionSummary, seen };
  }

  it("answers the snapshot, keeps the cursor and sends it next time", async () => {
    const { sync, seen, sink, connectionId } = await setup();

    fixture.__plannerAnswer = { snapshot, cursor: 'W/"v1"' };
    const first = await sync();

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      connection: { id: connectionId, lastSyncAt: expect.any(Number) },
      snapshot,
    });
    expect(seen()).toEqual([{}]);

    fixture.__plannerAnswer = { unchanged: true };
    const second = await sync("auto");

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      connection: { id: connectionId },
      unchanged: true,
    });
    expect(second.body).not.toHaveProperty("snapshot");
    expect(seen()).toEqual([{}, { cursor: 'W/"v1"' }]);

    // An unchanged answer keeps the cursor; a new snapshot replaces it.
    fixture.__plannerAnswer = { snapshot, cursor: 'W/"v2"' };
    await sync();
    fixture.__plannerAnswer = { unchanged: true };
    await sync();
    expect(seen().at(-2)).toEqual({ cursor: 'W/"v1"' });
    expect(seen().at(-1)).toEqual({ cursor: 'W/"v2"' });

    // One event per request, with counts and no names.
    const events = sink.events.filter(
      (event) =>
        event.name === "project_source.sync" && event.kind === "request",
    );
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      outcome: "ok",
      plugin: { id: "planner" },
      connection: { id: connectionId },
      project_source_sync: {
        trigger: "manual",
        has_cursor: false,
        unchanged: false,
        project_count: 2,
        task_count: 3,
        has_next_cursor: true,
      },
    });
    expect(events[1]).toMatchObject({
      outcome: "ok",
      project_source_sync: {
        trigger: "auto",
        has_cursor: true,
        unchanged: true,
      },
    });
    expect(JSON.stringify(events)).not.toContain("Acme");
  });

  it("starts over without a cursor once the connection is saved again", async () => {
    const { server, sync, seen, connectionId } = await setup();
    fixture.__plannerAnswer = { snapshot, cursor: 'W/"v1"' };
    await sync();

    const saved = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/planner/connections",
      body: JSON.stringify({
        id: connectionId,
        values: {
          label: "Planner",
          tenantLabel: "Acme",
          autoSync: true,
          autoSyncIntervalMinutes: 15,
          serviceUrl: "https://planner.example/other",
        },
      }),
    });
    expect(saved.status).toBe(200);
    await sync();

    expect(seen()).toEqual([{}, {}]);
  });

  it("keeps the snapshot a snapshot without a cursor, and sends none next time", async () => {
    const { sync, seen } = await setup();
    fixture.__plannerAnswer = { snapshot, cursor: 'W/"v1"' };
    await sync();
    fixture.__plannerAnswer = { snapshot };
    await sync();
    await sync();

    expect(seen()).toEqual([{}, { cursor: 'W/"v1"' }, {}]);
  });

  it("surfaces the plugin's error on the connection", async () => {
    const { sync, connectionSummary, sink } = await setup();
    fixture.__plannerAnswer = new Error("The token was revoked or expired.");

    const response = await sync();

    expect(response).toEqual({
      status: 502,
      body: { error: "The token was revoked or expired." },
    });
    expect(await connectionSummary()).toMatchObject({
      lastError: "The token was revoked or expired.",
    });
    expect(
      sink.events.find(
        (event) =>
          event.name === "project_source.sync" && event.kind === "request",
      ),
    ).toMatchObject({
      outcome: "error",
      error: { type: "Error", message: "The token was revoked or expired." },
    });
  });

  it("refuses a bad snapshot, naming the field", async () => {
    const { sync } = await setup();
    const task = { remoteId: "1", name: "Login", closed: false };
    fixture.__plannerAnswer = {
      snapshot: {
        ...snapshot,
        projects: [{ ...snapshot.projects[0], tasks: [task] }],
      },
    };

    const response = await sync();

    expect(response.status).toBe(502);
    expect((response.body as { error: string }).error).toBe(
      "The plugin's result is not valid: snapshot.projects[0].tasks[0].assigned: Required.",
    );
  });

  it("refuses an unchanged answer when it sent no cursor", async () => {
    const { sync, seen } = await setup();
    fixture.__plannerAnswer = { unchanged: true };

    const response = await sync();

    expect(seen()).toEqual([{}]);
    expect(response).toEqual({
      status: 502,
      body: {
        error:
          "The plugin reported no change, but Ajour sent it no cursor to compare with.",
      },
    });
  });

  it("refuses a plugin without the capability", async () => {
    const { sync } = await setup({ connector: {} });

    expect(await sync()).toEqual({
      status: 409,
      body: { error: "This plugin does not provide projects from a source." },
    });
  });

  it("loads the example project source of packages/example and syncs its fixture", async () => {
    const { sync, seen } = await setup({}, exampleProjectSourceDirectory);

    const first = await sync();
    const second = await sync();

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ snapshot: fixtureSnapshot });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ unchanged: true });
    // The example plugin runs from the package folder, not the fixture above.
    expect(seen()).toEqual([]);
    expect(FIXTURE_CURSOR).toMatch(/^W\//);
  });
});
