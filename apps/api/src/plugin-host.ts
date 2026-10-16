import path from "node:path";
import { pathToFileURL } from "node:url";
import { PluginWorkerLifetime } from "./plugin-worker-lifetime.ts";
import { readFile, realpath } from "node:fs/promises";
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
  connectorValidationContextSchema,
  type ConnectorFieldValues,
  type ConnectorPluginManifest,
  type ConnectorPluginSyncResult,
  type ConnectorPluginValidationResult,
  type ConnectorSettleStatesRequest,
  type ConnectorSettleStatesResult,
  type ConnectorSettleWriteRequest,
  type ConnectorSettleWriteResult,
  type ConnectorSyncWorkItem,
  type ConnectorValidationContext,
  type SwitchableCapability,
} from "../../../packages/shared/connectors.ts";
import {
  codeHostOperations,
  type CodeHostOperation,
  type CodeHostOperationRequest,
  type CodeHostOperationResult,
} from "../../../packages/shared/code-host.ts";
import {
  calendarOperations,
  type CalendarOperation,
  type CalendarOperationRequest,
  type CalendarOperationResult,
} from "../../../packages/shared/calendar.ts";
import { z } from "zod";
import {
  discoverInstalledConnectorPlugins,
  installConnectorPluginArchive,
  reconcileConnectorPluginInstallRoot,
  readAgentTaskPromptFile,
  readConnectorPlugin,
  uninstallConnectorPluginPackage,
  type InstalledConnectorPlugin,
  type ResolvedConnectorPlugin,
  type UnavailableConnectorPlugin,
} from "./plugin-package.ts";

interface PluginHostOptions {
  installedPluginDirectory: string;
  developmentPluginDirectories?: string[];
  bundledPluginArchives?: string[];
  allowDevelopmentPlugins?: boolean;
  requestTimeoutMs?: number;
  workerScriptUrl?: URL;
  /**
   * Runs once the operation is registered and before its worker starts, and
   * throws to refuse it. Deactivation saves its state and then cancels the
   * registered operations, so an operation either sees the new state here or
   * is cancelled.
   */
  operationGate?: (pluginId: string, method: PluginMethod) => Promise<void>;
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
export type PluginMethod =
  | "validateConnection"
  | "syncConnection"
  | "listSettleStates"
  | "writeSettle"
  | CodeHostOperation
  | CalendarOperation;
const missingCapabilityMessages: Record<SwitchableCapability, string> = {
  connector: "does not sync backlog items",
  codeHost: "does not provide pull requests",
  calendar: "does not provide calendar events",
};
/** The switchable capability a plugin method serves. Validation serves none. */
export function capabilityOfMethod(
  method: PluginMethod,
): SwitchableCapability | undefined {
  if (
    method === "syncConnection" ||
    method === "listSettleStates" ||
    method === "writeSettle"
  ) {
    return "connector";
  }
  if (method === "validateConnection") return undefined;
  return method in calendarOperations ? "calendar" : "codeHost";
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
  private readonly operationGate?: PluginHostOptions["operationGate"];
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
    this.operationGate = options.operationGate;
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
    return (await this.inspectPlugins()).plugins;
  }

  /** Runnable plugins, plus installed packages built for another plugin API. */
  async inspectPlugins(): Promise<{
    plugins: ConnectorPluginManifest[];
    unavailable: UnavailableConnectorPlugin[];
  }> {
    this.assertRunning();
    const { plugins, unavailable } = await this.discoverPlugins();
    return {
      plugins: Array.from(plugins.values())
        .map((plugin) => plugin.manifest)
        .sort(comparePlugins),
      unavailable: Array.from(unavailable.values()),
    };
  }

