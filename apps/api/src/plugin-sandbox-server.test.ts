import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createAppApiServer } from "./server.ts";
import type { PluginRuntime, PluginRuntimeHost } from "./plugin-runtime.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * The sandboxed runtime, as the app API sees it (#390): while it can't run
 * plugins on this computer, the overview says why and no plugin runs, API 3
 * included, and what its sandbox blocked counts for Access review.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

const MANIFEST = {
  id: "tracker",
  version: "1.0.0",
  apiVersion: 3,
  displayName: "Tracker",
  description: "Test plugin.",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [
    { id: "label", label: "Label", type: "text", required: true },
    { id: "tenantLabel", label: "Site", type: "text", required: true },
  ],
};

const SOURCE = `
export async function validateConnection(config) {
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function syncConnection() {
  return { items: [] };
}
`;

/** A stand-in for the renderer runtime: its sandbox is on until the test says. */
function sandboxedRuntime() {
  const state: { reason?: string; host?: PluginRuntimeHost } = {};
  const inProcess = new InProcessPluginRuntime();
  const runtime: PluginRuntime = {
    runsPluginApi4: true,
    unavailableReason: () => state.reason,
    attach: (host) => {
      state.host = host;
    },
    start: (invocation) => inProcess.start(invocation),
  };
  return { runtime, state };
}

describe("plugins and their sandbox, through the app API", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function setup(pluginApi4Runtime?: PluginRuntime) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-sandbox-api-"));
    directories.push(root);
    const pluginDirectory = path.join(root, "tracker");
    await mkdir(pluginDirectory, { recursive: true });
    await writeFile(
      path.join(pluginDirectory, "plugin.json"),
      JSON.stringify(MANIFEST),
    );
    await writeFile(path.join(pluginDirectory, "plugin.mjs"), SOURCE);
    const statePath = path.join(root, "state.json");
    const server = createAppApiServer({
      ...windowServerOptions,
      statePath,
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      projectDataShapePluginDirectories: [],
      allowDevelopmentPlugins: true,
      pluginRuntime: new InProcessPluginRuntime(),
      brokerActivityWindowMs: 0,
      ...(pluginApi4Runtime ? { pluginApi4Runtime } : {}),
    });
    const overview = async () =>
      (
        await dispatchJsonRequest(server, {
          method: "GET",
          path: "/api/plugins",
        })
      ).body as {
        sandbox?: unknown;
        connectionGroups: { plugin: { id: string }; enabled: boolean }[];
      };
    const saved = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/tracker/connections",
      body: JSON.stringify({
        values: {
          label: "Work",
          tenantLabel: "Acme",
          autoSync: true,
          autoSyncIntervalMinutes: 15,
        },
      }),
    });
    expect(saved.status).toBe(200);
    const connectionId = (saved.body as { connection: { id: string } })
      .connection.id;
    const sync = () =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/tracker/connections/${connectionId}/sync`,
        body: JSON.stringify({ trigger: "manual", workItems: [] }),
      });
    return { server, statePath, overview, sync };
  }

  it("says the sandbox is on, and plugins run", async () => {
    const { runtime } = sandboxedRuntime();
    const { overview, sync } = await setup(runtime);

    const listed = await overview();
    expect(listed.sandbox).toEqual({ state: "on" });
    expect(listed.connectionGroups).toMatchObject([
      { plugin: { id: "tracker" }, enabled: true },
    ]);
    expect((await sync()).status).toBe(200);
  });

  it("turns every plugin off, API 3 included, with the reason, while the sandbox can't run", async () => {
    const { runtime, state } = sandboxedRuntime();
    const { overview, sync } = await setup(runtime);
    state.reason = "Ajour was started with --no-sandbox.";

    const listed = await overview();
    expect(listed.sandbox).toEqual({
      state: "off",
      reason: "Ajour was started with --no-sandbox.",
    });
    // Off, so automatic syncs pause; the connection stays.
    expect(listed.connectionGroups).toMatchObject([
      { plugin: { id: "tracker" }, enabled: false },
    ]);
    // The sync doesn't run, and its connection says why.
    const refused = await sync();
    expect(refused.body).toMatchObject({
      items: [],
      connection: {
        lastError:
          "Plugins are turned off: this computer can't run them in a sandbox. Ajour was started with --no-sandbox.",
      },
    });
  });

  it("counts what the sandbox blocked as the plugin's blocked attempts", async () => {
    const { runtime, state } = sandboxedRuntime();
    const { statePath } = await setup(runtime);

    await state.host!.recordBlocked("tracker", 1_700_000_000_000);

    const saved = JSON.parse(await readFile(statePath, "utf8")) as {
      pluginBrokerActivity: Record<string, unknown>;
    };
    expect(saved.pluginBrokerActivity.tracker).toMatchObject({
      blockedCount: 1,
      lastBlockedAt: 1_700_000_000_000,
    });
  });

  it("says nothing of a sandbox where plugins don't run in one", async () => {
    const { overview } = await setup();

    expect((await overview()).sandbox).toBeUndefined();
  });
});
