import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serialize } from "node:v8";
import type {
  BrokerHttpRequest,
  BrokerPublicFetchInit,
  BrokerResponse,
  OperationBroker,
} from "../credential-broker.ts";
import {
  MAX_PLUGIN_RESULT_BYTES,
  cutPluginErrorMessage,
  httpStatusOf,
  type PluginInvocation,
  type PluginRun,
  type PluginRunOutcome,
  type PluginRuntime,
} from "../plugin-runtime.ts";

/** The broker of the API 4 run whose code is running, as `ajour` finds it. */
const currentBroker = new AsyncLocalStorage<OperationBroker>();

/** An answer as `ajour.http` gives it to plugin code, as the SDK types it. */
function ajourResponse(response: BrokerResponse) {
  const text = () => new TextDecoder().decode(response.body);
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    headers: response.headers,
    text: async () => text(),
    json: async () => JSON.parse(text()) as unknown,
  };
}

function brokerOfThisRun(): OperationBroker {
  const broker = currentBroker.getStore();
  if (!broker) {
    throw new Error("ajour is reachable only inside a plugin operation.");
  }
  return broker;
}

const AJOUR_GLOBAL = Symbol.for("ajour.in-process-runtime");

/**
 * The `ajour` global an API 4 plugin's code calls, installed once: each
 * call goes to the broker of the run it was made from, so concurrent runs
 * keep to their own operation.
 */
function installAjourGlobal() {
  const holder = globalThis as { ajour?: Record<PropertyKey, unknown> };
  if (holder.ajour?.[AJOUR_GLOBAL]) return;
  holder.ajour = {
    [AJOUR_GLOBAL]: true,
    http: async (request: BrokerHttpRequest) =>
      ajourResponse(await brokerOfThisRun().http(request)),
    publicFetch: async (url: string, init?: BrokerPublicFetchInit) =>
      ajourResponse(await brokerOfThisRun().publicFetch(url, init)),
    log: () => undefined,
  };
}

/**
 * A fake runtime for plain Node tests. It imports the plugin module into the
 * test's own process and calls the export, so a test runs without a worker.
 * Never use it outside tests: Ajour must not load plugin code into its own
 * process.
 *
 * Like a worker, each run gets a fresh copy of the module and receives
 * structured clones, and a result is bounded the same way. Terminating a run
 * settles it at once, but cannot stop plugin code that is still running.
 *
 * It runs API 4 plugins too, as the sandboxed renderer will: their `ajour`
 * global calls the broker their invocation carries, directly rather than
 * over IPC, so a fixture plugin's requests go through the real broker.
 */
export class InProcessPluginRuntime implements PluginRuntime {
  readonly runsPluginApi4 = true;
  private runs = 0;

  start(invocation: PluginInvocation): PluginRun {
    let terminate!: () => void;
    const terminated = new Promise<PluginRunOutcome>((resolve) => {
      terminate = () => resolve({ ok: false, failure: "terminated" });
    });
    const settled = Promise.race([this.run(invocation), terminated]);
    return {
      settled,
      terminate: async () => {
        terminate();
      },
    };
  }

  private async run(invocation: PluginInvocation): Promise<PluginRunOutcome> {
    this.runs += 1;
    const url = pathToFileURL(
      path.resolve(invocation.packageDirectory, invocation.entrypoint),
    );
    // A new URL per run, so module state never leaks between runs.
    url.searchParams.set("run", String(this.runs));
    try {
      const pluginModule = (await import(
        /* @vite-ignore */ url.href
      )) as Record<string, unknown>;
      const handler = pluginModule[invocation.method];
      if (typeof handler !== "function") {
        return { ok: false, failure: "missing_export" };
      }
      const args = structuredClone(invocation.args);
      const call = async () => (await handler(...args)) as unknown;
      let returned: unknown;
      if (invocation.broker) {
        installAjourGlobal();
        returned = await currentBroker.run(invocation.broker, call);
      } else {
        returned = await call();
      }
      const result: unknown = structuredClone(returned);
      const resultBytes = serialize(result).byteLength;
      return resultBytes > MAX_PLUGIN_RESULT_BYTES
        ? { ok: false, failure: "result_too_large", resultBytes }
        : { ok: true, result, resultBytes };
    } catch (error) {
      return {
        ok: false,
        failure: "plugin_error",
        ...(error instanceof Error
          ? { message: cutPluginErrorMessage(error.message) }
          : {}),
        ...(httpStatusOf(error) !== undefined
          ? { httpStatus: httpStatusOf(error) }
          : {}),
      };
    }
  }
}
