import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { startAppApiServer, stopAppApiServer } from "./server.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-lifecycle-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function start(
  root: string,
  options: Parameters<typeof startAppApiServer>[0] = {},
) {
  const sink = createRecordingSink<AjourEvent>();
  const server = await startAppApiServer({
    port: 0,
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: false,
    projectDataShapePluginDirectories: [],
    eventSink: sink,
    ...options,
  });
  let stopped = false;
  cleanups.push(async () => {
    if (!stopped) await stopAppApiServer(server);
  });
  return {
    server,
    port: (server.address() as AddressInfo).port,
    events: sink.events,
    stop: async () => {
      stopped = true;
      await stopAppApiServer(server);
    },
  };
}

const named = (events: AjourEvent[], name: string) =>
  events.filter((event) => event.name === name);

describe("local API lifecycle events", () => {
  it("records the start with its port and how long listening took", async () => {
    const { events, port } = await start(await tempRoot());

    expect(named(events, "api.start")).toEqual([
      expect.objectContaining({
        kind: "lifecycle",
        trigger: "boot",
        outcome: "ok",
        api: { port, listen_ms: expect.any(Number) },
      }),
    ]);
  });

  it("records a start that fails because the port is in use", async () => {
    const root = await tempRoot();
    const { port } = await start(root);
    const sink = createRecordingSink<AjourEvent>();

    await expect(
      startAppApiServer({
        port,
        statePath: path.join(root, "other.json"),
        installedPluginDirectory: path.join(root, "installed"),
        projectDataShapePluginDirectories: [],
        eventSink: sink,
      }),
    ).rejects.toThrow();

    expect(named(sink.events, "api.start")).toEqual([
      expect.objectContaining({
        outcome: "error",
        outcome_reason: "port_in_use",
        api: expect.objectContaining({ port }),
        error: expect.objectContaining({ code: "EADDRINUSE" }),
      }),
    ]);
  });

  it("records the stop with the time each phase took", async () => {
    const { events, port, stop } = await start(await tempRoot());

    await stop();

    expect(named(events, "api.stop")).toEqual([
      expect.objectContaining({
        kind: "lifecycle",
        outcome: "ok",
        api: {
          port,
          agent_runner_ms: expect.any(Number),
          plugins_ms: expect.any(Number),
          close_ms: expect.any(Number),
          plugin_operations_running: 0,
        },
      }),
    ]);
  });

  it("records the first state load, with the versions it migrated between", async () => {
    const root = await tempRoot();
    await writeFile(
      path.join(root, "state.json"),
      JSON.stringify({ version: 2, stagedImports: [] }),
    );
    const { events, port } = await start(root);

    await fetch(`http://127.0.0.1:${port}/api/plugins`);
    await fetch(`http://127.0.0.1:${port}/api/plugins`);

    const loads = named(events, "storage.load");
    expect(loads).toEqual([
      expect.objectContaining({
        kind: "lifecycle",
        outcome: "ok",
        storage: {
          found: true,
          bytes: expect.any(Number),
          version_from: 2,
          version_to: 7,
        },
      }),
    ]);
    const request = events.find((event) => event.name === "plugin.list");
    expect(loads[0]).toMatchObject({ trace_id: request?.trace_id });
  });

  it("records a corrupt state file as an unreadable load, without its text", async () => {
    const root = await tempRoot();
    await writeFile(
      path.join(root, "state.json"),
      '{"connections": [{"config": {"token": "tok_state_canary_7d"}}',
    );
    const { events, port } = await start(root);

    const response = await fetch(`http://127.0.0.1:${port}/api/plugins`);

    expect(response.status).toBe(400);
    expect(named(events, "storage.load")).toEqual([
      expect.objectContaining({
        outcome: "error",
        outcome_reason: "unreadable",
        storage: expect.objectContaining({ found: true, unreadable: true }),
        error: expect.objectContaining({ type: "SyntaxError" }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("tok_state_canary_7d");
  });

  it("keeps a corrupt state file's text out of the request that read it, and its answer", async () => {
    const root = await tempRoot();
    // The parser quotes the start of a file like this one in its message.
    await writeFile(path.join(root, "state.json"), "CANARY_SECRET_TOKEN");
    const { events, port } = await start(root);

    const response = await fetch(`http://127.0.0.1:${port}/api/plugins`);
    const body = await response.text();

    expect(response.status).toBe(400);
    const request = events.find((event) => event.name === "plugin.list");
    expect(request).toMatchObject({
      outcome: "error",
      error: {
        type: "SyntaxError",
        code: "unreadable",
        message: "The state file is not valid JSON.",
      },
    });
    expect(JSON.stringify(events)).not.toContain("CANARY");
    expect(body).not.toContain("CANARY");
  });

  it("loads the defaults from a state file that holds null", async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, "state.json"), "null");
    const { events, port } = await start(root);

    const response = await fetch(`http://127.0.0.1:${port}/api/plugins`);

    expect(response.status).toBe(200);
    expect(named(events, "storage.load")).toEqual([
      expect.objectContaining({
        outcome: "ok",
        storage: expect.objectContaining({ found: true, version_to: 7 }),
      }),
    ]);
  });
});

/** What Node does before it handles a crash: tell the monitor listeners. */
function emitCrash(error: Error, origin: string) {
  (process as NodeJS.EventEmitter).emit(
    "uncaughtExceptionMonitor",
    error,
    origin,
  );
}

describe("local API crash events", () => {
  it("records an uncaught exception and an unhandled rejection, scrubbed", async () => {
    const root = await tempRoot();
    const { events } = await start(root, { reportProcessCrashes: true });

    emitCrash(
      new TypeError(`Cannot read ${path.join(root, "secret-file.txt")}`),
      "uncaughtException",
    );
    emitCrash(
      new Error("Rejected at https://example.com/private?token=abc"),
      "unhandledRejection",
    );

    expect(named(events, "app.error")).toEqual([
      expect.objectContaining({
        kind: "crash",
        outcome: "error",
        crash: { origin: "uncaught_exception" },
        error: expect.objectContaining({
          type: "TypeError",
          message: `Cannot read [user data]${path.sep}secret-file.txt`,
        }),
      }),
      expect.objectContaining({
        crash: { origin: "unhandled_rejection" },
        error: expect.objectContaining({ message: "Rejected at [url]" }),
      }),
    ]);
  });

  it("watches no process crashes unless asked, and stops watching at stop", async () => {
    const quiet = await start(await tempRoot());
    const watching = await start(await tempRoot(), {
      reportProcessCrashes: true,
    });
    await watching.stop();

    emitCrash(new Error("After stop"), "uncaughtException");

    expect(named(quiet.events, "app.error")).toEqual([]);
    expect(named(watching.events, "app.error")).toEqual([]);
  });
});
