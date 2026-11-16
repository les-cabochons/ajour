import {
  PluginOperationRefused,
  PluginOperationLifetime,
  type OperationRecord,
  type PluginCancelReason,
} from "./plugin-operation-lifetime.ts";
import {
  projectDataShapeMethodArguments,
  type ProjectDataShapeMethod,
} from "./plugin-methods.ts";
import type { PluginInvocation, PluginRuntime } from "./plugin-runtime.ts";
import { DesktopRequiredPluginRuntime } from "./plugin-runtime.ts";
import type { PluginOperationEventName } from "./operation-events.ts";
import type { ApiEvents } from "./events.ts";
import {
  projectDataShapeExportRequestSchema,
  projectDataShapeExportResponseSchema,
  projectDataShapeImportRequestSchema,
  projectDataShapeImportResponseSchema,
  validateProjectDataShapeDatasets,
  type ProjectDataShapeExportProject,
  type ProjectDataShapeExportResponse,
  type ProjectDataShapeImportProject,
  type ProjectDataShapePluginManifest,
  type ProjectDataShapeSheet,
} from "../../../packages/shared/project-data-shapes.ts";
import {
  NotAProjectDataShapeError,
  readProjectDataShapePlugin,
  type ResolvedProjectDataShapePlugin,
} from "./project-data-shape-plugin.ts";
import { isPluginApi4Manifest } from "../../../packages/shared/plugin-api-4.ts";

/**
 * The plugin host, as this host uses it. Data shape plugins are packages of
 * the plugin host: it holds them, and decides whether one runs.
 */
export interface PluginHostPackages {
  /**
   * The folder of every package the plugin host holds, by plugin id. A
   * renderer and its storage are keyed by plugin id alone, so a data shape
   * may not take the id of a plugin host package from another folder.
   */
  packageDirectories(): Promise<ReadonlyMap<string, string>>;
  /**
   * Throws a `PluginOperationRefused` when the plugin host would not run
   * `method` of this package now: the plugin's switch, unsigned plugins,
   * consent to what it reaches, a suspension, or a package change.
   */
  admitPackageOperation(
    pluginId: string,
    method: ProjectDataShapeMethod,
  ): Promise<void>;
}

interface ProjectDataShapeHostOptions {
  /**
   * Folders the data shape host reads without a plugin host: the bare
   * format-level host. With a `pluginHost`, only the packages it holds run.
   */
  pluginDirectories?: string[];
  requestTimeoutMs?: number;
  /** What runs plugin code. The standalone API has none, and runs no plugin. */
  runtime?: PluginRuntime;
  /**
   * The plugin host whose packages this host lists and runs, on its terms.
   * Without one, every readable package runs, as in this host's own tests.
   */
  pluginHost?: PluginHostPackages;
  /** Where each worker run's `plugin_operation` event goes. Nowhere by default. */
  events?: ApiEvents;
}

type PluginMethod = ProjectDataShapeMethod;

/** The event each schema plugin method's worker run emits. */
export const SCHEMA_OPERATION_EVENTS = {
  exportProjects: "project.export",
  importProjects: "project.import",
} as const satisfies Record<PluginMethod, PluginOperationEventName>;

