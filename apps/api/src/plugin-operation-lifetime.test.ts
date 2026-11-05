import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { PluginOperationLifetime } from "./plugin-operation-lifetime.ts";
import type {
  PluginInvocation,
  PluginRunOutcome,
  PluginRuntime,
} from "./plugin-runtime.ts";
const invocation: PluginInvocation = {
  pluginId: "test",
  packageDirectory: os.tmpdir(),
  entrypoint: "plugin.mjs",
  apiVersion: 4,
  method: "sync",
  args: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const waitForWorkerStart = () =>
  new Promise((resolve) => setTimeout(resolve, 30));
describe("plugin operation lifetime", () => {
  const lifetimes: PluginOperationLifetime<string>[] = [];
  afterEach(async () => {
    await Promise.all(lifetimes.splice(0).map((host) => host.shutdown()));
  });
  function setup(timeout = 1000) {
    const runs: {
      complete: (outcome: PluginRunOutcome) => void;
      terminated: string[];
    }[] = [];
    const runtime: PluginRuntime = {
      runsPluginApi4: true,
      start() {
        const result = deferred<PluginRunOutcome>();
        const terminated: string[] = [];
        runs.push({ complete: result.resolve, terminated });
        return {
          settled: result.promise,
          terminate: async (reason) => {
            terminated.push(reason);
            result.resolve({ ok: false, failure: "terminated" });
          },
        };
      },
    };
    const host = new PluginOperationLifetime<string>({
      name: "Plugin",
      runtime,
      requestTimeoutMs: timeout,
      eventNames: { sync: "backlog.sync" },
    });
    lifetimes.push(host);
    const run = (id = "test") =>
      host.run(id, "sync", async () => ({
        invocation: { ...invocation, pluginId: id },
        parse: (value: unknown) => value,
      }));
    return { host, runs, run };
  }
  it("reserves four calls per plugin during discovery and releases them on shutdown", async () => {
    const { host } = setup();
    const ready = deferred<void>();
    const run = (id: string) =>
      host
        .run(id, "sync", async () => {
          await ready.promise;
          return { invocation, parse: (v: unknown) => v };
        })
        .catch((e) => e);
    const pending = [
      ...Array.from({ length: 4 }, () => run("a")),
      ...Array.from({ length: 4 }, () => run("b")),
    ];
    await expect(
      host.run("a", "sync", async () => {
        throw Error("must not prepare");
      }),
    ).rejects.toMatchObject({ reason: "capacity" });
    expect(host.activeOperationCount).toBe(8);
    const stopped = host.shutdown();
    ready.resolve();
    await stopped;
    await Promise.all(pending);
    expect(host.activeOperationCount).toBe(0);
  });
  it("terminates a settled run before returning its result and frees its slot", async () => {
    const { host, runs, run } = setup();
    const result = run();
    await waitForWorkerStart();
    runs[0]!.complete({ ok: true, result: 42 });
    await expect(result).resolves.toBe(42);
    expect(runs[0]!.terminated).toEqual(["settled"]);
    expect(host.activeOperationCount).toBe(0);
  });
  it("times out and terminates a stalled run", async () => {
    const { host, runs, run } = setup(50);
    await expect(run()).rejects.toMatchObject({ reason: "timeout" });
    expect(runs[0]!.terminated).toEqual(["timeout"]);
    expect(host.activeOperationCount).toBe(0);
  });
  it("cancels only the named plugin and drains the rest on shutdown", async () => {
    const { host, runs, run } = setup();
    const a = run("a").catch((e) => e);
    const b = run("b").catch((e) => e);
    await waitForWorkerStart();
    await host.cancel(new Error("Plugin removed"), "uninstalled", "a");
    expect(await a).toMatchObject({ message: "Plugin removed" });
    expect(host.activeOperationCount).toBe(1);
    await host.shutdown();
    expect(await b).toBeInstanceOf(Error);
    expect(runs.every((run) => run.terminated.length === 1)).toBe(true);
  });
  it("waits for running operations up to a limit, as a quit drains them", async () => {
    const finishes = deferred<void>();
    const host = new PluginOperationLifetime<string>({
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
