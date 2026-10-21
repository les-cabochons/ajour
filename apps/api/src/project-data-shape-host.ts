import { pathToFileURL } from "node:url";
import {
  PluginOperationRefused,
  PluginWorkerLifetime,
  type OperationRecord,
  type PluginCancelReason,
  type PluginOperationEventName,
} from "./plugin-worker-lifetime.ts";
import type { ApiEvents } from "./events.ts";
import {
  PROJECT_DATA_SHAPE_PLUGIN_API_VERSION,
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
  workerScriptUrl?: URL;
  /** Where each worker run's `plugin_operation` event goes. Nowhere by default. */
  events?: ApiEvents;
}

type PluginMethod = "exportProjects" | "importProjects";

/** The event each schema plugin method's worker run emits. */
const SCHEMA_OPERATION_EVENTS = {
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
      workerScriptUrl:
        options.workerScriptUrl ??
        new URL("./project-data-shape-worker.mjs", import.meta.url),
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
          workerData: this.invocationData(plugin, "exportProjects", params),
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
        const validatedDatasets = validateProjectDataShapeDatasets(
          plugin.manifest.capabilities.projectDataShape,
          projectDataShapeImportRequestSchema.parse({ datasets }).datasets,
          { validateRequiredValues: false, validateValueTypes: false },
        );
        return {
          workerData: this.invocationData(plugin, "importProjects", {
            datasets: validatedDatasets,
          }),
          parse: (result: unknown) =>
            projectDataShapeImportResponseSchema.parse(result),
        };
      },
    );
  }

  async shutdown() {
    await this.workers.shutdown();
  }

  async cancelOperations(error: Error, reason?: PluginCancelReason) {
    await this.workers.cancel(error, reason);
  }

  private invocationData(
    plugin: ResolvedProjectDataShapePlugin,
    method: PluginMethod,
    params: unknown,
  ) {
    return {
      apiVersion: PROJECT_DATA_SHAPE_PLUGIN_API_VERSION,
      entrypointUrl: pathToFileURL(plugin.entrypointPath).toString(),
      method,
      params,
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
