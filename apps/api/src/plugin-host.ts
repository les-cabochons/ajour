import path from "node:path";
import {
  PluginOperationRefused,
  PluginWorkerLifetime,
  type PluginCancelReason,
} from "./plugin-worker-lifetime.ts";
import { pluginMethodArguments, type PluginMethod } from "./plugin-methods.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import { WorkerPluginRuntime } from "./plugin-worker-runtime.ts";
import {
  CALENDAR_EVENTS,
  CODE_HOST_EVENTS,
  COMMENT_EVENTS,
  type PluginOperationEventName,
} from "./operation-events.ts";
import type { ApiEvents } from "./events.ts";
import { connectionSecretValues } from "./connection-credentials.ts";
import { readFile, realpath } from "node:fs/promises";
import {
  pluginFieldValuesSchema,
  backlogPluginSyncResultSchema,
  pluginValidationResultSchema,
  backlogSettleStatesRequestSchema,
  backlogSettleStatesResultSchema,
  backlogSettleWriteRequestSchema,
  backlogSettleWriteResultSchema,
  backlogReadDescriptionRequestSchema,
  backlogReadDescriptionResultSchema,
  backlogWriteDescriptionRequestSchema,
  backlogWriteDescriptionResultSchema,
  backlogSyncWorkItemSchema,
  pluginValidationContextSchema,
  type PluginFieldValues,
  type PluginManifest,
  type BacklogPluginSyncResult,
  type PluginValidationResult,
  type BacklogSettleStatesRequest,
  type BacklogSettleStatesResult,
  type BacklogSettleWriteRequest,
  type BacklogSettleWriteResult,
  type BacklogReadDescriptionRequest,
  type BacklogReadDescriptionResult,
  type BacklogWriteDescriptionRequest,
  type BacklogWriteDescriptionResult,
  type BacklogSyncWorkItem,
  type PluginValidationContext,
  type SwitchableCapability,
  teamCreateResultSchema,
  type TeamCreateResult,
} from "../../../packages/shared/plugins.ts";
import {
  teamCreateRequestSchema,
  teamSyncRequestSchema,
  teamSyncResultSchema,
  type TeamCreateRequest,
  type TeamSyncRequest,
  type TeamSyncResult,
} from "../../../packages/shared/team-sync.ts";
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
import {
  backlogCommentOperations,
  type BacklogCommentOperation,
  type BacklogCommentOperationRequest,
  type BacklogCommentOperationResult,
} from "../../../packages/shared/backlog-comments.ts";
import { z } from "zod";
import {
  discoverInstalledPlugins,
  installPluginArchive,
  reconcilePluginInstallRoot,
  readAgentTaskPromptFile,
  readPlugin,
  uninstallPluginPackage,
  type InstalledPlugin,
  type ResolvedPlugin,
  type UnavailablePlugin,
} from "./plugin-package.ts";

interface PluginHostOptions {
  installedPluginDirectory: string;
  developmentPluginDirectories?: string[];
  bundledPluginArchives?: string[];
  allowDevelopmentPlugins?: boolean;
  requestTimeoutMs?: number;
  /** What runs plugin code. A worker thread per operation by default. */
  runtime?: PluginRuntime;
  /**
   * Runs once the operation is registered and before its worker starts, and
   * throws to refuse it. Deactivation saves its state and then cancels the
   * registered operations, so an operation either sees the new state here or
   * is cancelled.
   */
  operationGate?: (pluginId: string, method: PluginMethod) => Promise<void>;
  /** Where each worker run's `plugin_operation` event goes. Nowhere by default. */
  events?: ApiEvents;
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
  config: pluginFieldValuesSchema,
});

type PluginInvocationConnection = z.infer<
  typeof pluginInvocationConnectionSchema
>;
/**
 * Runs at admission, right before the worker starts, with the manifest of the
 * package the call runs, and throws to refuse the call. The local API keeps
 * that manifest to redact the call's error and result with the secret fields
 * of the package that ran, even when an update landed while it waited.
 */
