import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS,
  MAX_PLUGIN_RESULT_BYTES,
  type PluginInvocation,
  type PluginRun,
  type PluginRunOutcome,
  type PluginRuntime,
} from "./plugin-runtime.ts";

interface WorkerMessage {
  ok?: boolean;
  result?: unknown;
  error?: unknown;
  reason?: unknown;
  bytes?: unknown;
}

/**
 * Runs each operation in a new Node worker thread with no environment, no
 * flags and bounded memory, and discards what it prints. The worker is
 * terminated once the operation settles, so none outlives its run.
 */
export class WorkerPluginRuntime implements PluginRuntime {
  private readonly scriptUrl: URL;

  /** `scriptUrl` replaces the worker script, for tests of the protocol. */
  constructor(options: { scriptUrl?: URL } = {}) {
    this.scriptUrl =
      options.scriptUrl ?? new URL("./plugin-worker.mjs", import.meta.url);
  }

  start(invocation: PluginInvocation): PluginRun {
    let settle!: (outcome: PluginRunOutcome) => void;
    let settledYet = false;
    const settled = new Promise<PluginRunOutcome>((resolve) => {
      settle = (outcome) => {
        if (settledYet) return;
        settledYet = true;
        resolve(outcome);
      };
    });

    let worker: Worker;
    try {
      worker = new Worker(this.scriptUrl, {
        env: {},
        execArgv: [],
        stdout: true,
        stderr: true,
        workerData: {
          entrypointUrl: pathToFileURL(
            path.resolve(invocation.packageDirectory, invocation.entrypoint),
          ).toString(),
          method: invocation.method,
          args: invocation.args,
          maxResultBytes: MAX_PLUGIN_RESULT_BYTES,
          maxErrorCharacters: MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      });
    } catch (error) {
      settle({
        ok: false,
        failure: "plugin_error",
        ...(error instanceof Error ? { message: error.message } : {}),
      });
      return { settled, terminate: async () => {} };
    }

    // An uncaught asynchronous throw in plugin code arrives here, past the
    // worker's own cut, and may be any value.
    worker.once("error", (error: unknown) => {
      settle({
        ok: false,
        failure: "plugin_error",
        ...(error instanceof Error ? { message: error.message } : {}),
      });
    });
    worker.once("message", (message: WorkerMessage | null) => {
      settle(outcomeOf(message));
    });
    worker.once("exit", (exitCode: number) => {
      settle({ ok: false, failure: "exited_early", exitCode });
    });
    worker.stdout?.resume();
    worker.stderr?.resume();

    let termination: Promise<void> | undefined;
    return {
      settled,
      terminate: () => {
        termination ??= (async () => {
          settle({ ok: false, failure: "terminated" });
          worker.removeAllListeners();
          try {
            await worker.terminate();
          } catch {
            // The worker may already have exited after posting its result.
          }
        })();
        return termination;
      },
    };
  }
}

function outcomeOf(message: WorkerMessage | null): PluginRunOutcome {
  const resultBytes =
    typeof message?.bytes === "number" ? message.bytes : undefined;
  if (message?.ok === true) {
    return {
      ok: true,
      result: message.result,
      ...(resultBytes === undefined ? {} : { resultBytes }),
    };
  }
  if (message?.reason === "result_too_large") {
    return {
      ok: false,
      failure: "result_too_large",
      resultBytes: resultBytes ?? 0,
    };
  }
  if (message?.reason === "missing_export") {
    return { ok: false, failure: "missing_export" };
  }
  return {
    ok: false,
    failure: "plugin_error",
    ...(typeof message?.error === "string" ? { message: message.error } : {}),
  };
}
