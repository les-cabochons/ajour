import type { AjourCatalog } from "../../../packages/wide-events/catalog.ts";
import type { Unit } from "../../../packages/wide-events/index.ts";
import { InvalidPluginResultError, withoutContent } from "./event-errors.ts";
import type { PluginOperationEventName } from "./operation-events.ts";
import { createApiEvents, type ApiEvents } from "./events.ts";
import { nowhere } from "../../../packages/wide-events/sinks.ts";
import {
  cutPluginErrorMessage,
  type PluginCrashCause,
  type PluginInvocation,
  type PluginRunOutcome,
  type PluginRuntime,
  type PluginTerminateReason,
} from "./plugin-runtime.ts";

/**
 * At most this many operations of one plugin run at once (#217). Plugin API
 * 3 packages, which run on worker threads, also share this many per host.
 * Each host owns its own lifetime instance, so plugin and data-shape quotas
 * stay separate.
 */
const MAX_CONCURRENT_OPERATIONS = 4;

/** Why a plugin operation was refused before its worker started. */
export type PluginRefusalReason =
  | "capacity"
  | "system_off"
  | "plugin_off"
  | "capability_off"
  | "host_stopping"
  | "package_change"
  | "not_installed"
  | "runs_no_code"
  | "not_supported"
  | "invalid_request"
  | "agent_access"
  | "access_off"
  /** The runtime runs no plugin on this computer, such as without a sandbox. */
  | "runtime_unavailable"
  /** The plugin kept stopping, so it is suspended until Turn back on. */
  | "suspended";

/** Why a registered plugin operation was cancelled. */
export type PluginCancelReason =
  | "system_off"
  | "plugin_off"
  | "capability_off"
  | "uninstalled"
  | "shutdown"
  | "access_off";

/** How a worker failed. `crashed`: the plugin's process ended under it. */
export type WorkerFailureReason =
  "timeout" | "result_too_large" | "exited_early" | "crashed" | "plugin_error";

/** The notice that says plugins are off on this computer, then why. */
export const PLUGINS_TURNED_OFF_NOTICE =
  "Plugins are turned off: this computer can't run them in a sandbox.";

/** How a crash's cause reads in its error. */
const CRASH_CAUSES: Record<PluginCrashCause, string> = {
  crashed: "crashed",
  oom: "ran out of memory",
  killed: "was ended by the system",
  memory: "went over its memory ceiling",
};

/**
 * A plugin operation turned away before its worker started, such as by a
 * full host or a switched-off capability. Its message is the one callers
 * show; its reason is the event's.
 */
export class PluginOperationRefused extends Error {
  readonly reason: PluginRefusalReason;

  constructor(message: string, reason: PluginRefusalReason) {
    super(message);
    this.reason = reason;
  }
}

/** A registered plugin operation that was cancelled, and why when it is known. */
export class PluginOperationCancelled extends Error {
  readonly reason: PluginCancelReason | undefined;

  constructor(
    message: string,
    reason: PluginCancelReason | undefined,
    cause: Error,
  ) {
    super(message, { cause });
    this.reason = reason;
  }
}

/** Every reason a plugin operation can fail with, which its route's event says too. */
export type PluginFailureReason =
  | PluginRefusalReason
  | PluginCancelReason
  | WorkerFailureReason
  | "invalid_result";

/** A worker that timed out, exited early, or ended with the plugin's error. */
export class PluginWorkerFailure extends Error {
  readonly reason: WorkerFailureReason;
  /** The HTTP status the plugin's error named, if it did. See `PluginRunOutcome`. */
  readonly httpStatus: number | undefined;