export type PluginAdmission = (
  manifest: PluginManifest,
) => Promise<void> | void;
export type { PluginMethod };
/** The event each plugin method's worker run emits. A new method needs one. */
export const PLUGIN_OPERATION_EVENTS = {
  validateConnection: "connection.save",
  syncConnection: "backlog.sync",
  listSettleStates: "source_state.list",
  writeSettle: "backlog.write_source",
  readDescription: "description.read",
  writeDescription: "description.write",
  ...CODE_HOST_EVENTS,
  ...CALENDAR_EVENTS,
  ...COMMENT_EVENTS,
  createTeam: "team.create",
  syncTeamProjects: "team.sync",
} as const satisfies Record<PluginMethod, PluginOperationEventName>;

/** The code of an install refused while plugin operations run. */
export const PLUGIN_HOST_BUSY = "busy";

const missingCapabilityMessages: Record<SwitchableCapability, string> = {
  connector: "does not sync backlog items",
  codeHost: "does not provide pull requests",
  calendar: "does not provide calendar events",
  team: "does not sync a team's projects",
};
/** The switchable capability a plugin method serves. Validation serves none. */
export function capabilityOfMethod(
  method: PluginMethod,
): SwitchableCapability | undefined {
  if (
    method === "syncConnection" ||
    method === "listSettleStates" ||
    method === "writeSettle" ||
    method === "readDescription" ||
    method === "writeDescription" ||
    method in backlogCommentOperations
  ) {
    return "connector";
  }
  if (method === "createTeam" || method === "syncTeamProjects") {
    return "team";
  }
  if (method === "validateConnection") return undefined;
  return method in calendarOperations ? "calendar" : "codeHost";
}

/**
 * What a plugin must declare to run a method. It is checked inside the
 * operation, once the plugin is found, so a refusal has its event.
 */
type Requirement = (manifest: PluginManifest) => void;

/** The plugin declares `capability`. */
function requireCapability(capability: SwitchableCapability): Requirement {
  return (manifest) => {
    if (manifest.capabilities[capability] === undefined) {
      throw new PluginOperationRefused(
        `Plugin "${manifest.id}" ${missingCapabilityMessages[capability]}.`,
        "not_supported",
      );
    }
  };
}

/** The plugin declares a feature of its backlog capability. */
function requireFeature(
  has: (manifest: PluginManifest) => unknown,
  missing: string,
): Requirement {
  return (manifest) => {
    requireCapability("connector")(manifest);
    if (!has(manifest)) {
      throw new PluginOperationRefused(
        `Plugin "${manifest.id}" ${missing}.`,
        "not_supported",
      );
    }
  };
}

const requireSettle = requireFeature(
  (manifest) => manifest.capabilities.connector?.settle,
  "does not support settling backlog items",
);

