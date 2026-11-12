import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createAppApiServer, installPluginForServer } from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";
import {
  exampleProjectSourceDirectory,
  exampleProjectSourceManifest,
} from "../../../packages/example/index.ts";

/*
 * The time sync capability on the local API (#691): the Time entries
 * switch, which starts off and checks each connection before it turns on,
 * and `POST .../sync-time-entries`, which runs one round through the
 * plugin while the switch is on.
 */

const ICON = "<svg viewBox='0 0 16 16' />";

function manifest(
  capabilities: Record<string, unknown> = { projectSource: {}, timeSync: {} },
  version = "4.0.0",
) {
  return {
    id: "planner",
    version,
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
 * The fixture plugin keeps the capabilities each validation received, and
 * the requests each round received, on globals. It refuses a connection
 * while Time entries is on when a test sets a refusal, as a plugin does
 * with a token that can only read, and answers a round with what the test
 * put on a global.
 */
const PLUGIN_SOURCE = `
export async function validateConnection(connection, context) {
  (globalThis.__plannerValidated ??= []).push({
    serviceUrl: connection.config.serviceUrl,
    capabilities: context.capabilities,
  });
  const refusal = globalThis.__plannerRefusal;
  if (refusal && context.capabilities.includes("timeSync")) {
    throw new Error(refusal);
  }
  return { normalizedConfig: connection.config, connectionSummary: {} };
}
export async function syncTimeEntries(connection, request) {
  (globalThis.__plannerRounds ??= []).push(request);
  const answer = globalThis.__plannerAnswer;
  if (answer instanceof Error) throw answer;
  return answer;
}
`;

type Fixture = {
  __plannerValidated?: { serviceUrl: string; capabilities: string[] }[];
  __plannerRefusal?: string;
  __plannerRounds?: unknown[];
  __plannerAnswer?: unknown;
};
const fixture = globalThis as Fixture;

/** An edit of a saved entry and the running entry, as Ajour sends them. */
const changes = [
  {
    kind: "upsert",
    syncKey: "entry-1",
    remoteId: "te-41",
    values: {
      localDate: "2026-11-10",
      minutes: 90,
      running: false,
      projectRemoteId: "ACME-SUP",
      taskName: "Ticket #101 - Login",
      taskRemoteId: "1001",
    },
  },
  {
    kind: "upsert",
    syncKey: "running-7",
    values: {
      localDate: "2026-11-12",
      minutes: 25,
      running: true,
      countingSince: "2026-11-12T14:05:00.000Z",
      projectRemoteId: "ACME-SUP",
      taskName: "Code review",
    },
  },
];

const round = {
  from: "2026-10-12",
  to: "2026-11-15",
  timeZone: "America/Toronto",
  changes,
};

function remoteEntry(remoteId: string, syncKey: string, minutes: number) {
  return {
    remoteId,
    clientRef: syncKey,
    localDate: "2026-11-10",
    minutes,
    running: false,
    projectRemoteId: "ACME-SUP",
    taskName: "Ticket #101 - Login",
    updatedAt: "2026-11-12T14:30:00.000Z",
  };
}

describe("time sync on the local API", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) server.emit("close");
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
    delete fixture.__plannerValidated;
    delete fixture.__plannerRefusal;
    delete fixture.__plannerRounds;
    delete fixture.__plannerAnswer;
  });

  async function tempDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ajour-time-sync-"));
    tempDirs.push(dir);
    return dir;
  }

  async function writePlugin(directory: string, plugin = manifest()) {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "plugin.json"),
      JSON.stringify(plugin),
    );
    await writeFile(path.join(directory, "plugin.mjs"), PLUGIN_SOURCE);
  }

  /**
   * A server with the fixture plugin as a development plugin, or the example
   * plugin of `packages/example` when `exampleDirectory` names it, and one
   * saved connection.
   */
  async function setup(exampleDirectory?: string) {
    const root = await tempDir();
    const pluginId = exampleDirectory
      ? exampleProjectSourceManifest.id
      : "planner";
    const pluginDirectory = exampleDirectory ?? path.join(root, "planner");
    if (!exampleDirectory) await writePlugin(pluginDirectory);
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
    const save = async (serviceUrl: string) => {
      const saved = await dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/${pluginId}/connections`,
        body: JSON.stringify({
          values: {
            label: "Planner",
            tenantLabel: "Acme",
            autoSync: true,
            autoSyncIntervalMinutes: 15,
            serviceUrl,
          },
        }),
      });
      expect(saved.status).toBe(200);
      return (saved.body as { connection: { id: string } }).connection.id;
    };
    const connectionId = await save("https://planner.example");
    const setTimeEntries = (enabled: boolean) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/${pluginId}/activation`,
        body: JSON.stringify({ enabled, capability: "timeSync" }),
      });
    const group = async () => {
      const overview = await dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/plugins",
      });
      return (
        overview.body as {
          connectionGroups: {
            inactiveCapabilities?: string[];
            connections: { lastError?: string }[];
          }[];
        }
      ).connectionGroups[0]!;
    };
    const sync = (body: unknown = round) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/${pluginId}/connections/${connectionId}/sync-time-entries`,
        body: JSON.stringify(body),
      });
    const validated = () => fixture.__plannerValidated ?? [];
    const rounds = () => fixture.__plannerRounds ?? [];
    return {
      server,
      sink,
      connectionId,
      save,
      setTimeEntries,
      group,
      sync,
      validated,
      rounds,
    };
  }

  describe("the Time entries switch", () => {
    it("starts off while the plugin's other switches start on", async () => {
      const { group, validated } = await setup();

      expect((await group()).inactiveCapabilities).toEqual(["timeSync"]);
      // Saving the connection checked only the capability that is on.
      expect(validated()).toEqual([
        {
          serviceUrl: "https://planner.example",
          capabilities: ["projectSource"],
        },
      ]);
    });

    it("checks each connection with Time entries on before it turns on", async () => {
      const { save, setTimeEntries, group, validated } = await setup();
      await save("https://planner.example/other");
      fixture.__plannerValidated = [];

      const response = await setTimeEntries(true);

      expect(response.status).toBe(200);
      expect(validated()).toEqual([
        {
          serviceUrl: "https://planner.example",
          capabilities: ["projectSource", "timeSync"],
        },
        {
          serviceUrl: "https://planner.example/other",
          capabilities: ["projectSource", "timeSync"],
        },
      ]);
      expect((await group()).inactiveCapabilities).toEqual([]);
    });

    it("stays off when the plugin refuses a connection, with the plugin's sentence", async () => {
      const { setTimeEntries, group } = await setup();
      fixture.__plannerRefusal =
        "Time entries need a token that can write. This one can only read.";

      const response = await setTimeEntries(true);

      expect(response).toEqual({
        status: 400,
        body: {
          error:
            "Planner: Time entries need a token that can write. This one can only read.",
        },
      });
      expect((await group()).inactiveCapabilities).toEqual(["timeSync"]);
    });

    it("starts off after an update that adds it", async () => {
      const root = await tempDir();
      const statePath = path.join(root, "state.json");
      const installedRoot = path.join(root, "installed");
      await writePlugin(
        path.join(installedRoot, "planner"),
        manifest({ projectSource: {} }),
      );
      const source = path.join(root, "source");
      await writePlugin(source, manifest(undefined, "4.1.0"));
      const archivePath = path.join(root, "planner-4.1.0.ajour-connector");
      await create({ cwd: source, file: archivePath, gzip: true }, [
        "plugin.json",
        "plugin.mjs",
      ]);
      const server = createAppApiServer({
        ...windowServerOptions,
        vault: new MemorySecretVault(),
        statePath,
        installedPluginDirectory: installedRoot,
        allowDevelopmentPlugins: false,
        pluginRuntime: new InProcessPluginRuntime(),
      });
      servers.push(server);

      const update = await installPluginForServer(
        server,
        await readFile(archivePath),
        path.basename(archivePath),
      );

      expect(update.replaced).toBe(true);
      expect(update.overview.connectionGroups).toEqual([
        expect.objectContaining({ inactiveCapabilities: ["timeSync"] }),
      ]);
    });
  });

  describe("the sync-time-entries route", () => {
    it("runs one round through the plugin while Time entries is on", async () => {
      const { setTimeEntries, sync, rounds, sink, connectionId } =
        await setup();
      await setTimeEntries(true);
      const answer = {
        results: [
          {
            syncKey: "entry-1",
            status: "synced",
            entry: remoteEntry("te-41", "entry-1", 90),
          },
          {
            syncKey: "running-7",
            status: "failed",
            message: "Planner did not answer in time.",
          },
        ],
        entries: [
          remoteEntry("te-41", "entry-1", 90),
          remoteEntry("te-50", "other", 30),
        ],
      };
      fixture.__plannerAnswer = answer;

      const response = await sync();

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        connection: expect.objectContaining({ id: connectionId }),
        ...answer,
      });
      expect(rounds()).toEqual([round]);
      // One event per round, with counts and no names.
      const event = sink.events.find(
        (candidate) =>
          candidate.name === "time_sync.round" && candidate.kind === "request",
      );
      expect(event).toMatchObject({
        outcome: "ok",
        plugin: { id: "planner" },
        connection: { id: connectionId },
        time_sync_round: {
          change_count: 2,
          synced_count: 1,
          refused_count: 0,
          failed_count: 1,
          entry_count: 2,
        },
      });
      expect(JSON.stringify(sink.events)).not.toContain("Login");
    });

    it("refuses while Time entries is off, and runs nothing", async () => {
      const { sync, rounds } = await setup();

      expect(await sync()).toEqual({
        status: 409,
        body: {
          error:
            "Turn on time entries for this plugin before syncing time entries.",
        },
      });
      expect(rounds()).toEqual([]);
    });

    it("answers the plugin's error, and leaves the round's status to the window", async () => {
      const { setTimeEntries, sync, group, sink } = await setup();
      await setTimeEntries(true);
      fixture.__plannerAnswer = new Error("The token was revoked or expired.");

      expect(await sync()).toEqual({
        status: 502,
        body: { error: "The token was revoked or expired." },
      });
      expect(
        sink.events.find(
          (event) =>
            event.name === "time_sync.round" && event.kind === "request",
        ),
      ).toMatchObject({
        outcome: "error",
        error: { type: "Error", message: "The token was revoked or expired." },
      });
      // The window keeps each round's error. The connection's own error is
      // the project source's, which a round would otherwise hide.
      expect((await group()).connections[0]).not.toHaveProperty("lastError");
    });

    it("refuses a round of more than 20 changes before the plugin runs", async () => {
      const { setTimeEntries, sync, rounds } = await setup();
      await setTimeEntries(true);
      const tooMany = Array.from({ length: 21 }, (_, index) => ({
        kind: "delete",
        syncKey: `entry-${index}`,
      }));

      const response = await sync({ ...round, changes: tooMany });

      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toContain("changes");
      expect(rounds()).toEqual([]);
    });
  });
  describe("the example plugin", () => {
    /** A saved entry on the example fixture's project. */
    const saved = (localDate: string, minutes: number) => ({
      localDate,
      minutes,
      running: false,
      projectRemoteId: "ACME-SUP",
      taskName: "Ticket #101 - Login",
    });

    it("applies changes in order, adopts a create it holds, and lists the window", async () => {
      const { setTimeEntries, sync } = await setup(
        exampleProjectSourceDirectory,
      );
      expect((await setTimeEntries(true)).status).toBe(200);

      const first = await sync({
        from: "2026-10-01",
        to: "2026-11-15",
        timeZone: "America/Toronto",
        changes: [
          { kind: "upsert", syncKey: "a", values: saved("2026-11-10", 60) },
          { kind: "upsert", syncKey: "b", values: saved("2026-11-11", 30) },
          {
            kind: "upsert",
            syncKey: "c",
            values: saved("2026-11-11", 25 * 60),
          },
          { kind: "upsert", syncKey: "d", values: saved("2026-10-05", 15) },
        ],
      });

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        results: [
          {
            syncKey: "a",
            status: "synced",
            entry: { remoteId: "example-1", clientRef: "a", minutes: 60 },
          },
          {
            syncKey: "b",
            status: "synced",
            entry: { remoteId: "example-2", clientRef: "b" },
          },
          {
            syncKey: "c",
            status: "refused",
            message: "The example planner refuses an entry over 24 hours.",
          },
          {
            syncKey: "d",
            status: "synced",
            entry: { remoteId: "example-3", clientRef: "d" },
          },
        ],
      });
      const remoteIds = (body: unknown) =>
        (body as { entries: { remoteId: string }[] }).entries.map(
          (entry) => entry.remoteId,
        );
      expect(remoteIds(first.body)).toEqual([
        "example-3",
        "example-1",
        "example-2",
      ]);

      // A create whose answer was lost comes again without the remote id:
      // the remote holds its client reference, so it updates that entry.
      const second = await sync({
        from: "2026-11-09",
        to: "2026-11-15",
        timeZone: "America/Toronto",
        changes: [
          { kind: "upsert", syncKey: "a", values: saved("2026-11-12", 45) },
          { kind: "delete", syncKey: "b", remoteId: "example-2" },
        ],
      });

      expect(second.body).toMatchObject({
        results: [
          {
            syncKey: "a",
            status: "synced",
            entry: {
              remoteId: "example-1",
              localDate: "2026-11-12",
              minutes: 45,
            },
          },
          { syncKey: "b", status: "synced" },
        ],
      });
      // "d" is still there, before the window.
      expect(remoteIds(second.body)).toEqual(["example-1"]);
    });
  });
});
