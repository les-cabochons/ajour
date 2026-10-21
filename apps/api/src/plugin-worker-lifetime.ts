import { Worker } from "node:worker_threads";
import { ZodError } from "zod";
import type {
  AjourCatalog,
  EventName,
  KindOf,
} from "../../../packages/wide-events/catalog.ts";
import type { Unit } from "../../../packages/wide-events/index.ts";
import { createApiEvents, type ApiEvents } from "./events.ts";
import { nowhere } from "../../../packages/wide-events/sinks.ts";

/** Each host owns its own lifetime instance, so plugin and data-shape quotas stay separate. */
const MAX_CONCURRENT_OPERATIONS_PER_HOST = 4;
const MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;

/** An event a worker run may be named: one whose kinds include `plugin_operation`. */
export type PluginOperationEventName = {
  [Name in EventName<AjourCatalog>]: "plugin_operation" extends KindOf<
    AjourCatalog,
    Name
  >
    ? Name
    : never;
}[EventName<AjourCatalog>];

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
  | "agent_access";

/** Why a registered plugin operation was cancelled. */
export type PluginCancelReason =
  "system_off" | "plugin_off" | "capability_off" | "uninstalled" | "shutdown";

/** How a worker failed. */
type WorkerFailureReason =
  "timeout" | "result_too_large" | "exited_early" | "plugin_error";

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

/** A worker that timed out, exited early, or ended with the plugin's error. */
class PluginWorkerFailure extends Error {
  readonly reason: WorkerFailureReason;