function comparePlugins(
  left: ProjectDataShapePluginManifest,
  right: ProjectDataShapePluginManifest,
) {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

export class ProjectDataShapePluginManager {
  private readonly pluginDirectories: string[];
  private readonly events?: ApiEvents;
  private readonly pluginHost?: PluginHostPackages;
  private readonly runsPluginApi4: boolean;
  private readonly workers: PluginOperationLifetime<PluginMethod>;

  constructor(options: ProjectDataShapeHostOptions = {}) {
    this.pluginDirectories = options.pluginDirectories ?? [];
    this.events = options.events;
    this.pluginHost = options.pluginHost;
    const runtime: PluginRuntime =
      options.runtime ?? new DesktopRequiredPluginRuntime();
    this.runsPluginApi4 = runtime.runsPluginApi4 === true;
    this.workers = new PluginOperationLifetime({
      name: "Schema plugin",
      events: options.events,
      eventNames: SCHEMA_OPERATION_EVENTS,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      runtime,
    });
  }

  get activeOperationCount() {
    return this.workers.activeOperationCount;
  }

  async listPlugins(): Promise<ProjectDataShapePluginManifest[]> {
    this.workers.assertRunning();
    const offered: ProjectDataShapePluginManifest[] = [];
    for (const plugin of (await this.discoverPlugins()).plugins.values()) {
      // Only what the plugin host would run: the others aren't offered.
      try {
        await this.pluginHost?.admitPackageOperation(
          plugin.manifest.id,
          "exportProjects",
        );
      } catch (error) {
        if (error instanceof PluginOperationRefused) continue;
        throw error;
      }
      offered.push(plugin.manifest);
    }
    return offered.sort(comparePlugins);
  }

  async exportProjects(
    pluginId: string,
    projects: ProjectDataShapeExportProject[],
  ): Promise<ProjectDataShapeExportResponse> {
    return await this.workers.run(
      pluginId,
      "exportProjects",
      async (record) => {
        const plugin = await this.getPlugin(pluginId, "exportProjects", record);
        if (!plugin.manifest.capabilities.projectDataShape.datasets) {
          throw new PluginOperationRefused(
            `Schema plugin "${pluginId}" only imports.`,
            "not_supported",
          );
        }
        const params = projectDataShapeExportRequestSchema.parse({ projects });
        return {
          invocation: this.invocation(plugin, "exportProjects", params),
          parse: (result: unknown) => ({
            datasets: validateProjectDataShapeDatasets(
              plugin.manifest.capabilities.projectDataShape,
              projectDataShapeExportResponseSchema.parse(result).datasets,
            ),
          }),
        };
      },
    );
  }

  /**
   * Maps a file's sheets to projects. The plugin reads the sheets and checks
   * their layout itself: files from other tools hold anything.
   */
  async importProjects(
    pluginId: string,
    sheets: ProjectDataShapeSheet[],
  ): Promise<{ projects: ProjectDataShapeImportProject[] }> {
    return await this.workers.run(
      pluginId,
      "importProjects",
      async (record) => {
        const plugin = await this.getPlugin(pluginId, "importProjects", record);
        let params: { sheets: ProjectDataShapeSheet[] };
        try {
          params = projectDataShapeImportRequestSchema.parse({ sheets });
        } catch (error) {
          // The file is past Ajour's limits: the user's input, not a fault.
          // The message names the limit; the event holds the reason only.
          throw new PluginOperationRefused(
            error instanceof Error ? error.message : String(error),
            "invalid_request",
          );
        }
        return {
          invocation: this.invocation(plugin, "importProjects", params),
          parse: (result: unknown) =>
            projectDataShapeImportResponseSchema.parse(result),
        };
      },
    );
  }

  /** Resolves once no operation runs, or after `ms`. */
  whenIdle(ms: number): Promise<void> {
    return this.workers.whenIdle(ms);
  }

  async shutdown() {
    await this.workers.shutdown();
  }

  /**
   * Cancels the running operations, of one plugin when `pluginId` is given,
   * for `reason`. Returns how many.
   */
  async cancelOperations(
    error: Error,
    reason?: PluginCancelReason,
    pluginId?: string,
  ) {
    return await this.workers.cancel(error, reason, pluginId);
  }

  private invocation(
    plugin: ResolvedProjectDataShapePlugin,
    method: PluginMethod,
    params: Record<string, unknown>,
  ): PluginInvocation {
    return {
      pluginId: plugin.manifest.id,
      packageDirectory: plugin.directory,
      entrypoint: plugin.manifest.entrypoint,
      apiVersion: plugin.manifest.apiVersion,
      method,
      args: projectDataShapeMethodArguments(method, params),
    };
  }

  private async discoverPlugins() {
    const plugins = new Map<string, ResolvedProjectDataShapePlugin>();
    const hostPackages = await this.pluginHost?.packageDirectories();
    // Installed packages are plugins of every kind: only those that declare
    // a data shape are listed, and the others are not invalid. With a plugin
    // host, its packages are the only ones: a folder it doesn't hold has no
    // switch or consent to check, so it isn't read. A renderer and its
    // storage are keyed by plugin id, which the host keeps to one folder.
    const held = new Set(hostPackages?.values() ?? []);
    const directories = this.pluginHost
      ? held
      : new Set(this.pluginDirectories);
    for (const directory of directories) {
      try {
        const plugin: ResolvedProjectDataShapePlugin = {
          ...(await readProjectDataShapePlugin(directory)),
          source: this.isDevelopment(directory) ? "development" : "installed",
        };
        plugins.set(plugin.manifest.id, plugin);
      } catch (error) {
        if (error instanceof NotAProjectDataShapeError && held.has(directory)) {
          continue;
        }
        // Skipped, as an invalid plugin package is: the event counts it.
        this.events?.current()?.count("invalid_plugin");
      }
    }
    return { plugins };
  }

  private isDevelopment(directory: string) {
    return this.pluginDirectories.includes(directory);
  }

  private async getPlugin(
    pluginId: string,
    method: PluginMethod,
    record: OperationRecord,
  ) {
    const { plugins } = await this.discoverPlugins();
    const plugin = plugins.get(pluginId);
    if (!plugin) {
      throw new PluginOperationRefused(
        `Schema plugin "${pluginId}" is not available.`,
        "not_installed",
      );
    }
    record.plugin({
      version: plugin.manifest.version,
      source: plugin.source ?? "development",
      apiVersion: plugin.manifest.apiVersion,
    });
    // Only a runtime that keeps a plugin to the broker runs it.
    if (!isPluginApi4Manifest(plugin.manifest)) {
      throw new PluginOperationRefused(
        "This plugin needs an update",
        "not_supported",
      );
    }
    if (!this.runsPluginApi4) {
      throw new PluginOperationRefused(
        "Plugins need the desktop app",
        "not_supported",
      );
    }
    // The plugin host's own checks, after the package is found and before
    // anything runs, so a refusal has its event.
    await this.pluginHost?.admitPackageOperation(pluginId, method);
    return plugin;
  }
}
