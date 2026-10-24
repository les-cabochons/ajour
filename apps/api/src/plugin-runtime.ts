/**
 * The port every plugin operation runs through. A runtime starts one
 * operation, reports how it settled, and terminates it. The worker lifetime
 * keeps admission, quota, timeout, cancellation, wide events and result
 * validation around it, so a runtime only runs plugin code.
 *
 * The worker-thread runtime (`plugin-worker-runtime.ts`) is the one Ajour
 * ships today. Tests may use the in-process fake in `test-support/`.
 */

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
}

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
  terminate(): Promise<void>;
}

/** Runs plugin operations. One instance may serve several hosts. */
export interface PluginRuntime {
  /** Starts one operation. It never throws: a failure to start settles the run. */
  start(invocation: PluginInvocation): PluginRun;
}

/** Cuts a plugin error message, ending it with "…" so redaction knows. */
export function cutPluginErrorMessage(message: string) {
  return message.length <= MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS
    ? message
    : `${message.slice(0, MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS - 1)}…`;
}
