/**
 * The port every plugin operation runs through. A runtime starts one
 * operation, reports how it settled, and terminates it. The worker lifetime
 * keeps admission, quota, timeout, cancellation, wide events and result
 * validation around it, so a runtime only runs plugin code.
 *
 * The worker-thread runtime (`plugin-worker-runtime.ts`) runs plugin API 3
 * packages. Development builds of the desktop app run API 4 packages in a
 * sandboxed renderer each (`apps/desktop/electron/plugin-renderer-runtime.cjs`),
 * beside it, through `SplitPluginRuntime`. Tests may use the in-process fake
 * in `test-support/`.
 *
 * An API 4 plugin reaches the network only through the broker its
 * invocation carries (`credential-broker.ts`): a runtime hands the plugin's
 * `ajour.http` and `ajour.publicFetch` calls to it, in process or over IPC.
 * A runtime that can't keep the plugin from everything else, such as the
 * worker thread, never runs one.
 */

import type { OperationBroker } from "./credential-broker.ts";

/** The largest result, as `v8.serialize` counts it, a runtime returns. */
export const MAX_PLUGIN_RESULT_BYTES = 8 * 1024 * 1024;
/** The longest plugin error message a runtime reports, cut with "…". */
export const MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;

/** One plugin operation, as a runtime runs it. */
export interface PluginInvocation {
  /** The plugin, which a runtime may name its package by. */
  pluginId: string;
  /** The plugin's installed or development package, holding its manifest. */
  packageDirectory: string;
  /** The module the package runs, as its manifest declares it, inside `packageDirectory`. */
  entrypoint: string;
  /** The plugin API the package targets. */
  apiVersion: number;
  /** The export the operation calls. */
  method: string;
  /** What the export receives, in order. See `plugin-methods.ts`. */
  args: readonly unknown[];
  /**
   * For an API 4 plugin, the broker of this one operation: the plugin's
   * only way to the network. The host closes it once the operation settles.
   */
  broker?: OperationBroker;
}

/**
 * Why a run is terminated: it `settled`, it ran past its `timeout`, or it
 * was `cancelled`, as when its plugin was turned off. A runtime that keeps a
 * process per plugin closes the process on a timeout only: a settled or
 * cancelled run frees its own work and leaves the process to the next call,
 * and only a timeout counts against the plugin.
 */
export type PluginTerminateReason = "settled" | "timeout" | "cancelled";

/**
 * Why a plugin's process ended under a run: it `crashed`, ran out of memory
 * (`oom`), was `killed` by the system, or went over its `memory` ceiling.
 */
export type PluginCrashCause = "crashed" | "oom" | "killed" | "memory";

/** How a run ended, as its runtime saw it. */
export type PluginRunOutcome =
  | {
      ok: true;
      result: unknown;
      /** The result's size, when the runtime measured it. */
      resultBytes?: number;
    }
  | {
      ok: false;
      /** The plugin threw or rejected. Its message, when it was an Error. */
      failure: "plugin_error";
      message?: string;
      /**
       * The HTTP status the plugin's error carries, when the error says one:
       * a `status`, `statusCode` or `httpStatus` property holding an integer
       * from 100 to 599. A runtime that makes the plugin's requests, as the
       * broker will, sets it from the response instead. Only a 401 has a
       * meaning to the host: the connection's secret was rejected.
       */
      httpStatus?: number;
    }
  | { ok: false; failure: "missing_export" }
  | { ok: false; failure: "result_too_large"; resultBytes: number }
  | {
      ok: false;
      /** The runtime ended before the plugin returned. */
      failure: "exited_early";
      exitCode: number;
    }
  | {
      ok: false;
      /** The plugin's process ended under the run. */
      failure: "crashed";
      cause: PluginCrashCause;
    }
  | {
      ok: false;
      /**
       * The runtime refuses to run any plugin, as when this computer can't
       * sandbox them. `reason` says why, in words for the user.
       */
      failure: "runtime_unavailable";
      reason: string;
    }
  | {
      ok: false;
      /** `terminate()` ended the run before it settled. */
      failure: "terminated";
    };

/** One running operation. */
export interface PluginRun {
  /** Settles once, with how the run ended. It never rejects. */
  readonly settled: Promise<PluginRunOutcome>;
  /**
   * Stops the run and frees everything it holds. Resolves once it is gone.
   * Safe to call after it settled, and more than once.
   */
  terminate(reason: PluginTerminateReason): Promise<void>;
}

/** What a runtime reports back to the API it serves. */
export interface PluginRuntimeHost {
  /**
   * The plugin tried a way out its sandbox closes, such as its own `fetch`.
   * It counts as a blocked attempt for Access review; the plugin goes on.
   */
  recordBlocked(pluginId: string, at: number): Promise<void>;
}

/** Runs plugin operations. One instance may serve several hosts. */
export interface PluginRuntime {
  /**
   * Whether it runs API 4 plugins, whose code must reach nothing but the
   * broker. The host refuses an API 4 operation on any other runtime.
   */
  readonly runsPluginApi4?: boolean;
  /**
   * A runtime that sandboxes plugins has this: why it can't run any plugin
   * now, or undefined when it can. While it has a reason, every run settles
   * `runtime_unavailable`, and there is no override.
   */
  unavailableReason?(): string | undefined;
  /** Gives the runtime the API it reports to. The API calls it as it starts. */
  attach?(host: PluginRuntimeHost): void;
  /** Starts one operation. It never throws: a failure to start settles the run. */
  start(invocation: PluginInvocation): PluginRun;
}

/** A run that ended before it started, such as a refused one. */
export function settledRun(outcome: PluginRunOutcome): PluginRun {
  return { settled: Promise.resolve(outcome), terminate: async () => {} };
}

/**
 * Runs plugin API 3 packages on one runtime and API 4 packages on another,
 * the sandboxed one, until the cut-over removes API 3 (#403). While the
 * sandboxed runtime can't run plugins, no plugin runs, API 3 included:
 * plugins are off on this computer.
 */
export class SplitPluginRuntime implements PluginRuntime {
  readonly runsPluginApi4: boolean;
  private readonly api3: PluginRuntime;
  private readonly api4: PluginRuntime;

  constructor(runtimes: { api3: PluginRuntime; api4: PluginRuntime }) {
    this.api3 = runtimes.api3;
    this.api4 = runtimes.api4;
    this.runsPluginApi4 = runtimes.api4.runsPluginApi4 === true;
  }

  unavailableReason() {
    return this.api4.unavailableReason?.();
  }

  attach(host: PluginRuntimeHost) {
    this.api3.attach?.(host);
    this.api4.attach?.(host);
  }

  start(invocation: PluginInvocation): PluginRun {
    const reason = this.unavailableReason();
    if (reason !== undefined) {
      return settledRun({ ok: false, failure: "runtime_unavailable", reason });
    }
    return (invocation.apiVersion >= 4 ? this.api4 : this.api3).start(
      invocation,
    );
  }
}

/** The HTTP status a thrown value carries, if it names one (see `PluginRunOutcome`). */
export function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["httpStatus", "statusCode", "status"] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (
      Number.isInteger(value) &&
      (value as number) >= 100 &&
      (value as number) <= 599
    ) {
      return value as number;
    }
  }
  return undefined;
}

/** Cuts a plugin error message, ending it with "…" so redaction knows. */
export function cutPluginErrorMessage(message: string) {
  return message.length <= MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS
    ? message
    : `${message.slice(0, MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS - 1)}…`;
}
