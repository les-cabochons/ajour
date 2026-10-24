import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createApiEvents } from "./events.ts";
import { PluginManager } from "./plugin-host.ts";
import type {
  PluginInvocation,
  PluginRun,
  PluginRuntime,
} from "./plugin-runtime.ts";
import { WorkerPluginRuntime } from "./plugin-worker-runtime.ts";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

/** The in-process runtime, recording what each host asked it to run. */
function recordingRuntime() {
  const runtime = new InProcessPluginRuntime();
  const invocations: PluginInvocation[] = [];
  const recording: PluginRuntime = {
    start(invocation): PluginRun {
      invocations.push(invocation);
      return runtime.start(invocation);
    },
  };
  return { runtime: recording, invocations };
}

const connection = {
  id: "connection-1",
  pluginId: "github",
  label: "work",
  tenantLabel: "GitHub",
  autoSync: false,
  autoSyncIntervalMinutes: 10,
  connectedAt: 1,
  config: { token: "token-value" },
};

describe("plugin runtime port", () => {
  const directories: string[] = [];
  const shutdowns: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.allSettled(shutdowns.splice(0).map((stop) => stop()));
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function createPlugin(source: string, manifest = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-plugin-runtime-"));
    directories.push(root);
    const directory = path.join(root, "github");
    await mkdir(path.join(directory, "lib"), { recursive: true });
    await writeFile(
      path.join(directory, "plugin.json"),
      JSON.stringify({
        id: "github",
        version: "1.2.0",
        apiVersion: 3,
        displayName: "GitHub",
        description: "Test plugin.",
        iconSvg: ICON,
        entrypoint: "lib/plugin.mjs",
        capabilities: { connector: {}, codeHost: {} },
        connectionFields: [
          { id: "token", label: "Token", type: "password", secret: true },
        ],
        ...manifest,
      }),
    );
    await writeFile(path.join(directory, "lib", "plugin.mjs"), source);
    return { root, directory };
  }

  function pluginManager(
    root: string,
    directory: string,
    runtime: PluginRuntime,
    options: { events?: ReturnType<typeof createApiEvents> } = {},
  ) {
    const manager = new PluginManager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [directory],
      allowDevelopmentPlugins: true,
      runtime,
      ...options,
    });
    shutdowns.push(() => manager.shutdown());
    return manager;
  }

  it("runs a plugin's operations in process, with the plugin id and its package", async () => {
    const { root, directory } = await createPlugin(
      [
        "export async function validateConnection(config, context) {",
        "  return { normalizedConfig: config, connectionSummary: { capabilities: context.capabilities.join(',') } };",
        "}",
        "export async function syncPullRequests(connection, request) {",
        "  return { viewer: { login: connection.label, isBot: false }, pullRequests: request.tracked };",
        "}",
      ].join("\n"),
    );
    const { runtime, invocations } = recordingRuntime();
    const manager = pluginManager(root, directory, runtime);

    await expect(
      manager.validateConnection(
        "github",
        { token: "token-value" },
        { capabilities: ["codeHost"] },
      ),
    ).resolves.toEqual({
      normalizedConfig: { token: "token-value" },
      connectionSummary: { capabilities: "codeHost" },
    });
    await expect(
      manager.runCodeHostOperation("github", "syncPullRequests", connection, {
        tracked: [],
      }),
    ).resolves.toMatchObject({ pullRequests: [] });

    expect(invocations).toEqual([
      {
        pluginId: "github",
        packageDirectory: directory,
        entrypoint: "lib/plugin.mjs",
        apiVersion: 3,
        method: "validateConnection",
        args: [{ token: "token-value" }, { capabilities: ["codeHost"] }],
      },
      expect.objectContaining({
        method: "syncPullRequests",
        args: [connection, { tracked: [] }],
      }),
    ]);
    expect(manager.activeOperationCount).toBe(0);
  });

  it("keeps the host's failure messages and its result validation around the runtime", async () => {
    const { root, directory } = await createPlugin(
      [
        "export async function validateConnection() {",
        "  throw new Error('Bad token: ' + 'x'.repeat(5000));",
        "}",
        "export async function syncConnection() {",
        "  return { items: 'not a list' };",
        "}",
      ].join("\n"),
    );
    const manager = pluginManager(
      root,
      directory,
      new InProcessPluginRuntime(),
    );

    await expect(
      manager.validateConnection("github", { token: "token-value" }),
    ).rejects.toMatchObject({
      message: `Bad token: ${"x".repeat(4_084)}…`,
      reason: "plugin_error",
    });
    await expect(manager.syncConnection("github", connection)).rejects.toThrow(
      "invalid",
    );
    await expect(
      manager.runCodeHostOperation("github", "syncPullRequests", connection, {
        tracked: [],
      }),
    ).rejects.toThrow("Plugin does not export syncPullRequests().");
  });

  it("times out and cancels an in-process run, and its event says so", async () => {
    const { root, directory } = await createPlugin(
      [
        "export function syncConnection() { return new Promise(() => {}); }",
        "export function syncPullRequests() { return new Promise(() => {}); }",
      ].join("\n"),
    );
    const sink = createRecordingSink<AjourEvent>();
    const events = createApiEvents({ sink, userDataPath: root });
    const manager = new PluginManager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [directory],
      allowDevelopmentPlugins: true,
      runtime: new InProcessPluginRuntime(),
      requestTimeoutMs: 50,
      events,
    });
    shutdowns.push(() => manager.shutdown());

    await expect(manager.syncConnection("github", connection)).rejects.toThrow(
      'Plugin "github" timed out while handling syncConnection.',
    );
    const pending = manager.runCodeHostOperation(
      "github",
      "syncPullRequests",
      connection,
      { tracked: [] },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.activeOperationCount).toBe(1);
    await manager.cancelPluginOperations(
      "github",
      new Error("Plugin turned off."),
      "plugin_off",
    );
    await expect(pending).rejects.toThrow("Plugin turned off.");
    expect(manager.activeOperationCount).toBe(0);

    expect(
      sink.events.map((event) => [
        event.name,
        event.outcome,
        event.outcome_reason,
      ]),
    ).toEqual([
      ["backlog.sync", "timeout", "timeout"],
      ["pull_request.sync", "cancelled", "plugin_off"],
    ]);
  });

  it.each([
    ["the worker runtime", () => new WorkerPluginRuntime()],
    ["the in-process runtime", () => new InProcessPluginRuntime()],
  ])(
    "%s calls the export with its arguments and reports how it settled",
    async (_, createRuntime) => {
      const { directory } = await createPlugin(
        [
          "export async function readDescription(connection, request) {",
          "  return { text: connection.label + ':' + request.sourceId };",
          "}",
          "export async function writeSettle() { throw 'not an Error'; }",
          "export async function listSettleStates() { return 'x'.repeat(9 * 1024 * 1024); }",
        ].join("\n"),
      );
      const runtime = createRuntime();
      const invocation = {
        pluginId: "github",
        packageDirectory: directory,
        entrypoint: "lib/plugin.mjs",
        apiVersion: 3,
      };
      const settle = async (method: string, args: unknown[] = []) => {
        const run = runtime.start({ ...invocation, method, args });
        const outcome = await run.settled;
        await run.terminate();
        return outcome;
      };

      await expect(
        settle("readDescription", [{ label: "work" }, { sourceId: "A-1" }]),
      ).resolves.toMatchObject({ ok: true, result: { text: "work:A-1" } });
      await expect(settle("writeSettle")).resolves.toEqual({
        ok: false,
        failure: "plugin_error",
      });
      await expect(settle("syncConnection")).resolves.toEqual({
        ok: false,
        failure: "missing_export",
      });
      await expect(settle("listSettleStates")).resolves.toMatchObject({
        ok: false,
        failure: "result_too_large",
      });
    },
  );

  it("runs a data shape's export and import in process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-shape-runtime-"));
    directories.push(root);
    const directory = path.join(root, "workday-project-data");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "plugin.json"),
      JSON.stringify({
        id: "workday-project-data",
        version: "1.0.0",
        apiVersion: 1,
        displayName: "Workday",
        iconSvg: ICON,
        entrypoint: "plugin.mjs",
        capabilities: {
          projectDataShape: {
            apiVersion: 1,
            datasets: [
              {
                id: "projects",
                displayName: "Projects",
                columns: [
                  {
                    key: "project",
                    header: "project",
                    type: "string",
                    required: true,
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    await writeFile(
      path.join(directory, "plugin.mjs"),
      [
        "export async function exportProjects(projects) {",
        "  return { datasets: [{ id: 'projects', rows: projects.map((project) => ({ project: project.name })) }] };",
        "}",
        "export async function importProjects(datasets) {",
        "  return { projects: datasets[0].rows.map((row) => ({ name: row.project, color: '#123456', status: 'active', tasks: [] })) };",
        "}",
      ].join("\n"),
    );
    const { runtime, invocations } = recordingRuntime();
    const manager = new ProjectDataShapePluginManager({
      pluginDirectories: [directory],
      runtime,
    });
    shutdowns.push(() => manager.shutdown());
    const mercury = {
      name: "Mercury",
      color: "#123456",
      status: "active" as const,
      tasks: [],
    };

    await expect(
      manager.exportProjects("workday-project-data", [mercury]),
    ).resolves.toEqual({
      datasets: [{ id: "projects", rows: [{ project: "Mercury" }] }],
    });
    await expect(
      manager.importProjects("workday-project-data", [
        { id: "projects", rows: [{ project: "Mercury" }] },
      ]),
    ).resolves.toEqual({ projects: [mercury] });
    expect(
      invocations.map(({ pluginId, packageDirectory, method }) => ({
        pluginId,
        packageDirectory,
        method,
      })),
    ).toEqual([
      {
        pluginId: "workday-project-data",
        packageDirectory: directory,
        method: "exportProjects",
      },
      {
        pluginId: "workday-project-data",
        packageDirectory: directory,
        method: "importProjects",
      },
    ]);
  });
});
