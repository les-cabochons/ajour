import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PluginWorkerLifetime } from "./plugin-worker-lifetime.ts";
import type { PluginInvocation } from "./plugin-runtime.ts";
import { WorkerPluginRuntime } from "./plugin-worker-runtime.ts";

/** The scripts these tests run ignore what they are asked to call. */
const invocation: PluginInvocation = {
  pluginId: "test",
  packageDirectory: os.tmpdir(),
  entrypoint: "plugin.mjs",
  apiVersion: 3,
  method: "sync",
  args: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("plugin worker lifetime", () => {
  const directories: string[] = [];
  const lifetimes: PluginWorkerLifetime<string>[] = [];
  afterEach(async () => {
    await Promise.all(
      lifetimes.splice(0).map((lifetime) => lifetime.shutdown()),
    );
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  /** Creates a lifetime whose worker script is `source`, or a missing file when `source` is null. */
  async function lifetime(source: string | null, requestTimeoutMs = 1_000) {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-worker-lifetime-"),
    );
    directories.push(directory);
    const script = path.join(directory, "worker.mjs");
    if (source !== null) await writeFile(script, source);
    const host = new PluginWorkerLifetime<string>({
      name: "Plugin",
      runtime: new WorkerPluginRuntime({ scriptUrl: pathToFileURL(script) }),
      requestTimeoutMs,
      eventNames: {
        sync: "backlog.sync",
        syncConnection: "backlog.sync",
        syncPullRequests: "pull_request.sync",
      },
    });
    lifetimes.push(host);
    return host;
  }

  const passThrough = async () => ({
    invocation,
    parse: (value: unknown) => value,
  });
  const waitForWorkerStart = () =>
    new Promise((resolve) => setTimeout(resolve, 30));

  it("reserves capacity before discovery, cancels pending discovery, and drains shutdown", async () => {
    const host = await lifetime("throw new Error('Worker must not start');");
    const preparation = deferred<void>();
    const prepare = async () => {
      await preparation.promise;
      return { invocation, parse: (value: unknown) => value };
    };
    const calls = Array.from({ length: 4 }, () =>
      host.run("test", "sync", prepare),
    );
    const rejected = Promise.all(
      calls.map((call) => expect(call).rejects.toThrow("shutting down")),
    );
    expect(host.activeOperationCount).toBe(4);
    await expect(host.run("test", "sync", prepare)).rejects.toThrow("Too many");
    const shutdown = host.shutdown();
    expect(host.activeOperationCount).toBe(4);
    preparation.resolve();
    await rejected;
    await shutdown;
    expect(host.activeOperationCount).toBe(0);
    await expect(host.run("test", "sync", prepare)).rejects.toThrow(
      "host is shutting down",
    );
  });

  it("terminates a successful worker with open handles before freeing its slot", async () => {
    const host = await lifetime(
      "import {parentPort} from 'node:worker_threads'; parentPort.postMessage({ok:true,result:42}); setInterval(()=>{},1000);",
    );
    await expect(
      host.run("test", "sync", async () => ({
        invocation,
        parse: (value) => Number(value),
      })),
    ).resolves.toBe(42);
    expect(host.activeOperationCount).toBe(0);
    await host.shutdown();
  });

  it("releases capacity after timeout and response validation failure", async () => {
    const host = await lifetime("setInterval(()=>{},1000);", 40);
    await expect(
      host.run("test", "sync", async () => ({
        invocation,
        parse: (value) => value,
      })),
    ).rejects.toThrow("timed out");
    expect(host.activeOperationCount).toBe(0);
    const invalid = await lifetime(
      "import {parentPort} from 'node:worker_threads'; parentPort.postMessage({ok:true,result:null});",
    );
    await expect(
      invalid.run("test", "sync", async () => ({
        invocation,
        parse: () => {
          throw new Error("Invalid response");
        },
      })),
    ).rejects.toThrow("Invalid response");
    expect(invalid.activeOperationCount).toBe(0);
  });

  it("marks an error it cuts with an ellipsis, so the host can tell a cut secret", async () => {
    const host = await lifetime(
      "import {parentPort} from 'node:worker_threads'; parentPort.postMessage({ok:false,error:'x'.repeat(5000)});",
    );

    const error = await host
      .run("test", "sync", passThrough)
      .catch((thrown: unknown) => thrown);
    expect((error as Error).message).toBe(`${"x".repeat(4_095)}…`);
  });

  it("cuts an uncaught asynchronous throw the same way, however long", async () => {
    const host = await lifetime(
      "setTimeout(() => { throw new Error('x'.repeat(100_000)); });",
    );

    const error = await host
      .run("test", "sync", passThrough)
      .catch((thrown: unknown) => thrown);
    expect((error as Error).message).toBe(`${"x".repeat(4_095)}…`);
  });

  it.each([
    [
      "an uncaught Error with an empty message",
      "setTimeout(() => { throw new Error(''); });",
    ],
    [
      "an uncaught Error with a blank message",
      "setTimeout(() => { throw new Error('   '); });",
    ],
    [
      "an uncaught AbortError",
      "setTimeout(() => { throw new DOMException('', 'AbortError'); });",
    ],
    [
      "a posted blank error",
      "import {parentPort} from 'node:worker_threads'; parentPort.postMessage({ok:false,error:'  '});",
    ],
  ])("never fails with a blank message: %s", async (_, source) => {
    const host = await lifetime(source);

    const error = await host
      .run("test", "sync", passThrough)
      .catch((thrown: unknown) => thrown);
    expect((error as Error).message).toBe("Unknown plugin error.");
  });

  it.each(["'x'.repeat(100_000)", "undefined", "0", "null", "false", "''"])(
    "fails an uncaught asynchronous throw of %s that isn't an Error",
    async (thrown) => {
      const host = await lifetime(`setTimeout(() => { throw ${thrown}; });`);

      const error = await host.run("test", "sync", passThrough).then(
        (result) => ({ resolvedWith: result }),
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Unknown plugin error.");
      expect(host.activeOperationCount).toBe(0);
    },
  );

  it("releases capacity when the worker fails to start or exits before replying", async () => {
    const missing = await lifetime(null);
    await expect(missing.run("test", "sync", passThrough)).rejects.toThrow();
    expect(missing.activeOperationCount).toBe(0);
    const exiting = await lifetime("process.exit(3);");
    await expect(exiting.run("test", "sync", passThrough)).rejects.toThrow(
      'Plugin "test" exited before returning a result (code 3).',
    );
    expect(exiting.activeOperationCount).toBe(0);
  });

  it("terminates a running worker on shutdown", async () => {
    const host = await lifetime("setInterval(()=>{},1000);", 5_000);
    const operation = host.run("test", "sync", passThrough);
    await waitForWorkerStart();
    expect(host.activeOperationCount).toBe(1);
    await host.shutdown();
    await expect(operation).rejects.toThrow("the app is shutting down");
    expect(host.activeOperationCount).toBe(0);
  });

  it("cancels only the operations of the named plugin", async () => {
    const host = await lifetime("setInterval(()=>{},1000);", 5_000);
    const removed = host.run("removed", "sync", passThrough);
    const kept = host.run("kept", "sync", passThrough);
    await waitForWorkerStart();
    await host.cancel(new Error("Plugin removed"), undefined, "removed");
    await expect(removed).rejects.toThrow("Plugin removed");
    expect(host.activeOperationCount).toBe(1);
    await host.shutdown();
    await expect(kept).rejects.toThrow("the app is shutting down");
  });

  it("cancels only the plugin's operations whose method matches", async () => {
    const host = await lifetime("setInterval(()=>{},1000);", 5_000);
    const pullRequests = host.run("github", "syncPullRequests", passThrough);
    const workItems = host.run("github", "syncConnection", passThrough);
    await waitForWorkerStart();
    await host.cancel(
      new Error("Pull requests turned off"),
      "capability_off",
      "github",
      (method) => method === "syncPullRequests",
    );
    await expect(pullRequests).rejects.toThrow("Pull requests turned off");
    expect(host.activeOperationCount).toBe(1);
    await host.shutdown();
    await expect(workItems).rejects.toThrow("the app is shutting down");
  });

  it("keeps 4 worker threads per host for API 3, and 4 calls per plugin for API 4", async () => {
    const host = await lifetime("setInterval(()=>{},1000);", 5_000);
    const api3 = (pluginId: string) =>
      host.run(pluginId, "sync", async () => ({
        invocation: { ...invocation, pluginId },
        parse: (value: unknown) => value,
      }));
    const running = ["a", "b", "c", "d"].map((pluginId) =>
      api3(pluginId).catch((error: unknown) => error),
    );
    await waitForWorkerStart();
    await expect(api3("e")).rejects.toThrow(
      "Too many plugin operations are already running.",
    );

    // API 4 plugins run in a process of their own each, so only a plugin's
    // own calls count.
    const api4Host = new PluginWorkerLifetime<string>({
      name: "Plugin",
      runtime: {
        start: () => ({
          settled: new Promise(() => undefined),
          terminate: async () => undefined,
        }),
      },
      requestTimeoutMs: 5_000,
      eventNames: { sync: "backlog.sync" },
    });
    lifetimes.push(api4Host);
    const api4 = (pluginId: string) =>
      api4Host.run(pluginId, "sync", async () => ({
        invocation: { ...invocation, pluginId, apiVersion: 4 },
        parse: (value: unknown) => value,
      }));
    const api4Running = [
      ...Array.from({ length: 4 }, () => api4("a")),
      ...Array.from({ length: 4 }, () => api4("b")),
    ].map((call) => call.catch((error: unknown) => error));
    await waitForWorkerStart();
    expect(api4Host.activeOperationCount).toBe(8);
    await expect(api4("a")).rejects.toThrow(
      'Too many operations of plugin "a" are already running.',
    );

    await host.shutdown();
    await api4Host.shutdown();
    await Promise.all([...running, ...api4Running]);
  });

  it("refuses a fifth API 3 operation across plugins before it resolves anything else", async () => {
    const host = new PluginWorkerLifetime<string>({
      name: "Plugin",
      runtime: {
        start: () => ({
          settled: new Promise(() => undefined),
          terminate: async () => undefined,
        }),
      },
      requestTimeoutMs: 5_000,
      eventNames: { sync: "backlog.sync" },
    });
    lifetimes.push(host);
    const preparing = deferred<void>();
    const resolved: string[] = [];
    const api3 = (pluginId: string) =>
      host.run(pluginId, "sync", async (record) => {
        // A host learns the package's API version first, then the rest.
        record.plugin({ version: "1.0.0", source: "installed", apiVersion: 3 });
        resolved.push(pluginId);
        await preparing.promise;
        return {
          invocation: { ...invocation, pluginId },
          parse: (value: unknown) => value,
        };
      });
    const running = ["a", "b", "c", "d"].map((pluginId) =>
      api3(pluginId).catch((error: unknown) => error),
    );
    await waitForWorkerStart();
    expect(resolved).toEqual(["a", "b", "c", "d"]);

    await expect(api3("e")).rejects.toThrow(
      "Too many plugin operations are already running.",
    );
    expect(resolved).not.toContain("e");
    // An API 4 plugin has no thread of the host's to wait for.
    const api4 = host.run("f", "sync", async (record) => {
      record.plugin({ version: "1.0.0", source: "installed", apiVersion: 4 });
      resolved.push("f");
      await preparing.promise;
      return {
        invocation: { ...invocation, pluginId: "f", apiVersion: 4 },
        parse: (value: unknown) => value,
      };
    });
    await waitForWorkerStart();
    expect(resolved).toContain("f");

    const shutdown = host.shutdown();
    preparing.resolve();
    await shutdown;
    await Promise.all([...running, api4.catch(() => undefined)]);
  });

  it("waits for running operations up to a limit, as a quit drains them", async () => {
    const finishes = deferred<void>();
    const host = new PluginWorkerLifetime<string>({
      name: "Plugin",
      runtime: {
        start: (started) => ({
          settled:
            started.pluginId === "quick"
              ? finishes.promise.then(() => ({ ok: true, result: 1 }))
              : new Promise(() => undefined),
          terminate: async () => undefined,
        }),
      },
      requestTimeoutMs: 5_000,
      eventNames: { sync: "backlog.sync" },
    });
    lifetimes.push(host);
    const run = (pluginId: string) =>
      host.run(pluginId, "sync", async () => ({
        invocation: { ...invocation, pluginId, apiVersion: 4 },
        parse: (value: unknown) => value,
      }));
    const quick = run("quick");
    const stuck = run("stuck");
    await waitForWorkerStart();

    // The quick one finishes, and the drain still waits on the stuck one.
    const idle = host.whenIdle(300);
    finishes.resolve();
    await expect(quick).resolves.toBe(1);
    const startedAt = Date.now();
    await idle;
    expect(Date.now() - startedAt).toBeGreaterThan(150);
    expect(host.activeOperationCount).toBe(1);

    await host.shutdown();
    await expect(stuck).rejects.toThrow("the app is shutting down");
    // Nothing runs: the drain is over at once.
    const drained = Date.now();
    await host.whenIdle(5_000);
    expect(Date.now() - drained).toBeLessThan(100);
  });
});
