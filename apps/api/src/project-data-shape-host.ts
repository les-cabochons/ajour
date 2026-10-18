import { pathToFileURL } from "node:url";
import { PluginWorkerLifetime } from "./plugin-worker-lifetime.ts";
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
}

type PluginMethod = "exportProjects" | "importProjects";

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
  private readonly workers: PluginWorkerLifetime<PluginMethod>;

  constructor(options: ProjectDataShapeHostOptions = {}) {
    this.pluginDirectories = options.pluginDirectories ?? [];
    this.workers = new PluginWorkerLifetime({
      name: "Schema plugin",
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
    return await this.workers.run(pluginId, "exportProjects", async () => {
      const plugin = await this.getPlugin(pluginId);
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
    });
  }

  async importProjects(
    pluginId: string,
    datasets: ProjectDataShapeDataset[],
  ): Promise<{ projects: ProjectDataShapeImportProject[] }> {
    return await this.workers.run(pluginId, "importProjects", async () => {
      const plugin = await this.getPlugin(pluginId);
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
    });
  }

  async shutdown() {
    await this.workers.shutdown();
  }

  async cancelOperations(error: Error) {
    await this.workers.cancel(error);
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
      } catch (error) {
        console.error(`Skipping invalid schema plugin "${directory}".`, error);
      }
    }
    return plugins;
  }

  private async getPlugin(pluginId: string) {
    const plugin = (await this.discoverPlugins()).get(pluginId);
    if (!plugin) {
      throw new Error(`Schema plugin "${pluginId}" is not available.`);
    }
    return plugin;
  }
}
