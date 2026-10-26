import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  createAppApiServer,
  startAppApiServer,
  stopAppApiServer,
} from "./server.ts";
import type {
  PluginInvocation,
  PluginRuntime,
  PluginRuntimeHost,
  PluginTerminateReason,
  ReadyPlugin,
} from "./plugin-runtime.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * The renderer host's lifecycle, as the app API keeps it (#391, decided in
 * #217): at most 4 calls at once per plugin, a timeout that counts against
 * the plugin, a crash budget of 3 stops in 10 minutes that suspends it until
 * Turn back on, "Always ready" plugins kept running, the Advanced section's
 * Start and Memory ceiling, and a quit that lets running calls finish.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

function manifest(id: string, runtime?: Record<string, unknown>) {
  return {
    id,
    version: "4.0.0",
    apiVersion: 4,
    displayName: id,
    iconSvg: ICON,
    entrypoint: "plugin.mjs",
    connectionFields: [
      { id: "site", label: "Site", type: "text", required: true },
    ],
    capabilities: { connector: {} },
    ...(runtime ? { runtime } : {}),
  };
}

const API3_MANIFEST = {
  id: "classic",
  version: "1.0.0",
  apiVersion: 3,
  displayName: "Classic",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [
    { id: "label", label: "Label", type: "text", required: true },
    { id: "tenantLabel", label: "Site", type: "text", required: true },
  ],
};

/** A sync waits on the test's hold, when it set one, for its plugin. */
const SOURCE = `
export async function validateConnection(connection) {
  return { normalizedConfig: connection.config ?? connection, connectionSummary: {} };
}
export async function syncConnection(connection) {
  const hold = globalThis.__lifecycleHolds?.[connection.pluginId ?? "classic"];
  if (hold) await hold();
  return { items: [] };
}
`;

type Holds = Record<string, (() => Promise<void>) | undefined>;
const holds: Holds = {};
(globalThis as { __lifecycleHolds?: Holds }).__lifecycleHolds = holds;

/** Holds every sync of `pluginId` until `release` is called. */
function holdSyncs(pluginId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = 0;
  holds[pluginId] = async () => {
    started += 1;
    await released;
  };
  return {
    release: () => {
      release();
      holds[pluginId] = undefined;
    },
    started: () => started,
  };
}

/** A stand-in for the renderer runtime, which records what the API asks of it. */
function rendererRuntime() {
  const inProcess = new InProcessPluginRuntime();
  const seen: {
    host?: PluginRuntimeHost;
    invocations: PluginInvocation[];
    terminated: PluginTerminateReason[];
    ready: (readonly ReadyPlugin[])[];
    /** The plugins each `keepReady` said can't run now. */
    stopped: (readonly string[])[];
  } = { invocations: [], terminated: [], ready: [], stopped: [] };
  const runtime: PluginRuntime = {
    runsPluginApi4: true,
    unavailableReason: () => undefined,
    attach: (host) => {
      seen.host = host;
    },
    start: (invocation) => {
      seen.invocations.push(invocation);
      const run = inProcess.start(invocation);
      return {
        settled: run.settled,
        terminate: async (reason) => {
          seen.terminated.push(reason);
          await run.terminate(reason);
        },
      };
    },
    keepReady: (plugins, stopped = []) => {
      seen.ready.push(plugins);
      seen.stopped.push(stopped);
    },
  };
  return { runtime, seen };
}

const until = async (condition: () => boolean, ms = 2_000) => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

interface Group {
  plugin: { id: string };
  enabled: boolean;
  runtime?: unknown;
  suspended?: { cause: string; at: number };
}

