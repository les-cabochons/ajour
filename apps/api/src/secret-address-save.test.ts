import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createAppApiServer } from "./server.ts";
import { AppApiStorage } from "./storage.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * Saving a connection whose only address is a secret one (an ICS feed): the
 * plugin never sees the address, so the save refuses a user name or password
 * in it, in plain words that don't repeat the address.
 */

const FEED = "https://calendar.example.org/feeds/9d1c4b7e/basic.ics";
const ICON = "<svg viewBox='0 0 16 16' />";

const MANIFEST = {
  id: "fixture-ics",
  version: "4.0.0",
  apiVersion: 4,
  displayName: "Fixture ICS",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  connectionFields: [
    {
      id: "feedUrl",
      label: "Calendar address",
      type: "password",
      required: true,
      secret: true,
    },
  ],
  capabilities: { calendar: {} },
  network: { auth: { scheme: "secretAddress", secretField: "feedUrl" } },
  connectionAccess: [],
};

const PLUGIN_SOURCE = `
export async function validateConnection(connection) {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}
`;

describe("saving a connection with a secret address", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function setup() {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-secret-addr-"));
    tempDirs.push(root);
    const pluginDirectory = path.join(root, "fixture-ics");
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(
      path.join(pluginDirectory, "plugin.json"),
      JSON.stringify(MANIFEST),
    );
    await writeFile(path.join(pluginDirectory, "plugin.mjs"), PLUGIN_SOURCE);
    const sink = createRecordingSink<AjourEvent>();
    const statePath = path.join(root, "state.json");
    const vault = new MemorySecretVault();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault,
      statePath,
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      projectDataShapePluginDirectories: [],
      allowDevelopmentPlugins: true,
      pluginRuntime: new InProcessPluginRuntime(),
      brokerActivityWindowMs: 0,
      eventSink: sink,
    });
    return { server, statePath, vault, sink };
  }

  async function save(
    server: ReturnType<typeof createAppApiServer>,
    feedUrl: string,
    id?: string,
  ) {
    return await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/fixture-ics/connections",
      body: JSON.stringify({
        ...(id ? { id } : {}),
        values: {
          label: "Team calendar",
          tenantLabel: "Team",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          feedUrl,
        },
      }),
    });
  }

  it("saves an address without a user name or password", async () => {
    const { server } = await setup();

    const saved = await save(server, FEED);

    expect(saved.status).toBe(200);
  });

  it.each([
    "https://me:pw@calendar.example.org/feeds/9d1c4b7e/basic.ics",
    "https://me@calendar.example.org/feeds/9d1c4b7e/basic.ics",
    "webcal://me:pw@calendar.example.org/feeds/9d1c4b7e/basic.ics",
    "WEBCALS://me:pw@calendar.example.org/feeds/9d1c4b7e/basic.ics",
    "  https://me:pw@calendar.example.org/feeds/9d1c4b7e/basic.ics  ",
  ])(
    "refuses %s with a message that doesn't repeat it, and saves nothing",
    async (address) => {
      const { server, statePath, vault, sink } = await setup();

      const saved = await save(server, address);

      expect(saved.status).toBe(400);
      expect(saved.body).toEqual({
        error: 'Remove the user name and password from "Calendar address".',
      });
      expect(
        await new AppApiStorage(statePath).listConnections("fixture-ics"),
      ).toEqual([]);
      expect(JSON.stringify([saved.body, sink.events])).not.toMatch(
        /\bme\b|pw|example|9d1c4b7e/,
      );
      expect(vault.contents()).toEqual([]);
    },
  );

  it("keeps a saved address when an edit leaves the field empty", async () => {
    const { server } = await setup();
    const first = await save(server, FEED);
    const id = (first.body as { connection: { id: string } }).connection.id;

    const edited = await save(server, "", id);

    expect(edited.status).toBe(200);
  });
});