  /**
   * `afterInstall` runs before the package change ends, while operations are
   * still refused, so activation state it saves applies before anything can
   * run the new package.
   */
  async installPluginArchive(
    archiveBytes: Uint8Array,
    archiveFilename: string,
    afterInstall?: (installed: InstalledConnectorPlugin) => Promise<void>,
  ): Promise<InstalledConnectorPlugin> {
    this.assertRunning();
    return await this.runPackageMutation(async () => {
      await this.ensureInitialized();
      if (this.workers.activeOperationCount > 0) {
        throw new Error(
          "Wait for active connector operations to finish before installing a plugin.",
        );
      }

      const installed = await installConnectorPluginArchive({
        archiveBytes,
        archiveFilename,
        installRoot: this.installedPluginDirectory,
        replaceExisting: true,
      });
      if (installed.installed) await afterInstall?.(installed);
      return installed;
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

  /** Cancels the running operations of one capability, such as a pull request sync. */
  async cancelCapabilityOperations(
    pluginId: string,
    capability: SwitchableCapability,
    error: Error,
  ): Promise<void> {
    await this.workers.cancel(
      error,
      pluginId,
      (method) => capabilityOfMethod(method) === capability,
    );
  }

  /** `context` names the switchable capabilities that are on. */
  async validateConnection(
    pluginId: string,
    config: ConnectorFieldValues,
    context?: ConnectorValidationContext,
  ): Promise<ConnectorPluginValidationResult> {
    return await this.invokePlugin(
      pluginId,
      "validateConnection",
      {
        config: connectorFieldValuesSchema.parse(config),
        ...(context
          ? { context: connectorValidationContextSchema.parse(context) }
          : {}),
      },
      connectorPluginValidationResultSchema,
    );
  }

  async syncConnection(
    pluginId: string,
    connection: PluginInvocationConnection,
    workItems: ConnectorSyncWorkItem[] = [],
  ): Promise<ConnectorPluginSyncResult> {
    await this.assertCapability(pluginId, "connector");
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
    const plugin = (await this.discoverPlugins()).plugins.get(pluginId);
    return plugin?.manifest.capabilities.connector?.settle ?? false;
  }

  /** Whether the plugin declares the given capability. */
  async hasCapability(
    pluginId: string,
    capability: SwitchableCapability,
  ): Promise<boolean> {
    this.assertRunning();
    const plugin = (await this.discoverPlugins()).plugins.get(pluginId);
    return plugin?.manifest.capabilities[capability] !== undefined;
  }

  /** An agent task's prompt, read fresh from the plugin folder. */
  async readAgentTaskPrompt(pluginId: string, taskId: string): Promise<string> {
    this.assertRunning();
    const plugin = await this.getPlugin(pluginId);
    const task = plugin.manifest.capabilities.agentTask?.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (!task) {
      throw new Error(`Plugin "${pluginId}" has no agent task "${taskId}".`);
    }
    return await readAgentTaskPromptFile(
      plugin.directory,
      await realpath(plugin.directory),
      plugin.manifest,
      task,
    );
  }

  /** Runs one code host operation. See `codeHostOperations`. */
  async runCodeHostOperation<Operation extends CodeHostOperation>(
    pluginId: string,
    operation: Operation,
    connection: PluginInvocationConnection,
    request: CodeHostOperationRequest<Operation>,
  ): Promise<CodeHostOperationResult<Operation>> {
    await this.assertCapability(pluginId, "codeHost");
    const contract = codeHostOperations[operation];
    const resultSchema = contract.result as {
      parse: (value: unknown) => CodeHostOperationResult<Operation>;
    };
    return await this.invokePlugin(
      pluginId,
      operation,
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: contract.request.parse(request),
      },
      resultSchema,
    );
  }

  /** Runs one calendar operation. See `calendarOperations`. */
  async runCalendarOperation<Operation extends CalendarOperation>(
    pluginId: string,
    operation: Operation,
    connection: PluginInvocationConnection,
    request: CalendarOperationRequest<Operation>,
  ): Promise<CalendarOperationResult<Operation>> {
    await this.assertCapability(pluginId, "calendar");
    const contract = calendarOperations[operation];
    const resultSchema = contract.result as {
      parse: (value: unknown) => CalendarOperationResult<Operation>;
    };
    return await this.invokePlugin(
      pluginId,
      operation,
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: contract.request.parse(request),
      },
      resultSchema,
    );
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
      if (!plugin.entrypointPath) {
        throw new Error(`Plugin "${pluginId}" runs no code.`);
      }
      await this.operationGate?.(pluginId, method);
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

  private async assertCapability(
    pluginId: string,
    capability: SwitchableCapability,
  ) {
    const plugin = await this.getPlugin(pluginId);
    if (plugin.manifest.capabilities[capability] === undefined) {
      throw new Error(
        `Plugin "${pluginId}" ${missingCapabilityMessages[capability]}.`,
      );
    }
  }

  private async assertSupportsSettle(pluginId: string) {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin.manifest.capabilities.connector?.settle) {
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
    const { plugins, unavailable } = await this.discoverPlugins();
    const plugin = plugins.get(pluginId);
    if (!plugin) {
      throw new Error(
        unavailable.get(pluginId)?.reason ??
          `Connector plugin "${pluginId}" is not installed.`,
      );
    }

    return plugin;
  }

  private async discoverPlugins(): Promise<{
    plugins: Map<string, ResolvedConnectorPlugin>;
    unavailable: Map<string, UnavailableConnectorPlugin>;
  }> {
    await this.ensureInitialized();
    return await this.runPackageRead(async () => {
      const plugins = new Map<string, ResolvedConnectorPlugin>();
      const unavailable = new Map<string, UnavailableConnectorPlugin>();
      const installed = await discoverInstalledConnectorPlugins(
        this.installedPluginDirectory,
      );

      for (const plugin of installed.plugins) {
        plugins.set(plugin.manifest.id, plugin);
      }
      for (const plugin of installed.unavailable) {
        unavailable.set(plugin.manifest.id, plugin);
      }

      if (this.allowDevelopmentPlugins) {
        for (const directory of this.developmentPluginDirectories) {
          try {
            const plugin = await readConnectorPlugin(directory, "development");
            plugins.set(plugin.manifest.id, plugin);
            unavailable.delete(plugin.manifest.id);
          } catch (error) {
            console.error(
              `Skipping invalid development connector plugin "${directory}".`,
              error,
            );
          }
        }
      }

      return { plugins, unavailable };
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
