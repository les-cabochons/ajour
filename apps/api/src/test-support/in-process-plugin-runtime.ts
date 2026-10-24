import path from "node:path";
import { pathToFileURL } from "node:url";
import { serialize } from "node:v8";
import {
  MAX_PLUGIN_RESULT_BYTES,
  cutPluginErrorMessage,
  type PluginInvocation,
  type PluginRun,
  type PluginRunOutcome,
  type PluginRuntime,
} from "../plugin-runtime.ts";

/**
 * A fake runtime for plain Node tests. It imports the plugin module into the
 * test's own process and calls the export, so a test runs without a worker.
 * Never use it outside tests: Ajour must not load plugin code into its own
 * process.
 *
 * Like a worker, each run gets a fresh copy of the module and receives
 * structured clones, and a result is bounded the same way. Terminating a run
 * settles it at once, but cannot stop plugin code that is still running.
 */
export class InProcessPluginRuntime implements PluginRuntime {
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
      const result: unknown = structuredClone(
        await handler(...structuredClone(invocation.args)),
      );
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
      };
    }
  }
}
