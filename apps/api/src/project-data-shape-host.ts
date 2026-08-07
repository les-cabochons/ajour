import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
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
} from "../../../packages/shared/src/project-data-shapes.ts";
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

interface WorkerReply {
  ok: boolean;
  result?: unknown;
  error?: unknown;
}

interface ActiveWorker {
  pluginId: string;
  cancel(error: Error): Promise<void>;
}

const MAX_CONCURRENT_PLUGIN_OPERATIONS = 4;
const MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;

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
  private readonly requestTimeoutMs: number;
  private readonly workerScriptUrl: URL;
  private readonly activeWorkers = new Map<Worker, ActiveWorker>();
  private readonly operationDrainWaiters = new Set<() => void>();
  private activeOperationReservations = 0;
  private shuttingDown = false;

  constructor(options: ProjectDataShapeHostOptions = {}) {
    this.pluginDirectories = options.pluginDirectories ?? [];
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.workerScriptUrl =
      options.workerScriptUrl ??
      new URL("./project-data-shape-worker.mjs", import.meta.url);
  }

  get activeOperationCount() {
    return this.activeOperationReservations;
  }

  async listPlugins(): Promise<ProjectDataShapePluginManifest[]> {
    this.assertRunning();
    return Array.from((await this.discoverPlugins()).values())
      .map((plugin) => plugin.manifest)
      .sort(comparePlugins);
  }

  async exportProjects(
    pluginId: string,
    projects: ProjectDataShapeExportProject[],
  ): Promise<ProjectDataShapeExportResponse> {
    return await this.runPluginOperation(pluginId, async (plugin) => {
      const request = projectDataShapeExportRequestSchema.parse({ projects });
      const response = await this.invokePlugin(
        plugin,
        "exportProjects",
        request,
        projectDataShapeExportResponseSchema,
      );
      return {
        datasets: validateProjectDataShapeDatasets(
          plugin.manifest.capabilities.projectDataShape,
          response.datasets,
        ),
      };
    });
  }

  async importProjects(
    pluginId: string,
    datasets: ProjectDataShapeDataset[],
  ): Promise<{ projects: ProjectDataShapeImportProject[] }> {
    return await this.runPluginOperation(pluginId, async (plugin) => {
      const validatedDatasets = validateProjectDataShapeDatasets(
        plugin.manifest.capabilities.projectDataShape,
        projectDataShapeImportRequestSchema.parse({ datasets }).datasets,
        { validateRequiredValues: false, validateValueTypes: false },
      );
      return await this.invokePlugin(
        plugin,
        "importProjects",
        { datasets: validatedDatasets },
        projectDataShapeImportResponseSchema,
      );
    });
  }

  async shutdown() {
    this.shuttingDown = true;
    await Promise.allSettled(
      Array.from(this.activeWorkers.values()).map((worker) =>
        worker.cancel(
          new Error(
            "Project data shape operation stopped because the app is shutting down.",
          ),
        ),
      ),
    );
    await this.waitForOperationsToDrain();
  }

  private async runPluginOperation<T>(
    pluginId: string,
    operation: (plugin: ResolvedProjectDataShapePlugin) => Promise<T>,
  ) {
    const releaseOperation = this.reservePluginOperation();
    try {
      const plugin = await this.getPlugin(pluginId);
      this.assertRunning();
      return await operation(plugin);
    } finally {
      releaseOperation();
    }
  }

  private async invokePlugin<T>(
    plugin: ResolvedProjectDataShapePlugin,
    method: PluginMethod,
    params: Record<string, unknown>,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        let worker: Worker;
        try {
          worker = new Worker(this.workerScriptUrl, {
            env: {},
            execArgv: [],
            stdout: true,
            stderr: true,
            workerData: {
              apiVersion: PROJECT_DATA_SHAPE_PLUGIN_API_VERSION,
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

        worker.once("error", (error) => void finalize(error));
        worker.once("message", (message: WorkerReply) => {
          if (message?.ok === true) {
            void finalize(undefined, message.result);
            return;
          }
          const detail =
            typeof message?.error === "string" && message.error.trim()
              ? message.error
                  .trim()
                  .slice(0, MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS)
              : "Unknown project data shape plugin error.";
          void finalize(new Error(detail));
        });
        worker.once("exit", (code) => {
          if (!settled) {
            void finalize(
              new Error(
                `Project data shape plugin "${plugin.manifest.id}" exited before returning a result (code ${code}).`,
              ),
            );
          }
        });

        this.activeWorkers.set(worker, {
          pluginId: plugin.manifest.id,
          cancel: async (error) => await finalize(error),
        });
        timeout = setTimeout(() => {
          void finalize(
            new Error(
              `Project data shape plugin "${plugin.manifest.id}" timed out while handling ${method}.`,
            ),
          );
        }, this.requestTimeoutMs);
        worker.stdout?.resume();
        worker.stderr?.resume();
      });
  }

  private async discoverPlugins() {
    const plugins = new Map<string, ResolvedProjectDataShapePlugin>();
    for (const directory of this.pluginDirectories) {
      try {
        const plugin = await readProjectDataShapePlugin(directory);
        plugins.set(plugin.manifest.id, plugin);
      } catch (error) {
        console.error(
          `Skipping invalid project data shape plugin "${directory}".`,
          error,
        );
      }
    }
    return plugins;
  }

  private async getPlugin(pluginId: string) {
    const plugin = (await this.discoverPlugins()).get(pluginId);
    if (!plugin) {
      throw new Error(
        `Project data shape plugin "${pluginId}" is not available.`,
      );
    }
    return plugin;
  }

  private assertRunning() {
    if (this.shuttingDown) {
      throw new Error("Project data shape plugin host is shutting down.");
    }
  }

  private reservePluginOperation() {
    this.assertRunning();
    if (this.activeOperationReservations >= MAX_CONCURRENT_PLUGIN_OPERATIONS) {
      throw new Error(
        "Too many project data shape plugin operations are already running.",
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
        for (const resolve of this.operationDrainWaiters) {
          resolve();
        }
        this.operationDrainWaiters.clear();
      }
    };
  }

  private async waitForOperationsToDrain() {
    if (this.activeOperationReservations === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.operationDrainWaiters.add(resolve);
    });
  }
}