describe("the renderer host's lifecycle, through the app API", () => {
  const directories: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const key of Object.keys(holds)) holds[key] = undefined;
    await Promise.all(
      servers
        .splice(0)
        .map((server) => stopAppApiServer(server).catch(() => undefined)),
    );
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function setup(
    options: {
      plugins?: Record<string, unknown>[];
      timeoutMs?: number;
      listen?: boolean;
      drainMs?: number;
    } = {},
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-lifecycle-api-"));
    directories.push(root);
    const plugins = options.plugins ?? [manifest("tracker")];
    const pluginDirectories = [];
    for (const plugin of plugins) {
      const directory = path.join(root, String(plugin.id));
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "plugin.json"),
        JSON.stringify(plugin),
      );
      await writeFile(path.join(directory, "plugin.mjs"), SOURCE);
      pluginDirectories.push(directory);
    }
    const fake = rendererRuntime();
    const clock = { now: 1_700_000_000_000 };
    const sink = createRecordingSink<AjourEvent>();
    const serverOptions = {
      ...windowServerOptions,
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: pluginDirectories,
      projectDataShapePluginDirectories: [],
      allowDevelopmentPlugins: true,
      pluginRuntime: new InProcessPluginRuntime(),
      pluginApi4Runtime: fake.runtime,
      brokerActivityWindowMs: 0,
      pluginClock: () => clock.now,
      eventSink: sink,
      ...(options.timeoutMs
        ? { pluginRequestTimeoutMs: options.timeoutMs }
        : {}),
      ...(options.drainMs !== undefined
        ? { pluginDrainMs: options.drainMs }
        : {}),
    };
    const server = options.listen
      ? await startAppApiServer({
          ...serverOptions,
          host: "127.0.0.1",
          port: 0,
        })
      : createAppApiServer(serverOptions);
    servers.push(server);
    const request = async (method: string, url: string, body?: unknown) =>
      dispatchJsonRequest(server, {
        method,
        path: url,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const group = async (pluginId: string) =>
      (
        (await request("GET", "/api/plugins")).body as {
          connectionGroups: Group[];
        }
      ).connectionGroups.find((candidate) => candidate.plugin.id === pluginId)!;
    const connect = async (pluginId: string) => {
      const saved = await request(
        "POST",
        `/api/plugins/${pluginId}/connections`,
        {
          values: {
            label: "Work",
            tenantLabel: "Acme",
            autoSync: false,
            autoSyncIntervalMinutes: 15,
            site: "acme",
          },
        },
      );
      expect(saved.status).toBe(200);
      const connectionId = (saved.body as { connection: { id: string } })
        .connection.id;
      return () =>
        request(
          "POST",
          `/api/plugins/${pluginId}/connections/${connectionId}/sync`,
          { trigger: "manual", workItems: [] },
        ) as Promise<{
          status: number;
          body: { connection?: { lastError?: string } };
        }>;
    };
    return { server, request, group, connect, fake, clock, sink, root };
  }

  describe("calls", () => {
    it("runs up to 4 calls of a plugin at once, and refuses a fifth while another plugin still runs", async () => {
      const { connect } = await setup({
        plugins: [manifest("tracker"), manifest("other")],
      });
      const sync = await connect("tracker");
      const otherSync = await connect("other");
      const held = holdSyncs("tracker");

      const running = Array.from({ length: 4 }, () => sync());
      await until(() => held.started() === 4);

      const refused = await sync();
      expect(refused.body.connection?.lastError).toBe(
        'Too many operations of plugin "tracker" are already running.',
      );
      expect((await otherSync()).body.connection?.lastError).toBeUndefined();

      held.release();
      for (const done of await Promise.all(running)) {
        expect(done.body.connection?.lastError).toBeUndefined();
      }
    });

    it("fails a call past its time, and asks the runtime to close the renderer", async () => {
      const { connect, fake } = await setup({ timeoutMs: 600 });
      const sync = await connect("tracker");
      holdSyncs("tracker");

      const timedOut = await sync();

      expect(timedOut.body.connection?.lastError).toBe(
        'Plugin "tracker" timed out while handling syncConnection.',
      );
      expect(fake.seen.terminated).toContain("timeout");
    });
  });

  describe("the crash budget", () => {
    it("suspends a plugin that stops 3 times in 10 minutes, and its calls then fail at once", async () => {
      const { connect, fake, group, clock, sink } = await setup();
      const sync = await connect("tracker");
      const host = fake.seen.host!;

      host.recordStopped!("tracker", "crashed", clock.now);
      clock.now += 4 * 60_000;
      host.recordStopped!("tracker", "killed", clock.now);
      expect((await group("tracker")).suspended).toBeUndefined();
      clock.now += 5 * 60_000;
      host.recordStopped!("tracker", "memory", clock.now);

      expect((await group("tracker")).suspended).toEqual({
        cause: "memory",
        at: clock.now,
      });
      const before = fake.seen.invocations.length;
      const refused = await sync();
      expect(refused.body.connection?.lastError).toBe(
        'Plugin "tracker" keeps stopping, so Ajour turned it off. Turn it back on from its page in Settings.',
      );
      // Its code never ran.
      expect(fake.seen.invocations.length).toBe(before);
      const suspended = sink.events.find(
        (event) => event.name === "plugin.suspended",
      );
      expect(suspended).toMatchObject({
        kind: "lifecycle",
        outcome: "ok",
        plugin: { id: "tracker" },
        suspension: { cause: "memory", stops: 3 },
      });
    });

    it("doesn't suspend for 3 stops spread over more than 10 minutes", async () => {
      const { connect, fake, group, clock } = await setup();
      const sync = await connect("tracker");
      const host = fake.seen.host!;

      host.recordStopped!("tracker", "crashed", clock.now);
      clock.now += 6 * 60_000;
      host.recordStopped!("tracker", "crashed", clock.now);
      clock.now += 5 * 60_000;
      host.recordStopped!("tracker", "crashed", clock.now);

      expect((await group("tracker")).suspended).toBeUndefined();
      expect((await sync()).body.connection?.lastError).toBeUndefined();
    });

    it("counts timeouts, and not cancelled calls", async () => {
      const { connect, group, request } = await setup({ timeoutMs: 600 });
      const sync = await connect("tracker");
      const held = holdSyncs("tracker");

      // Turning the plugin off cancels its call: that never counts.
      for (let index = 0; index < 3; index += 1) {
        const cancelled = sync();
        await until(() => held.started() === index + 1);
        await request("POST", "/api/plugins/tracker/activation", {
          enabled: false,
        });
        await cancelled;
        await request("POST", "/api/plugins/tracker/activation", {
          enabled: true,
        });
      }
      expect((await group("tracker")).suspended).toBeUndefined();

      for (let index = 0; index < 3; index += 1) await sync();

      expect((await group("tracker")).suspended).toMatchObject({
        cause: "timeout",
      });
    });

    it("runs a suspended plugin again once the user turns it back on", async () => {
      const { connect, fake, group, request, clock } = await setup();
      const sync = await connect("tracker");
      for (let index = 0; index < 3; index += 1) {
        fake.seen.host!.recordStopped!("tracker", "crashed", clock.now);
      }
      expect((await group("tracker")).suspended).toBeDefined();

      const resumed = await request("POST", "/api/plugins/tracker/resume");

      expect(resumed.status).toBe(200);
      const after = (
        resumed.body as { connectionGroups: Group[] }
      ).connectionGroups.find((candidate) => candidate.plugin.id === "tracker");
      expect(after?.suspended).toBeUndefined();
      expect((await sync()).body.connection?.lastError).toBeUndefined();
      // The budget starts over: one more stop doesn't suspend it again.
      fake.seen.host!.recordStopped!("tracker", "crashed", clock.now);
      expect((await group("tracker")).suspended).toBeUndefined();
    });
  });

  describe("start modes", () => {
    it('keeps an "Always ready" plugin running from the start, with its ceiling', async () => {
      const { fake } = await setup({
        plugins: [
          manifest("resident", { start: "alwaysReady", memoryCeilingMb: 128 }),
          manifest("tracker"),
        ],
      });

      await until(() => fake.seen.ready.length > 0);

      expect(readyOf(fake)).toEqual([
        {
          pluginId: "resident",
          lifecycle: { alwaysReady: true, memoryCeilingMb: 128 },
        },
      ]);
    });

    it('lets go of an "Always ready" plugin once it is turned off or suspended', async () => {
      const { fake, request, clock } = await setup({
        plugins: [manifest("resident", { start: "alwaysReady" })],
      });
      await until(() => readyOf(fake).length === 1);
      expect(fake.seen.stopped.at(-1)).toEqual([]);

      // A plugin that can't run is named, so its renderer closes at once.
      await request("POST", "/api/plugins/resident/activation", {
        enabled: false,
      });
      expect(readyOf(fake)).toEqual([]);
      expect(fake.seen.stopped.at(-1)).toEqual(["resident"]);

      await request("POST", "/api/plugins/resident/activation", {
        enabled: true,
      });
      expect(readyOf(fake)).toHaveLength(1);
      expect(fake.seen.stopped.at(-1)).toEqual([]);

      for (let index = 0; index < 3; index += 1) {
        fake.seen.host!.recordStopped!("resident", "crashed", clock.now);
      }
      await until(() => readyOf(fake).length === 0);
      expect(fake.seen.stopped.at(-1)).toEqual(["resident"]);

      await request("POST", "/api/plugins/resident/resume");
      expect(readyOf(fake)).toHaveLength(1);
      expect(fake.seen.stopped.at(-1)).toEqual([]);
    });
  });

  describe("what gates a plugin that is kept ready", () => {
    it('keeps an "Always ready" plugin held for consent off until the user allows it', async () => {
      const { fake, request, root } = await setup({
        plugins: [manifest("resident")],
      });
      // Turning it on records what the user allowed: a plugin that starts
      // when needed.
      await request("POST", "/api/plugins/resident/activation", {
        enabled: true,
      });
      expect(readyOf(fake)).toEqual([]);

      // An update since then makes it "Always ready", which reaches more.
      await writeFile(
        path.join(root, "resident", "plugin.json"),
        JSON.stringify(manifest("resident", { start: "alwaysReady" })),
      );
      // Anything that syncs the ready list, here the plugin system's switch.
      await request("POST", "/api/plugins/activation", { enabled: false });
      await request("POST", "/api/plugins/activation", { enabled: true });
      const held = await request("GET", "/api/plugins");
      expect(
        (
          held.body as {
            connectionGroups: {
              plugin: { id: string };
              pendingAccess?: unknown;
            }[];
          }
        ).connectionGroups.find((group) => group.plugin.id === "resident")
          ?.pendingAccess,
      ).toBeDefined();
      expect(readyOf(fake)).toEqual([]);
      expect(fake.seen.stopped.at(-1)).toEqual(["resident"]);

      await request("POST", "/api/plugins/resident/activation", {
        enabled: true,
      });
      expect(readyOf(fake).map((plugin) => plugin.pluginId)).toEqual([
        "resident",
      ]);
      expect(fake.seen.stopped.at(-1)).toEqual([]);
    });

    it('does not keep an unsigned "Always ready" plugin while unsigned plugins are deactivated', async () => {
      const { fake, request } = await setup({
        plugins: [manifest("resident", { start: "alwaysReady" })],
      });
      await until(() => readyOf(fake).length === 1);

      await request("POST", "/api/plugins/unsigned-activation", {
        enabled: false,
      });
      expect(readyOf(fake)).toEqual([]);
      expect(fake.seen.stopped.at(-1)).toEqual(["resident"]);

      await request("POST", "/api/plugins/unsigned-activation", {
        enabled: true,
      });
      expect(readyOf(fake).map((plugin) => plugin.pluginId)).toEqual([
        "resident",
      ]);
    });
  });

  describe("the Advanced section", () => {
    it("saves Start and Memory ceiling, which the next start reads", async () => {
      const { request, group, connect, fake } = await setup();
      const sync = await connect("tracker");
      expect((await group("tracker")).runtime).toEqual({
        declared: { start: "whenNeeded", memoryCeilingMb: 256 },
        settings: { start: "plugin" },
      });

      const saved = await request("POST", "/api/plugins/tracker/runtime", {
        start: "alwaysReady",
        memoryCeilingMb: 512,
      });

      expect(saved.status).toBe(200);
      expect((await group("tracker")).runtime).toEqual({
        declared: { start: "whenNeeded", memoryCeilingMb: 256 },
        settings: { start: "alwaysReady", memoryCeilingMb: 512 },
      });
      expect(readyOf(fake)).toEqual([
        {
          pluginId: "tracker",
          lifecycle: { alwaysReady: true, memoryCeilingMb: 512 },
        },
      ]);
      await sync();
      expect(fake.seen.invocations.at(-1)?.lifecycle).toEqual({
        alwaysReady: true,
        memoryCeilingMb: 512,
      });

      // Back to the plugin's choice and ceiling.
      await request("POST", "/api/plugins/tracker/runtime", {
        start: "plugin",
        memoryCeilingMb: null,
      });
      expect((await group("tracker")).runtime).toMatchObject({
        settings: { start: "plugin" },
      });
      expect(readyOf(fake)).toEqual([]);
    });

    it("keeps the user's ceiling over the manifest's", async () => {
      const { request, connect, fake } = await setup({
        plugins: [manifest("tracker", { memoryCeilingMb: 1024 })],
      });
      const sync = await connect("tracker");
      await sync();
      expect(fake.seen.invocations.at(-1)?.lifecycle?.memoryCeilingMb).toBe(
        1024,
      );

      await request("POST", "/api/plugins/tracker/runtime", {
        start: "plugin",
        memoryCeilingMb: 64,
      });
      await sync();

      expect(fake.seen.invocations.at(-1)?.lifecycle).toEqual({
        alwaysReady: false,
        memoryCeilingMb: 64,
      });
    });

    it("refuses a ceiling outside 64 MB to 2 GB, and a plugin that isn't API 4", async () => {
      const { request } = await setup({
        plugins: [manifest("tracker"), API3_MANIFEST],
      });

      for (const memoryCeilingMb of [63, 2049, 100.5]) {
        expect(
          (
            await request("POST", "/api/plugins/tracker/runtime", {
              start: "plugin",
              memoryCeilingMb,
            })
          ).status,
        ).toBe(400);
      }
      const classic = await request("POST", "/api/plugins/classic/runtime", {
        start: "alwaysReady",
        memoryCeilingMb: null,
      });
      expect(classic.status).toBe(400);
      expect(
        (
          await request("POST", "/api/plugins/missing/runtime", {
            start: "plugin",
            memoryCeilingMb: null,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe("quit", () => {
    it("lets a running call finish within the drain, and refuses new ones meanwhile", async () => {
      const { server, connect } = await setup({ listen: true, drainMs: 5_000 });
      const sync = await connect("tracker");
      const held = holdSyncs("tracker");
      const running = sync();
      await until(() => held.started() === 1);

      const stopping = stopAppApiServer(server);
      const late = await sync();
      setTimeout(() => held.release(), 150);
      await stopping;

      expect((await running).body.connection?.lastError).toBeUndefined();
      expect(late).toEqual({
        status: 503,
        body: { error: "App API is shutting down." },
      });
    });

    it("cancels a call still running when the drain ends", async () => {
      const { server, connect } = await setup({ listen: true, drainMs: 100 });
      const sync = await connect("tracker");
      const held = holdSyncs("tracker");
      const running = sync();
      await until(() => held.started() === 1);

      const startedAt = Date.now();
      await stopAppApiServer(server);

      expect(Date.now() - startedAt).toBeLessThan(2_000);
      // The sync ended with the stop, not with the plugin's result.
      expect(await running).toEqual({
        status: 400,
        body: { error: "Plugin host is shutting down." },
      });
      held.release();
    });
  });
});

function readyOf(fake: ReturnType<typeof rendererRuntime>) {
  return (fake.seen.ready.at(-1) ?? []).map((plugin) => ({
    pluginId: plugin.pluginId,
    lifecycle: plugin.lifecycle,
  }));
}
