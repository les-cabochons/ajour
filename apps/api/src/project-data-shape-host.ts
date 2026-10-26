import {
  PluginOperationRefused,
  PluginWorkerLifetime,
  type OperationRecord,
  type PluginCancelReason,
} from "./plugin-worker-lifetime.ts";
import {
  projectDataShapeMethodArguments,
  type ProjectDataShapeMethod,
} from "./plugin-methods.ts";
import type { PluginInvocation, PluginRuntime } from "./plugin-runtime.ts";
import { WorkerPluginRuntime } from "./plugin-worker-runtime.ts";
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
  type ProjectDataShapeDataset,
} from "../../../packages/shared/project-data-shapes.ts";
import {
  readProjectDataShapePlugin,
  type ResolvedProjectDataShapePlugin,
} from "./project-data-shape-plugin.ts";

interface ProjectDataShapeHostOptions {
  pluginDirectories?: string[];
  requestTimeoutMs?: number;
  /** What runs plugin code. A worker thread per operation by default. */
  runtime?: PluginRuntime;
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
  private readonly workers: PluginWorkerLifetime<PluginMethod>;

  constructor(options: ProjectDataShapeHostOptions = {}) {
    this.pluginDirectories = options.pluginDirectories ?? [];
    this.events = options.events;
    this.workers = new PluginWorkerLifetime({
      name: "Schema plugin",
      events: options.events,
      eventNames: SCHEMA_OPERATION_EVENTS,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      runtime: options.runtime ?? new WorkerPluginRuntime(),
    });
  }

  get activeOperationCount() {
    return this.workers.activeOperationCount;
  }

  async listPlugins(): Promise<ProjectDataShapePluginManifest[]> {
    this.workers.assertRunning();
    return Array.from((await this.discoverPlugins()).values())
      .map((plugin) => plugin.manifest)
      .sort(comparePlugins);
  }

  async exportProjects(
    pluginId: string,
    projects: ProjectDataShapeExportProject[],
  ): Promise<ProjectDataShapeExportResponse> {
    return await this.workers.run(
      pluginId,
      "exportProjects",
      async (record) => {
        const plugin = await this.getPlugin(pluginId, record);
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

  async importProjects(
    pluginId: string,
    datasets: ProjectDataShapeDataset[],
  ): Promise<{ projects: ProjectDataShapeImportProject[] }> {
    return await this.workers.run(
      pluginId,
      "importProjects",
      async (record) => {
        const plugin = await this.getPlugin(pluginId, record);
        let validatedDatasets: ProjectDataShapeDataset[];
        try {
          validatedDatasets = validateProjectDataShapeDatasets(
            plugin.manifest.capabilities.projectDataShape,
            projectDataShapeImportRequestSchema.parse({ datasets }).datasets,
            { validateRequiredValues: false, validateValueTypes: false },
          );
        } catch (error) {
          // The file's rows break the plugin's definition. The message names
          // their headings, for the user; the event holds the reason only.
          throw new PluginOperationRefused(
            error instanceof Error ? error.message : String(error),
            "invalid_request",
          );
        }
        return {
          invocation: this.invocation(plugin, "importProjects", {
            datasets: validatedDatasets,
          }),
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

  /** Cancels every running operation, for `reason`. Returns how many. */
  async cancelOperations(error: Error, reason?: PluginCancelReason) {
    return await this.workers.cancel(error, reason);
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
    for (const directory of this.pluginDirectories) {
      try {
        const plugin = await readProjectDataShapePlugin(directory);
        plugins.set(plugin.manifest.id, plugin);
      } catch {
        // Skipped, as an invalid plugin package is: the event counts it.
        this.events?.current()?.count("invalid_plugin");
      }
    }
    return plugins;
  }

  private async getPlugin(pluginId: string, record: OperationRecord) {
    const plugin = (await this.discoverPlugins()).get(pluginId);
    if (!plugin) {
      throw new PluginOperationRefused(
        `Schema plugin "${pluginId}" is not available.`,
        "not_installed",
      );
    }
    record.plugin({
      version: plugin.manifest.version,
      source: "development",
      apiVersion: plugin.manifest.apiVersion,
    });
    return plugin;
  }
}