function comparePlugins(left: PluginManifest, right: PluginManifest) {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

export class PluginManager {
  private readonly installedPluginDirectory: string;
  private readonly developmentPluginDirectories: string[];
  private readonly bundledPluginArchives: string[];
  private readonly allowDevelopmentPlugins: boolean;
  private readonly operationGate?: PluginHostOptions["operationGate"];
  private readonly events?: ApiEvents;
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
    this.events = options.events;
    this.workers = new PluginWorkerLifetime({
      name: "Plugin",
      events: options.events,
      eventNames: PLUGIN_OPERATION_EVENTS,
      capabilityOf: capabilityOfMethod,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      runtime: options.runtime ?? new WorkerPluginRuntime(),
    });
  }

  get activeOperationCount() {
    return this.workers.activeOperationCount;
  }

  async listPlugins(): Promise<PluginManifest[]> {
    return (await this.inspectPlugins()).plugins;
  }

  /** Runnable plugins, plus installed packages built for another plugin API. */
  async inspectPlugins(): Promise<{
    plugins: PluginManifest[];
    unavailable: UnavailablePlugin[];
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
    afterInstall?: (installed: InstalledPlugin) => Promise<void>,
  ): Promise<InstalledPlugin> {
    this.assertRunning();
    return await this.runPackageMutation(async () => {
      await this.ensureInitialized();
      if (this.workers.activeOperationCount > 0) {
        // The desktop records the install as `busy` from this code.
        throw Object.assign(
          new Error(
            "Wait for active plugin operations to finish before installing a plugin.",
          ),
          { code: PLUGIN_HOST_BUSY },
        );
      }

      const installed = await installPluginArchive({
        archiveBytes,
        archiveFilename,
        installRoot: this.installedPluginDirectory,
        replaceExisting: true,
      });
      if (installed.backupLeft) {
        this.events?.current()?.count("plugin_backup_failed");
      }
      if (installed.installed) await afterInstall?.(installed);
      return installed;
    });
  }

  async uninstallPlugin(pluginId: string): Promise<PluginManifest> {
    this.assertRunning();
    return await this.runPackageMutation(async () => {
      await this.ensureInitialized();
      await this.cancelPluginOperations(
        pluginId,
        new Error(`Plugin "${pluginId}" was uninstalled.`),
        "uninstalled",
      );

      const removedPlugin = await uninstallPluginPackage({
        installRoot: this.installedPluginDirectory,
        pluginId,
      });
      if (!removedPlugin) {
        throw new Error(
          `Plugin "${pluginId}" is not installed as a managed package.`,
        );
      }

      return removedPlugin.manifest;
    });
  }

  /** Cancels the plugin's running operations, for `reason`. Returns how many. */
  async cancelPluginOperations(
    pluginId: string,
    error: Error,
    reason?: PluginCancelReason,
  ): Promise<number> {
    return await this.workers.cancel(error, reason, pluginId);
  }

  /** Cancels the running operations of one capability, such as a pull request sync. */
  async cancelCapabilityOperations(
    pluginId: string,
    capability: SwitchableCapability,
    error: Error,
  ): Promise<number> {
    return await this.workers.cancel(
      error,
      "capability_off",
      pluginId,
      (method) => capabilityOfMethod(method) === capability,
    );
  }

  /** `context` names the switchable capabilities that are on. */
  async validateConnection(
    pluginId: string,
    config: PluginFieldValues,
    context?: PluginValidationContext,
    admit?: PluginAdmission,
  ): Promise<PluginValidationResult> {
    return await this.invokePlugin(
      pluginId,
      "validateConnection",
      {
        config: pluginFieldValuesSchema.parse(config),
        ...(context
          ? { context: pluginValidationContextSchema.parse(context) }
          : {}),
      },
      pluginValidationResultSchema,
      admit,
    );
  }

  async syncConnection(
    pluginId: string,
    connection: PluginInvocationConnection,
    workItems: BacklogSyncWorkItem[] = [],
    admit?: PluginAdmission,
  ): Promise<BacklogPluginSyncResult> {
    const payload = {
      connection: pluginInvocationConnectionSchema.parse(connection),
      workItems: workItems.map((workItem) =>
        backlogSyncWorkItemSchema.parse(workItem),
      ),
    };

    return await this.invokePlugin(
      pluginId,
      "syncConnection",
      payload,
      backlogPluginSyncResultSchema,
      admit,
      requireCapability("connector"),
    );
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
    admit?: PluginAdmission,
  ): Promise<CodeHostOperationResult<Operation>> {
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
      admit,
      requireCapability("codeHost"),
    );
  }

  /**
   * Runs one comment operation on a synced item. See
   * `backlogCommentOperations` and ADR 0008.
   */
  async runBacklogCommentOperation<Operation extends BacklogCommentOperation>(
    pluginId: string,
    operation: Operation,
    connection: PluginInvocationConnection,
    request: BacklogCommentOperationRequest<Operation>,
    admit?: PluginAdmission,
  ): Promise<BacklogCommentOperationResult<Operation>> {
    const contract = backlogCommentOperations[operation];
    const resultSchema = contract.result as {
      parse: (value: unknown) => BacklogCommentOperationResult<Operation>;
    };
    return await this.invokePlugin(
      pluginId,
      operation,
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: contract.request.parse(request),
      },
      resultSchema,
      admit,
      requireFeature(
        (manifest) => manifest.capabilities.connector?.comments,
        "does not provide comments",
      ),
    );
  }

  /** Runs one calendar operation. See `calendarOperations`. */
  async runCalendarOperation<Operation extends CalendarOperation>(
    pluginId: string,
    operation: Operation,
    connection: PluginInvocationConnection,
    request: CalendarOperationRequest<Operation>,
    admit?: PluginAdmission,
  ): Promise<CalendarOperationResult<Operation>> {
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
      admit,
      requireCapability("calendar"),
    );
  }

  /**
   * Creates a team from the connection form's values, before the connection
   * is saved. The result fills in the values that join it.
   */
  async createTeam(
    pluginId: string,
    config: PluginFieldValues,
    request: TeamCreateRequest,
    admit?: PluginAdmission,
  ): Promise<TeamCreateResult> {
    return await this.invokePlugin(
      pluginId,
      "createTeam",
      {
        config: pluginFieldValuesSchema.parse(config),
        request: teamCreateRequestSchema.parse(request),
      },
      teamCreateResultSchema,
      admit,
      requireCapability("team"),
    );
  }

  /** Runs one round of a team sync. See packages/shared/team-sync.ts. */
  async syncTeamProjects(
    pluginId: string,
    connection: PluginInvocationConnection,
    request: TeamSyncRequest,
    admit?: PluginAdmission,
  ): Promise<TeamSyncResult> {
    return await this.invokePlugin(
      pluginId,
      "syncTeamProjects",
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: teamSyncRequestSchema.parse(request),
      },
      teamSyncResultSchema,
      admit,
      requireCapability("team"),
    );
  }

  async listSettleStates(
    pluginId: string,
    connection: PluginInvocationConnection,
    request: BacklogSettleStatesRequest,
    admit?: PluginAdmission,
  ): Promise<BacklogSettleStatesResult> {
    return await this.invokePlugin(
      pluginId,
      "listSettleStates",
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: backlogSettleStatesRequestSchema.parse(request),
      },
      backlogSettleStatesResultSchema,
      admit,
      requireSettle,
    );
  }

  async writeSettle(
    pluginId: string,
    connection: PluginInvocationConnection,
    request: BacklogSettleWriteRequest,
    admit?: PluginAdmission,
  ): Promise<BacklogSettleWriteResult> {
    return await this.invokePlugin(
      pluginId,
      "writeSettle",
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: backlogSettleWriteRequestSchema.parse(request),
      },
      backlogSettleWriteResultSchema,
      admit,
      requireSettle,
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
    admit?: PluginAdmission,
    requirement?: Requirement,
  ): Promise<T> {
    const connection = params.connection as
      { id?: unknown; config?: PluginFieldValues } | undefined;
    return await this.workers.run(
      pluginId,
      method,
      async (record) => {
        const plugin = await this.getPlugin(pluginId);
        record.plugin({
          version: plugin.manifest.version,
          source: plugin.source,
          apiVersion: plugin.manifest.apiVersion,
        });
        record.secrets(
          connectionSecretValues(plugin.manifest, [
            connection?.config,
            params.config as PluginFieldValues | undefined,
          ]),
        );
        requirement?.(plugin.manifest);
        // Discovery awaited, so shutdown or a package change may have started meanwhile.
        this.assertCanInvoke();
        const entrypoint = plugin.manifest.entrypoint;
        if (!plugin.entrypointPath || !entrypoint) {
          throw new PluginOperationRefused(
            `Plugin "${pluginId}" runs no code.`,
            "runs_no_code",
          );
        }
        await this.operationGate?.(pluginId, method);
        await admit?.(plugin.manifest);
        return {
          invocation: {
            pluginId,
            packageDirectory: plugin.directory,
            entrypoint,
            apiVersion: plugin.manifest.apiVersion,
            method,
            args: pluginMethodArguments(method, params),
          },
          parse: (result: unknown) => schema.parse(result),
        };
      },
      {
        // A method with a requirement waits for discovery first, as a
        // package change ends, and checks again after it. Validation, which
        // has none, is refused at once while a package changes.
        ...(requirement ? {} : { check: () => this.assertCanInvoke() }),
        ...(typeof connection?.id === "string"
          ? { connectionId: connection.id }
          : {}),
      },
    );
  }

  /** The item's description as the source holds it now. */
  async readDescription(
    pluginId: string,
    connection: PluginInvocationConnection,
    request: BacklogReadDescriptionRequest,
    admit?: PluginAdmission,
  ): Promise<BacklogReadDescriptionResult> {
    return await this.invokePlugin(
      pluginId,
      "readDescription",
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: backlogReadDescriptionRequestSchema.parse(request),
      },
      backlogReadDescriptionResultSchema,
      admit,
      requireFeature(
        (manifest) => manifest.capabilities.connector?.description,
        "does not sync descriptions",
      ),
    );
  }

  /** Writes an item's description, unless the source changed since Ajour read it. */
  async writeDescription(
    pluginId: string,
    connection: PluginInvocationConnection,
    request: BacklogWriteDescriptionRequest,
    admit?: PluginAdmission,
  ): Promise<BacklogWriteDescriptionResult> {
    return await this.invokePlugin(
      pluginId,
      "writeDescription",
      {
        connection: pluginInvocationConnectionSchema.parse(connection),
        request: backlogWriteDescriptionRequestSchema.parse(request),
      },
      backlogWriteDescriptionResultSchema,
      admit,
      requireFeature(
        (manifest) => manifest.capabilities.connector?.description?.write,
        "does not write descriptions",
      ),
    );
  }

  private assertCanInvoke() {
    this.assertRunning();
    if (this.mutatingPluginPackage) {
      throw new PluginOperationRefused(
        "Plugin package change is in progress.",
        "package_change",
      );
    }
  }

  private async getPlugin(pluginId: string): Promise<ResolvedPlugin> {
    const { plugins, unavailable } = await this.discoverPlugins();
    const plugin = plugins.get(pluginId);
    if (!plugin) {
      throw new PluginOperationRefused(
        unavailable.get(pluginId)?.reason ??
          `Plugin "${pluginId}" is not installed.`,
        "not_installed",
      );
    }

    return plugin;
  }

  private async discoverPlugins(): Promise<{
    plugins: Map<string, ResolvedPlugin>;
    unavailable: Map<string, UnavailablePlugin>;
  }> {
    await this.ensureInitialized();
    return await this.runPackageRead(async () => {
      const plugins = new Map<string, ResolvedPlugin>();
      const unavailable = new Map<string, UnavailablePlugin>();
      const installed = await discoverInstalledPlugins(
        this.installedPluginDirectory,
      );

      for (const plugin of installed.plugins) {
        plugins.set(plugin.manifest.id, plugin);
      }
      if (installed.invalidCount > 0) {
        this.events?.current()?.count("invalid_plugin", installed.invalidCount);
      }
      for (const plugin of installed.unavailable) {
        unavailable.set(plugin.manifest.id, plugin);
      }

      if (this.allowDevelopmentPlugins) {
        for (const directory of this.developmentPluginDirectories) {
          try {
            const plugin = await readPlugin(directory, "development");
            plugins.set(plugin.manifest.id, plugin);
            unavailable.delete(plugin.manifest.id);
          } catch {
            // Skipped, as an invalid installed package is: the event counts it.
            this.events?.current()?.count("invalid_plugin");
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
    const failedBackups = await reconcilePluginInstallRoot(
      this.installedPluginDirectory,
    );
    if (failedBackups > 0) {
      this.events?.current()?.count("plugin_backup_failed", failedBackups);
    }
    for (const archivePath of this.bundledPluginArchives) {
      try {
        const archiveBytes = await readFile(archivePath);
        await installPluginArchive({
          archiveBytes,
          archiveFilename: path.basename(archivePath),
          installRoot: this.installedPluginDirectory,
          replaceExisting: false,
        });
      } catch {
        this.events?.current()?.count("bundled_plugin_failed");
      }
    }
  }

  private assertRunning() {
    if (this.shuttingDown) {
      throw new PluginOperationRefused(
        "Plugin host is shutting down.",
        "host_stopping",
      );
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
      throw new Error("Another plugin package change is already in progress.");
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

export type PluginConnection = PluginInvocationConnection;
