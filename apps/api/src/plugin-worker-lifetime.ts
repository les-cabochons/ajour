import { Worker } from "node:worker_threads";

/** Each host owns its own lifetime instance, so connector and data-shape quotas stay separate. */
const MAX_CONCURRENT_OPERATIONS_PER_HOST = 4;
const MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;

interface WorkerInvocation<T> {
  workerData: unknown;
  parse(value: unknown): T;
}

interface Operation {
  pluginId: string;
  method: string;
  cancelled?: Error;
  cancelWorker?: (error: Error) => Promise<void>;
  done: Promise<void>;
}

interface WorkerLifetimeOptions {
  name: "Connector" | "Schema";
  workerScriptUrl: URL;
  requestTimeoutMs: number;
}

/**
 * Bounds discovery and execution together, then terminates each worker before releasing its slot.
 * `TMethod` is the host's plugin method union; it only appears in timeout messages.
 */
export class PluginWorkerLifetime<TMethod extends string> {
  private readonly operations = new Set<Operation>();
  private shutdownPromise?: Promise<void>;
  private shuttingDown = false;

  private readonly options: WorkerLifetimeOptions;

  constructor(options: WorkerLifetimeOptions) {
    this.options = options;
  }

  get activeOperationCount() {
    return this.operations.size;
  }

  assertRunning() {
    if (this.shuttingDown) {
      throw new Error(`${this.options.name} plugin host is shutting down.`);
    }
  }

  async run<T>(
    pluginId: string,
    method: TMethod,
    prepare: () => Promise<WorkerInvocation<T>>,
  ): Promise<T> {
    this.assertRunning();
    if (this.operations.size >= MAX_CONCURRENT_OPERATIONS_PER_HOST) {
      throw new Error(
        `Too many ${this.options.name.toLowerCase()} plugin operations are already running.`,
      );
    }
    let release!: () => void;
    const operation: Operation = {
      pluginId,
      method,
      done: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    this.operations.add(operation);
    try {
      const invocation = await prepare();
      if (operation.cancelled) throw operation.cancelled;
      this.assertRunning();
      return await this.invoke(operation, method, invocation);
    } finally {
      this.operations.delete(operation);
      release();
    }
  }

  /** Cancels the plugin's operations, or only those whose method `methods` keeps. */
  async cancel(
    error: Error,
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
        );
        await Promise.all(
          Array.from(this.operations, (operation) => operation.done),
        );
      })();
    }
    return this.shutdownPromise;
  }

  private invoke<T>(
    operation: Operation,
    method: TMethod,
    invocation: WorkerInvocation<T>,
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
          if (error) {
            reject(error);
          } else {
            try {
              resolve(invocation.parse(result));
            } catch (parseError) {
              reject(parseError);
            }
          }
        })();
        return finalizationPromise;
      };
      operation.cancelWorker = (error) => finalize(error);
      worker.once("error", (error) => {
        void finalize(error);
      });
      worker.once(
        "message",
        (
          message: { ok?: boolean; result?: unknown; error?: unknown } | null,
        ) => {
          if (message?.ok === true) {
            void finalize(undefined, message.result);
          } else {
            const detail =
              typeof message?.error === "string" && message.error.trim()
                ? message.error
                    .trim()
                    .slice(0, MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS)
                : `Unknown ${this.options.name.toLowerCase()} plugin error.`;
            void finalize(new Error(detail));
          }
        },
      );
      worker.once("exit", (code) => {
        if (!settled)
          void finalize(
            new Error(
              `${this.options.name} plugin "${operation.pluginId}" exited before returning a result (code ${code}).`,
            ),
          );
      });
      timeout = setTimeout(() => {
        void finalize(
          new Error(
            `${this.options.name} plugin "${operation.pluginId}" timed out while handling ${method}.`,
          ),
        );
      }, this.options.requestTimeoutMs);
      worker.stdout?.resume();
      worker.stderr?.resume();
    });
  }
}
