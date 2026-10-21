import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PluginWorkerLifetime } from "./plugin-worker-lifetime.ts";

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
      workerScriptUrl: pathToFileURL(script),
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
    workerData: {},
    parse: (value: unknown) => value,
  });
  const waitForWorkerStart = () =>
    new Promise((resolve) => setTimeout(resolve, 30));

  it("reserves capacity before discovery, cancels pending discovery, and drains shutdown", async () => {
    const host = await lifetime("throw new Error('Worker must not start');");
    const preparation = deferred<void>();
    const prepare = async () => {
      await preparation.promise;
      return { workerData: {}, parse: (value: unknown) => value };
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
        workerData: {},
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
        workerData: {},
        parse: (value) => value,
      })),
    ).rejects.toThrow("timed out");
    expect(host.activeOperationCount).toBe(0);
    const invalid = await lifetime(
      "import {parentPort} from 'node:worker_threads'; parentPort.postMessage({ok:true,result:null});",
    );
    await expect(
      invalid.run("test", "sync", async () => ({
        workerData: {},
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
});
