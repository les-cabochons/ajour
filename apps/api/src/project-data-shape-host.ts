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
  type ProjectDataShapeSheet,
} from "../../../packages/shared/project-data-shapes.ts";
import {
  readProjectDataShapePlugin,
  type ProjectDataShapeAdmissionPolicy,
  type ResolvedProjectDataShapePlugin,
} from "./project-data-shape-plugin.ts";

interface ProjectDataShapeHostOptions {
  pluginDirectories?: string[];
  requestTimeoutMs?: number;
  /** What runs plugin code. A worker thread per operation by default. */
  runtime?: PluginRuntime;
  /**
   * Whether plugin API 4 data shape packages are admitted. Development builds
   * admit them until the cut-over (#403); a packaged build lists none.
   */
  admitPluginApi4?: boolean;
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
  private readonly admission: ProjectDataShapeAdmissionPolicy;
  private readonly runsPluginApi4: boolean;
  private readonly workers: PluginWorkerLifetime<PluginMethod>;

  constructor(options: ProjectDataShapeHostOptions = {}) {
    this.pluginDirectories = options.pluginDirectories ?? [];
    this.events = options.events;
    this.admission = { admitPluginApi4: options.admitPluginApi4 ?? false };
    const runtime: PluginRuntime = options.runtime ?? new WorkerPluginRuntime();
    this.runsPluginApi4 = runtime.runsPluginApi4 === true;
    this.workers = new PluginWorkerLifetime({
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
        const plugin = await this.getPlugin(pluginId, record);
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
        const plugin = await readProjectDataShapePlugin(
          directory,
          this.admission,
        );
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
    // A worker thread would give an API 4 plugin the network. It runs only
    // in a runtime that keeps it to the broker.
    if (plugin.manifest.apiVersion >= 4 && !this.runsPluginApi4) {
      throw new PluginOperationRefused(
        `Schema plugin "${pluginId}" uses plugin API 4, which this version of Ajour can't run yet.`,
        "not_supported",
      );
    }
    return plugin;
  }
}
