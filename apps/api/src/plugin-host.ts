import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import {
  CONNECTOR_PLUGIN_API_VERSION,
  connectorFieldValuesSchema,
  connectorPluginSyncResultSchema,
  connectorPluginValidationResultSchema,
  connectorSyncWorkItemSchema,
  type ConnectorFieldValues,
  type ConnectorPluginManifest,
  type ConnectorPluginSyncResult,
  type ConnectorPluginValidationResult,
  type ConnectorSyncWorkItem,
} from "../../../packages/shared/src/connectors.ts";
import { z } from "zod";
import {
  discoverInstalledConnectorPlugins,
  installConnectorPluginArchive,
  reconcileConnectorPluginInstallRoot,
  readConnectorPlugin,
  uninstallConnectorPluginPackage,
  type InstalledConnectorPlugin,
  type ResolvedConnectorPlugin,
} from "./plugin-package.ts";

interface PluginHostOptions {
  installedPluginDirectory: string;
  developmentPluginDirectories?: string[];
  bundledPluginArchives?: string[];
  allowDevelopmentPlugins?: boolean;
  requestTimeoutMs?: number;
  workerScriptUrl?: URL;
}

const pluginInvocationConnectionSchema = z.object({
  id: z.string().min(1).max(120),
  pluginId: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  tenantLabel: z.string().min(1).max(120),
  autoSync: z.boolean(),
  autoSyncIntervalMinutes: z.number().int().min(1).max(1440),
  connectedAt: z.number().int().positive(),
  lastSyncAt: z.number().int().positive().optional(),
  lastError: z.string().max(1000).optional(),
  config: connectorFieldValuesSchema,
});

type PluginInvocationConnection = z.infer<
  typeof pluginInvocationConnectionSchema
>;
type PluginMethod = "validateConnection" | "syncConnection";
const MAX_CONCURRENT_PLUGIN_OPERATIONS = 4;
const MAX_CONNECTOR_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;

interface WorkerReply {
  ok: boolean;
  result?: unknown;
  error?: unknown;
}

interface ActiveWorker {
  pluginId: string;
  cancel(error: Error): Promise<void>;
}