  constructor(
    message: string,
    reason: WorkerFailureReason,
    httpStatus?: number,
  ) {
    super(message);
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

/** What a host prepared for one operation: what to run, and how to read its result. */
export interface PreparedOperation<T> {
  invocation: PluginInvocation;
  parse(value: unknown): T;
}

/** What a host learns about an operation while it prepares it, for its event. */
export interface OperationRecord {
  /** The package the operation runs. */
  plugin(facts: {
    version: string;
    source: "installed" | "development";
    apiVersion: number;
  }): void;
  /** The secret values the plugin receives, which its errors may echo. */
  secrets(values: readonly string[]): void;
}

interface Operation {
  pluginId: string;
  method: string;
  /** Set once prepared: an API 3 package shares the host's worker threads. */
  workerThread?: boolean;
  /** The connection it runs for, if any. */
  connectionId?: string;
  cancelled?: Error;
  cancelReason?: PluginCancelReason;
  cancelWorker?: (error: Error) => Promise<void>;
  done: Promise<void>;
}

interface WorkerLifetimeOptions<TMethod extends string> {
  name: "Plugin" | "Schema plugin";
  /** What runs each operation's plugin code. */
  runtime: PluginRuntime;
  requestTimeoutMs: number;
  /** Where each worker run's `plugin_operation` event goes. Nowhere by default. */
  events?: ApiEvents;
  /** The event each plugin method's run emits. A new method needs one. */
  eventNames: Record<TMethod, PluginOperationEventName>;
  /** The switchable capability a method serves, if any. */
  capabilityOf?: (method: TMethod) => string | undefined;
  /** A run went past its time, and its runtime was asked to terminate it. */
  onTimeout?: (invocation: PluginInvocation) => void;
}

type OperationUnit = Unit<AjourCatalog, PluginOperationEventName>;

/**
 * Bounds discovery and execution together, then terminates each run through
 * the runtime before releasing its slot. Each run emits one `plugin_operation` event,
 * a child span of the unit that started it, with how it ended.
 */
export class PluginWorkerLifetime<TMethod extends string> {
  private readonly operations = new Set<Operation>();
  private shutdownPromise?: Promise<void>;
  private shuttingDown = false;

  private readonly options: WorkerLifetimeOptions<TMethod>;
  private readonly events: ApiEvents;

  constructor(options: WorkerLifetimeOptions<TMethod>) {
    this.options = options;
    this.events =
      options.events ?? createApiEvents({ sink: nowhere, userDataPath: "" });
  }

  get activeOperationCount() {
    return this.operations.size;
  }

  assertRunning() {
    if (this.shuttingDown) {
      throw new PluginOperationRefused(
        `${this.options.name} host is shutting down.`,
        "host_stopping",
      );
    }
  }

  /**
   * Runs one plugin method through the runtime. `check` runs first, inside
   * the operation's event, so a refusal it throws is recorded.
   */
  async run<T>(
    pluginId: string,
    method: TMethod,
    prepare: (record: OperationRecord) => Promise<PreparedOperation<T>>,
    options: { connectionId?: string; check?: () => void } = {},
  ): Promise<T> {
    // Who started the request that runs it started the operation too.
    const unit = this.events.start(this.options.eventNames[method], {
      kind: "plugin_operation",
      trigger: this.events.current()?.trigger ?? "system",
    }) as OperationUnit;
    const admittedAt = Date.now();
    const capability = this.options.capabilityOf?.(method);
    unit.set({
      plugin: { id: pluginId },
      ...(options.connectionId
        ? { connection: { id: options.connectionId } }
        : {}),
      worker: {
        host: this.options.name === "Plugin" ? "plugin" : "schema",
        method,
        ...(capability ? { capability } : {}),
        active_operations: this.operations.size,
        timeout_ms: this.options.requestTimeoutMs,
      },
    });
    let secrets: readonly string[] | undefined;
    const record: OperationRecord = {
      plugin: (facts) =>
        unit.set({
          plugin: {
            version: facts.version,
            source: facts.source,
            api_version: facts.apiVersion,
          },
        }),
      secrets: (values) => {
        secrets = values;
      },
    };
    let operation: Operation | undefined;
    try {
      return await unit.enter(async () => {
        this.assertRunning();
        options.check?.();
        if (
          this.countOperations((other) => other.pluginId === pluginId) >=
          MAX_CONCURRENT_OPERATIONS
        ) {
          throw new PluginOperationRefused(
            `Too many operations of ${this.options.name.toLowerCase()} "${pluginId}" are already running.`,
            "capacity",
          );
        }
        let release!: () => void;
        const registered: Operation = {
          pluginId,
          method,
          ...(options.connectionId
            ? { connectionId: options.connectionId }
            : {}),
          done: new Promise<void>((resolve) => {
            release = resolve;
          }),
        };
        operation = registered;
        this.operations.add(registered);
        try {
          const prepared = await prepare(record);
          if (registered.cancelled) throw registered.cancelled;
          this.assertRunning();
          if (prepared.invocation.apiVersion < 4) {
            // Worker threads stay shared by the host, as before API 4.
            if (
              this.countOperations((other) => other.workerThread === true) >=
              MAX_CONCURRENT_OPERATIONS
            ) {
              throw new PluginOperationRefused(
                `Too many ${this.options.name.toLowerCase()} operations are already running.`,
                "capacity",
              );
            }
            registered.workerThread = true;
          }
          unit.set({ worker: { prepare_ms: Date.now() - admittedAt } });
          return await this.invoke(registered, method, prepared, unit);
        } finally {
          this.operations.delete(registered);
          release();
        }
      });
    } catch (error) {
      // An operation cancelled while it prepared may fail on the way out,
      // such as at a shutdown check: the cancellation is why it ended.
      const registered = operation as Operation | undefined;
      if (registered?.cancelled) {
        unit.cancel(registered.cancelReason);
        // The caller's message, with the reason its route's event needs.
        throw new PluginOperationCancelled(
          registered.cancelled.message,
          registered.cancelReason,
          registered.cancelled,
        );
      } else if (error instanceof PluginOperationRefused) {
        unit.refuse(error.reason);
      } else if (error instanceof PluginWorkerFailure) {
        unit.fail(error, {
          ...(error.reason === "timeout" ? { outcome: "timeout" } : {}),
          reason: error.reason,
          ...(secrets ? { secrets } : {}),
        });
      } else if (unit.outcome === undefined) {
        unit.fail(withoutContent(error), secrets ? { secrets } : {});
      }
      throw error;
    } finally {
      unit.end();
    }
  }

  /**
   * Cancels the plugin's operations, or only those whose method `methods`
   * keeps, and only those of `connectionId` when it is given. Returns how
   * many it cancelled.
   */
  async cancel(
    error: Error,
    reason: PluginCancelReason | undefined,
    pluginId?: string,
    methods?: (method: TMethod) => boolean,
    connectionId?: string,
  ): Promise<number> {
    const matchingOperations = Array.from(this.operations).filter(
      (operation) =>
        (pluginId === undefined || operation.pluginId === pluginId) &&
        (connectionId === undefined ||
          operation.connectionId === connectionId) &&
        (methods === undefined || methods(operation.method as TMethod)),
    );
    await Promise.allSettled(
      matchingOperations.map((operation) => {
        // Discovery may still be pending. It must not start a worker after cancellation.
        operation.cancelled = error;
        operation.cancelReason = reason;
        return operation.cancelWorker?.(error);
      }),
    );
    return matchingOperations.length;
  }

  /**
   * Resolves once no operation runs, or after `ms`, whichever comes first,
   * as a quit lets running operations finish (#217).
   */
  async whenIdle(ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    try {
      while (this.operations.size > 0) {
        const settled = await Promise.race([
          Promise.all(
            Array.from(this.operations, (operation) => operation.done),
          ).then(() => "settled" as const),
          deadline.then(() => "deadline" as const),
        ]);
        if (settled === "deadline") return;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shuttingDown = true;
      this.shutdownPromise = (async () => {
        await this.cancel(
          new Error(
            `${this.options.name} operation stopped because the app is shutting down.`,
          ),
          "shutdown",
        );
        await Promise.all(
          Array.from(this.operations, (operation) => operation.done),
        );
      })();
    }
    return this.shutdownPromise;
  }

  private countOperations(matches: (operation: Operation) => boolean) {
    let count = 0;
    for (const operation of this.operations) if (matches(operation)) count += 1;
    return count;
  }

  /**
   * The error a failed plugin call ends with, for both ways a plugin fails:
   * an error it returns, or an uncaught throw. The plugin's message is
   * trimmed and cut, ending in "…". A message that is missing or blank
   * becomes "Unknown plugin error.", so a failure is never shown as no error
   * at all.
   */
  private pluginFailure(
    message: unknown,
    reason: WorkerFailureReason = "plugin_error",
    httpStatus?: number,
  ): Error {
    const text = typeof message === "string" ? message.trim() : "";
    return new PluginWorkerFailure(
      text
        ? cutPluginErrorMessage(text)
        : `Unknown ${this.options.name.toLowerCase()} error.`,
      reason,
      httpStatus,
    );
  }

  /** The error a run that settled without a result ends with. */
  private runFailure(
    outcome: Exclude<PluginRunOutcome, { ok: true }>,
    operation: Operation,
    method: TMethod,
  ): Error {
    switch (outcome.failure) {
      case "plugin_error":
        return this.pluginFailure(
          outcome.message,
          "plugin_error",
          outcome.httpStatus,
        );
      case "missing_export":
        return this.pluginFailure(
          `${this.options.name} does not export ${method}().`,
        );
      case "result_too_large":
        return this.pluginFailure(
          `${this.options.name} result exceeds the allowed size.`,
          "result_too_large",
        );
      case "exited_early":
        return new PluginWorkerFailure(
          `${this.options.name} "${operation.pluginId}" exited before returning a result (code ${outcome.exitCode}).`,
          "exited_early",
        );
      case "crashed":
        return new PluginWorkerFailure(
          `${this.options.name} "${operation.pluginId}" stopped before returning a result: its process ${CRASH_CAUSES[outcome.cause]}.`,
          "crashed",
        );
      case "runtime_unavailable":
        return new PluginOperationRefused(
          `${PLUGINS_TURNED_OFF_NOTICE} ${outcome.reason}`.trim(),
          "runtime_unavailable",
        );
      case "terminated":
        // Only the lifetime terminates a run, and it has its error by then.
        return new PluginWorkerFailure(
          `${this.options.name} "${operation.pluginId}" stopped before returning a result.`,
          "exited_early",
        );
    }
  }

  private invoke<T>(
    operation: Operation,
    method: TMethod,
    prepared: PreparedOperation<T>,
    unit: OperationUnit,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = this.options.runtime.start(prepared.invocation);
      const startedAt = Date.now();
      let finalizationPromise: Promise<void> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finalize = (
        reason: PluginTerminateReason,
        error?: Error,
        result?: unknown,
      ) => {
        finalizationPromise ??= (async () => {
          if (timeout) clearTimeout(timeout);
          await run.terminate(reason);
          unit.set({ worker: { worker_ms: Date.now() - startedAt } });
          if (error) {
            reject(error);
          } else {
            try {
              resolve(prepared.parse(result));
            } catch (parseError) {
              // The message is about what the plugin returned: callers show
              // it, and the event holds its type and code only.
              const invalid = new InvalidPluginResultError(parseError);
              unit.fail(withoutContent(invalid), { reason: "invalid_result" });
              reject(invalid);
            }
          }
        })();
        return finalizationPromise;
      };
      operation.cancelWorker = (error) => finalize("cancelled", error);
      void run.settled.then((outcome) => {
        // A run cancelled or timed out first already has its error.
        if (finalizationPromise) return;
        if ("resultBytes" in outcome && outcome.resultBytes !== undefined) {
          unit.set({ worker: { result_bytes: outcome.resultBytes } });
        }
        if (!outcome.ok && outcome.failure === "crashed") {
          unit.set({ worker: { crash_cause: outcome.cause } });
        }
        if (outcome.ok) {
          void finalize("settled", undefined, outcome.result);
        } else {
          void finalize("settled", this.runFailure(outcome, operation, method));
        }
      });
      timeout = setTimeout(() => {
        if (!finalizationPromise) this.options.onTimeout?.(prepared.invocation);
        void finalize(
          "timeout",
          new PluginWorkerFailure(
            `${this.options.name} "${operation.pluginId}" timed out while handling ${method}.`,
            "timeout",
          ),
        );
      }, this.options.requestTimeoutMs);
    });
  }
}
