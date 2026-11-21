import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  exampleTrackerDirectory,
  exampleTrackerManifest,
} from "../../../packages/example/index.ts";
import { createAppApiServer } from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * The item types route (#848): `POST .../item-types` runs a backlog plugin's
 * `describeItemTypes` for the connection form, when the plugin declares
 * `connector.itemTypes`.
 */

describe("the item types route", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) server.emit("close");
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  /**
   * A server with the example tracker of `packages/example`, or, with
   * `withoutItemTypes`, a copy of its manifest that doesn't declare item
   * types, and one saved connection.
   */
  async function setup({ withoutItemTypes = false } = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-item-types-"));
    tempDirs.push(root);
    let pluginDirectory = exampleTrackerDirectory;
    if (withoutItemTypes) {
      pluginDirectory = path.join(root, "tracker");
      await mkdir(pluginDirectory, { recursive: true });
      await writeFile(
        path.join(pluginDirectory, "plugin.json"),
        JSON.stringify({
          ...exampleTrackerManifest,
          entrypoint: "plugin.mjs",
          capabilities: { connector: {} },
        }),
      );
      await writeFile(
        path.join(pluginDirectory, "plugin.mjs"),
        "export async function validateConnection(connection) { return { normalizedConfig: connection.config, connectionSummary: {} }; }",
      );
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
    const pluginId = exampleTrackerManifest.id;
    const saved = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/${pluginId}/connections`,
      body: JSON.stringify({
        values: {
          label: "Tracker",
          tenantLabel: "Acme",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          originalEstimateFieldName: "Effort",
        },
      }),
    });
    expect(saved.status).toBe(200);
    const connectionId = (saved.body as { connection: { id: string } })
      .connection.id;
    const describeTypes = (body: unknown) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/${pluginId}/connections/${connectionId}/item-types`,
        body: JSON.stringify(body),
      });
    return { sink, describeTypes };
  }

  it("answers the example tracker's types, and records counts without names", async () => {
    const { sink, describeTypes } = await setup();

    const response = await describeTypes({
      types: [{ name: "Task", sourceId: "TR-2" }, { name: "Defect" }],
    });

    expect(response.status).toBe(200);
    const { types } = response.body as {
      types: Array<{ name: string; suggestions?: object; iconSvg?: string }>;
    };
    expect(types.map((type) => type.name)).toEqual([
      "Story",
      "Task",
      "Bug",
      "Spike",
      "Epic",
    ]);
    expect(types.find((type) => type.name === "Task")).toMatchObject({
      iconSvg: expect.stringContaining("<svg"),
      suggestions: { originalEstimateFieldName: ["Original Estimate"] },
    });
    const request = sink.events.find(
      (event) =>
        event.name === "item_type.describe" && event.kind === "request",
    );
    expect(request).toMatchObject({
      outcome: "ok",
      plugin: { id: "example-tracker" },
      item_type: { requested_count: 2, result_count: 5 },
    });
    expect(JSON.stringify(sink.events)).not.toContain("Original Estimate");
    expect(
      sink.events.some(
        (event) =>
          event.name === "item_type.describe" &&
          event.kind === "plugin_operation" &&
          event.outcome === "ok",
      ),
    ).toBe(true);
  });

  it("refuses a plugin that doesn't declare item types", async () => {
    const { describeTypes } = await setup({ withoutItemTypes: true });

    await expect(describeTypes({ types: [] })).resolves.toEqual({
      status: 409,
      body: { error: "This plugin does not describe item types." },
    });
  });

  it("refuses a malformed request before the plugin runs", async () => {
    const { describeTypes } = await setup();

    const response = await describeTypes({ types: [{ name: "" }] });

    expect(response.status).toBe(400);
  });
});