function comparePlugins(
  left: ConnectorPluginManifest,
  right: ConnectorPluginManifest,
) {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

export class ConnectorPluginManager {
  private readonly installedPluginDirectory: string;
  private readonly developmentPluginDirectories: string[];
  private readonly bundledPluginArchives: string[];
  private readonly allowDevelopmentPlugins: boolean;
  private readonly requestTimeoutMs: number;
  private readonly workerScriptUrl: URL;
  private readonly activeWorkers = new Map<Worker, ActiveWorker>();
  private activeOperationReservations = 0;
  private activePackageReaders = 0;
  private packageReadersDrainedPromise?: Promise<void>;
  private resolvePackageReadersDrained?: () => void;
  private operationsDrainedPromise?: Promise<void>;
  private resolveOperationsDrained?: () => void;
  private initializationPromise?: Promise<void>;
  private packageMutationPromise?: Promise<unknown>;
  private shutdownPromise?: Promise<void>;
  private mutatingPluginPackage = false;
  private shuttingDown = false;

  constructor(options: PluginHostOptions) {
    this.installedPluginDirectory = path.resolve(
      options.installedPluginDirectory,
    );
    this.developmentPluginDirectories = (
      options.developmentPluginDirectories ?? []
    ).map((directory) => path.resolve(directory));
    this.bundledPluginArchives = (options.bundledPluginArchives ?? []).map(
      (archive) => path.resolve(archive),
    );
    this.allowDevelopmentPlugins = options.allowDevelopmentPlugins ?? false;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.workerScriptUrl =
      options.workerScriptUrl ??
      new URL("./plugin-worker.mjs", import.meta.url);
  }

  get activeOperationCount() {
    return this.activeOperationReservations;
  }

  async listPlugins(): Promise<ConnectorPluginManifest[]> {
    this.assertRunning();
    const plugins = await this.discoverPlugins();
    return Array.from(plugins.values())
      .map((plugin) => plugin.manifest)
      .sort(comparePlugins);
  }

  async installPluginArchive(
    archiveBytes: Uint8Array,
    archiveFilename: string,
  ): Promise<InstalledConnectorPlugin> {
    this.assertRunning();
    return await this.runPackageMutation(async () => {
      await this.ensureInitialized();
      if (this.activeOperationReservations > 0) {
        throw new Error(
          "Wait for active connector operations to finish before installing a plugin.",
        );
      }

      return await installConnectorPluginArchive({
        archiveBytes,
        archiveFilename,
        installRoot: this.installedPluginDirectory,
        replaceExisting: true,
      });
    });
  }

  async uninstallPlugin(pluginId: string): Promise<ConnectorPluginManifest> {
    this.assertRunning();
    return await this.runPackageMutation(async () => {
      await this.ensureInitialized();
      const activePluginWorkers = Array.from(
        this.activeWorkers.values(),
      ).filter((activeWorker) => activeWorker.pluginId === pluginId);
      await Promise.allSettled(
        activePluginWorkers.map((activeWorker) =>
          activeWorker.cancel(
            new Error(`Connector plugin "${pluginId}" was uninstalled.`),
          ),
        ),
      );

      const removedPlugin = await uninstallConnectorPluginPackage({
        installRoot: this.installedPluginDirectory,
        pluginId,
      });
      if (!removedPlugin) {
        throw new Error(
          `Connector plugin "${pluginId}" is not installed as a managed package.`,
        );
      }

      return removedPlugin.manifest;
    });
  }

  async cancelPluginOperations(pluginId: string, error: Error): Promise<void> {
    const operations = Array.from(this.activeWorkers.values()).filter(
      (activeWorker) => activeWorker.pluginId === pluginId,
    );
    await Promise.allSettled(
      operations.map((activeWorker) => activeWorker.cancel(error)),
    );
  }

  async validateConnection(
    pluginId: string,
    config: ConnectorFieldValues,
  ): Promise<ConnectorPluginValidationResult> {
    return await this.invokePlugin(
      pluginId,
      "validateConnection",
      { config: connectorFieldValuesSchema.parse(config) },
      connectorPluginValidationResultSchema,
    );
  }

  async syncConnection(
    pluginId: string,
    connection: PluginInvocationConnection,
    workItems: ConnectorSyncWorkItem[] = [],
  ): Promise<ConnectorPluginSyncResult> {
    const payload = {
      connection: pluginInvocationConnectionSchema.parse(connection),
      workItems: workItems.map((workItem) =>
        connectorSyncWorkItemSchema.parse(workItem),
      ),
    };

    return await this.invokePlugin(
      pluginId,
      "syncConnection",
      payload,
      connectorPluginSyncResultSchema,
    );
  }

  async shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shuttingDown = true;
      const pendingOperations = [
        this.initializationPromise,
        this.packageMutationPromise,
        ...Array.from(this.activeWorkers.values()).map((activeWorker) =>
          activeWorker.cancel(
            new Error(
              "Connector operation stopped because the app is shutting down.",
            ),
          ),
        ),
      ].filter((operation): operation is Promise<unknown> =>
        Boolean(operation),
      );
      this.shutdownPromise = Promise.allSettled(pendingOperations).then(
        async () => {
          await this.waitForOperationsToDrain();
        },
      );
    }

    await this.shutdownPromise;
  }

  private async invokePlugin<T>(
    pluginId: string,
    method: PluginMethod,
    params: Record<string, unknown>,
    schema: { parse: (value: unknown) => T },
  ): Promise<T> {
    const releaseOperation = this.reservePluginOperation();
    try {
      const plugin = await this.getPlugin(pluginId);
      this.assertRunning();
      if (this.mutatingPluginPackage) {
        throw new Error("Connector plugin package change is in progress.");
      }

      return await new Promise<T>((resolve, reject) => {
        let worker: Worker;
        try {
          worker = new Worker(this.workerScriptUrl, {
            env: {},
            execArgv: [],
            stdout: true,
            stderr: true,
            workerData: {
              apiVersion: CONNECTOR_PLUGIN_API_VERSION,
              entrypointUrl: pathToFileURL(plugin.entrypointPath).toString(),
              method,
              params,
            },
            resourceLimits: {
              maxOldGenerationSizeMb: 128,
              maxYoungGenerationSizeMb: 32,
              stackSizeMb: 4,
            },
          });
        } catch (error) {
          releaseOperation();
          reject(error);
          return;
        }

        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;

        let finalizationPromise: Promise<void> | undefined;
        const finalize = (error?: Error, result?: unknown) => {
          finalizationPromise ??= (async () => {
            settled = true;
            if (timeout) {
              clearTimeout(timeout);
            }
            worker.removeAllListeners();

            try {
              await worker.terminate();
            } catch {
              // The worker may already have exited after posting its result.
            } finally {
              this.activeWorkers.delete(worker);
              releaseOperation();
            }

            if (error) {
              reject(error);
              return;
            }

            try {
              resolve(schema.parse(result));
            } catch (parseError) {
              reject(parseError);
            }
          })();
          return finalizationPromise;
        };

        worker.once("error", (error) => {
          void finalize(error);
        });
        worker.once("message", (message: WorkerReply) => {
          if (message?.ok === true) {
            void finalize(undefined, message.result);
            return;
          }

          const detail =
            typeof message?.error === "string" && message.error.trim()
              ? message.error
                  .trim()
                  .slice(0, MAX_CONNECTOR_PLUGIN_ERROR_MESSAGE_CHARACTERS)
              : "Unknown connector plugin error.";
          void finalize(new Error(detail));
        });
        worker.once("exit", (code) => {
          if (!settled) {
            void finalize(
              new Error(
                `Connector plugin "${pluginId}" exited before returning a result (code ${code}).`,
              ),
            );
          }
        });

        this.activeWorkers.set(worker, {
          pluginId,
          cancel: async (error) => await finalize(error),
        });
        timeout = setTimeout(() => {
          void finalize(
            new Error(
              `Connector plugin "${pluginId}" timed out while handling ${method}.`,
            ),
          );
        }, this.requestTimeoutMs);
        worker.stdout?.resume();
        worker.stderr?.resume();
      });
    } catch (error) {
      releaseOperation();
      throw error;
    }
  }

  private async getPlugin(pluginId: string): Promise<ResolvedConnectorPlugin> {
    const plugins = await this.discoverPlugins();
    const plugin = plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Connector plugin "${pluginId}" is not installed.`);
    }

    return plugin;
  }

  private async discoverPlugins(): Promise<
    Map<string, ResolvedConnectorPlugin>
  > {
    await this.ensureInitialized();
    return await this.runPackageRead(async () => {
      const plugins = new Map<string, ResolvedConnectorPlugin>();

      for (const plugin of await discoverInstalledConnectorPlugins(
        this.installedPluginDirectory,
      )) {
        plugins.set(plugin.manifest.id, plugin);
      }

      if (this.allowDevelopmentPlugins) {
        for (const directory of this.developmentPluginDirectories) {
          try {
            const plugin = await readConnectorPlugin(directory, "development");
            plugins.set(plugin.manifest.id, plugin);
          } catch (error) {
            console.error(
              `Skipping invalid development connector plugin "${directory}".`,
              error,
            );
          }
        }
      }

      return plugins;
    });
  }

  private async ensureInitialized() {
    this.assertRunning();
    if (!this.initializationPromise) {
      this.initializationPromise = this.installBundledPlugins();
    }
    const initialization = this.initializationPromise;
    try {
      await initialization;
    } catch (error) {
      if (this.initializationPromise === initialization) {
        this.initializationPromise = undefined;
      }
      throw error;
    }
  }

  private async installBundledPlugins() {
    await reconcileConnectorPluginInstallRoot(this.installedPluginDirectory);
    for (const archivePath of this.bundledPluginArchives) {
      try {
        const archiveBytes = await readFile(archivePath);
        await installConnectorPluginArchive({
          archiveBytes,
          archiveFilename: path.basename(archivePath),
          installRoot: this.installedPluginDirectory,
          replaceExisting: false,
        });
      } catch (error) {
        console.error(
          `Unable to install bundled connector plugin "${archivePath}".`,
          error,
        );
      }
    }
  }

  private assertRunning() {
    if (this.shuttingDown) {
      throw new Error("Connector plugin host is shutting down.");
    }
  }

  private reservePluginOperation() {
    this.assertRunning();
    if (this.mutatingPluginPackage) {
      throw new Error("Connector plugin package change is in progress.");
    }
    if (this.activeOperationReservations >= MAX_CONCURRENT_PLUGIN_OPERATIONS) {
      throw new Error(
        "Too many connector plugin operations are already running.",
      );
    }

    this.activeOperationReservations += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeOperationReservations -= 1;
      if (this.activeOperationReservations === 0) {
        this.resolveOperationsDrained?.();
        this.resolveOperationsDrained = undefined;
        this.operationsDrainedPromise = undefined;
      }
    };
  }

  private async waitForOperationsToDrain() {
    if (this.activeOperationReservations === 0) {
      return;
    }
    if (!this.operationsDrainedPromise) {
      this.operationsDrainedPromise = new Promise<void>((resolve) => {
        this.resolveOperationsDrained = resolve;
      });
    }
    await this.operationsDrainedPromise;
  }

  private async runPackageRead<T>(operation: () => Promise<T>): Promise<T> {
    while (this.packageMutationPromise) {
      await this.packageMutationPromise.catch(() => undefined);
    }

    this.activePackageReaders += 1;
    try {
      return await operation();
    } finally {
      this.activePackageReaders -= 1;
      if (this.activePackageReaders === 0) {
        this.resolvePackageReadersDrained?.();
        this.resolvePackageReadersDrained = undefined;
        this.packageReadersDrainedPromise = undefined;
      }
    }
  }

  private async waitForPackageReadersToDrain() {
    if (this.activePackageReaders === 0) {
      return;
    }
    if (!this.packageReadersDrainedPromise) {
      this.packageReadersDrainedPromise = new Promise<void>((resolve) => {
        this.resolvePackageReadersDrained = resolve;
      });
    }
    await this.packageReadersDrainedPromise;
  }

  private async runPackageMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertRunning();
    if (this.mutatingPluginPackage) {
      throw new Error(
        "Another connector plugin package change is already in progress.",
      );
    }

    this.mutatingPluginPackage = true;
    const mutation = (async () => {
      await this.waitForPackageReadersToDrain();
      return await operation();
    })();
    this.packageMutationPromise = mutation;
    try {
      return await mutation;
    } finally {
      if (this.packageMutationPromise === mutation) {
        this.packageMutationPromise = undefined;
      }
      this.mutatingPluginPackage = false;
    }
  }
}

export type ConnectorPluginConnection = PluginInvocationConnection;