  constructor(message: string, reason: WorkerFailureReason) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Cuts a plugin error the way plugin-worker.mjs does, ending it with "…". The
 * cut may split a secret, and the mark is how the host's redaction knows.
 */
function cutErrorMessage(message: string) {
  return message.length <= MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS
    ? message
    : `${message.slice(0, MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS - 1)}…`;
}

/**
 * A result or input that failed validation, as an event holds it: its
 * type, never its message, which can quote what the plugin returned.
 */
function contentFreeError(error: unknown) {
  if (!(error instanceof ZodError)) return error;
  const standIn = new Error("The value does not match its schema.");
  standIn.name = "ZodError";
  return standIn;
}

interface WorkerInvocation<T> {
  workerData: unknown;
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
  cancelled?: Error;
  cancelReason?: PluginCancelReason;
  cancelWorker?: (error: Error) => Promise<void>;
  done: Promise<void>;
}

interface WorkerLifetimeOptions<TMethod extends string> {
  name: "Plugin" | "Schema plugin";
  workerScriptUrl: URL;
  requestTimeoutMs: number;
  /** Where each worker run's `plugin_operation` event goes. Nowhere by default. */
  events?: ApiEvents;
  /** The event each plugin method's run emits. A new method needs one. */
  eventNames: Record<TMethod, PluginOperationEventName>;
  /** The switchable capability a method serves, if any. */
  capabilityOf?: (method: TMethod) => string | undefined;
}

type OperationUnit = Unit<AjourCatalog, PluginOperationEventName>;

/**
 * Bounds discovery and execution together, then terminates each worker
 * before releasing its slot. Each run emits one `plugin_operation` event,
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
   * Runs one plugin method in a worker. `check` runs first, inside the
   * operation's event, so a refusal it throws is recorded.
   */
  async run<T>(
    pluginId: string,
    method: TMethod,
    prepare: (record: OperationRecord) => Promise<WorkerInvocation<T>>,
    options: { connectionId?: string; check?: () => void } = {},
  ): Promise<T> {
    const unit = this.events.start(this.options.eventNames[method], {
      kind: "plugin_operation",
      trigger: "system",
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
        if (this.operations.size >= MAX_CONCURRENT_OPERATIONS_PER_HOST) {
          throw new PluginOperationRefused(
            `Too many ${this.options.name.toLowerCase()} operations are already running.`,
            "capacity",
          );
        }
        let release!: () => void;
        const registered: Operation = {
          pluginId,
          method,
          done: new Promise<void>((resolve) => {
            release = resolve;
          }),
        };
        operation = registered;
        this.operations.add(registered);
        try {
          const invocation = await prepare(record);
          if (registered.cancelled) throw registered.cancelled;
          this.assertRunning();
          unit.set({ worker: { prepare_ms: Date.now() - admittedAt } });
          return await this.invoke(registered, method, invocation, unit);
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
      } else if (error instanceof PluginOperationRefused) {
        unit.refuse(error.reason);
      } else if (error instanceof PluginWorkerFailure) {
        unit.fail(error, {
          ...(error.reason === "timeout" ? { outcome: "timeout" } : {}),
          reason: error.reason,
          ...(secrets ? { secrets } : {}),
        });
      } else if (unit.outcome === undefined) {
        unit.fail(contentFreeError(error), secrets ? { secrets } : {});
      }
      throw error;
    } finally {
      unit.end();
    }
  }

  /** Cancels the plugin's operations, or only those whose method `methods` keeps. */
  async cancel(
    error: Error,
    reason: PluginCancelReason | undefined,
    pluginId?: string,
    methods?: (method: TMethod) => boolean,
  ): Promise<void> {
    const matchingOperations = Array.from(this.operations).filter(
      (operation) =>
        (pluginId === undefined || operation.pluginId === pluginId) &&
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

  /**
   * The error a failed plugin call ends with, for both ways a worker fails:
   * a message it posts, or an uncaught throw. The plugin's message is trimmed
   * and cut, ending in "…". A message that is missing or blank becomes
   * "Unknown plugin error.", so a failure is never shown as no error at all.
   */
  private pluginFailure(
    message: unknown,
    reason: WorkerFailureReason = "plugin_error",
  ): Error {
    const text = typeof message === "string" ? message.trim() : "";
    return new PluginWorkerFailure(
      text
        ? cutErrorMessage(text)
        : `Unknown ${this.options.name.toLowerCase()} error.`,
      reason,
    );
  }

  private invoke<T>(
    operation: Operation,
    method: TMethod,
    invocation: WorkerInvocation<T>,
    unit: OperationUnit,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const worker = new Worker(this.options.workerScriptUrl, {
        env: {},
        execArgv: [],
        stdout: true,
        stderr: true,
        workerData: invocation.workerData,
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      });
      const startedAt = Date.now();
      let settled = false;
      let finalizationPromise: Promise<void> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finalize = (error?: Error, result?: unknown) => {
        finalizationPromise ??= (async () => {
          settled = true;
          if (timeout) clearTimeout(timeout);
          worker.removeAllListeners();
          try {
            await worker.terminate();
          } catch {
            // The worker may already have exited after posting its result.
          }
          unit.set({ worker: { worker_ms: Date.now() - startedAt } });
          if (error) {
            reject(error);
          } else {
            try {
              resolve(invocation.parse(result));
            } catch (parseError) {
              unit.fail(contentFreeError(parseError), {
                reason: "invalid_result",
              });
              reject(parseError);
            }
          }
        })();
        return finalizationPromise;
      };
      operation.cancelWorker = (error) => finalize(error);
      // An uncaught asynchronous throw in plugin code arrives here, past the
      // worker's own cut, and may be any value.
      worker.once("error", (error: unknown) => {
        void finalize(
          this.pluginFailure(
            error instanceof Error ? error.message : undefined,
          ),
        );
      });
      worker.once(
        "message",
        (
          message: {
            ok?: boolean;
            result?: unknown;
            error?: unknown;
            reason?: unknown;
            bytes?: unknown;
          } | null,
        ) => {
          if (typeof message?.bytes === "number") {
            unit.set({ worker: { result_bytes: message.bytes } });
          }
          if (message?.ok === true) {
            void finalize(undefined, message.result);
          } else {
            void finalize(
              this.pluginFailure(
                message?.error,
                message?.reason === "result_too_large"
                  ? "result_too_large"
                  : "plugin_error",
              ),
            );
          }
        },
      );
      worker.once("exit", (code) => {
        if (!settled)
          void finalize(
            new PluginWorkerFailure(
              `${this.options.name} "${operation.pluginId}" exited before returning a result (code ${code}).`,
              "exited_early",
            ),
          );
      });
      timeout = setTimeout(() => {
        void finalize(
          new PluginWorkerFailure(
            `${this.options.name} "${operation.pluginId}" timed out while handling ${method}.`,
            "timeout",
          ),
        );
      }, this.options.requestTimeoutMs);
      worker.stdout?.resume();
      worker.stderr?.resume();
    });
  }
}
