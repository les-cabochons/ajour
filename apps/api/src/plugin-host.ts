import path from "node:path";
import { pathToFileURL } from "node:url";
import { PluginWorkerLifetime } from "./plugin-worker-lifetime.ts";
import { readFile } from "node:fs/promises";
import {
  CONNECTOR_PLUGIN_API_VERSION,
  connectorFieldValuesSchema,
  connectorPluginSyncResultSchema,
  connectorPluginValidationResultSchema,
  connectorSettleStatesRequestSchema,
  connectorSettleStatesResultSchema,
  connectorSettleWriteRequestSchema,
  connectorSettleWriteResultSchema,
  connectorSyncWorkItemSchema,
  type ConnectorFieldValues,
  type ConnectorPluginManifest,
  type ConnectorPluginSyncResult,
  type ConnectorPluginValidationResult,
  type ConnectorSettleStatesRequest,
  type ConnectorSettleStatesResult,
  type ConnectorSettleWriteRequest,
  type ConnectorSettleWriteResult,
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
type PluginMethod =
  "validateConnection" | "syncConnection" | "listSettleStates" | "writeSettle";
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
  private readonly workers: PluginWorkerLifetime<PluginMethod>;
  private activePackageReaders = 0;
  private packageReadersDrainedPromise?: Promise<void>;
  private resolvePackageReadersDrained?: () => void;
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
    this.workers = new PluginWorkerLifetime({
      name: "Connector",
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      workerScriptUrl:
        options.workerScriptUrl ??
        new URL("./plugin-worker.mjs", import.meta.url),
    });
  }

  get activeOperationCount() {
    return this.workers.activeOperationCount;
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
      if (this.workers.activeOperationCount > 0) {
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
      await this.cancelPluginOperations(
        pluginId,
        new Error(`Connector plugin "${pluginId}" was uninstalled.`),
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
    await this.workers.cancel(error, pluginId);
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

  /** Whether the plugin declares the settle capability. */
  async supportsSettle(pluginId: string): Promise<boolean> {
    this.assertRunning();
    const plugin = (await this.discoverPlugins()).get(pluginId);
    return plugin?.manifest.capabilities?.settle ?? false;
  }

  async listSettleStates(
    pluginId: string,
    connection: PluginInvocationConnection,
    request: ConnectorSettleStatesRequest,
  ): Promise<ConnectorSettleStatesResult> {
    await this.assertSupportsSettle(pluginId);
    return await this.invokePlugin(
      pluginId,
      "listSettleStates",
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: connectorSettleStatesRequestSchema.parse(request),
      },
      connectorSettleStatesResultSchema,
    );
  }

  async writeSettle(
    pluginId: string,
    connection: PluginInvocationConnection,
    request: ConnectorSettleWriteRequest,
  ): Promise<ConnectorSettleWriteResult> {
    await this.assertSupportsSettle(pluginId);
    return await this.invokePlugin(
      pluginId,
      "writeSettle",
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: connectorSettleWriteRequestSchema.parse(request),
      },
      connectorSettleWriteResultSchema,
    );
  }

  async shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shuttingDown = true;
      const pendingOperations = [
        this.initializationPromise,
        this.packageMutationPromise,
        this.workers.shutdown(),
      ].filter((operation): operation is Promise<unknown> =>
        Boolean(operation),
      );
      this.shutdownPromise = Promise.allSettled(pendingOperations).then(
        () => undefined,
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
    this.assertCanInvoke();
    return await this.workers.run(pluginId, method, async () => {
      const plugin = await this.getPlugin(pluginId);
      // Discovery awaited, so shutdown or a package change may have started meanwhile.
      this.assertCanInvoke();
      return {
        workerData: {
          apiVersion: CONNECTOR_PLUGIN_API_VERSION,
          entrypointUrl: pathToFileURL(plugin.entrypointPath).toString(),
          method,
          params,
        },
        parse: (result: unknown) => schema.parse(result),
      };
    });
  }

  private async assertSupportsSettle(pluginId: string) {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin.manifest.capabilities?.settle) {
      throw new Error(
        `Connector plugin "${pluginId}" does not support settling backlog items.`,
      );
    }
  }

  private assertCanInvoke() {
    this.assertRunning();
    if (this.mutatingPluginPackage) {
      throw new Error("Connector plugin package change is in progress.");
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
