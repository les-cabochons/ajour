import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { createApiEvents } from "./events.ts";
import { PluginManager } from "./plugin-host.ts";
import {
  settledRun,
  SplitPluginRuntime,
  type PluginInvocation,
  type PluginRun,
  type PluginRunOutcome,
  type PluginRuntime,
  type PluginTerminateReason,
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
          "export async function writeDescription() { throw Object.assign(new Error('Refused.'), { status: 401 }); }",
          "export async function readComments() { throw Object.assign(new Error('Odd.'), { status: 1000 }); }",
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
        await run.terminate("settled");
        return outcome;
      };

      await expect(
        settle("readDescription", [{ label: "work" }, { sourceId: "A-1" }]),
      ).resolves.toMatchObject({ ok: true, result: { text: "work:A-1" } });
      await expect(settle("writeSettle")).resolves.toEqual({
        ok: false,
        failure: "plugin_error",
      });
      // A plugin error that names an HTTP status passes it on, which is how
      // the host tells a rejected secret (401) from any other failure.
      await expect(settle("writeDescription")).resolves.toEqual({
        ok: false,
        failure: "plugin_error",
        message: "Refused.",
        httpStatus: 401,
      });
      await expect(settle("readComments")).resolves.toEqual({
        ok: false,
        failure: "plugin_error",
        message: "Odd.",
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
        "export async function importProjects(sheets) {",
        "  return { projects: sheets[0].rows.map((row) => ({ name: row[0], color: '#123456', status: 'active', tasks: [] })) };",
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
        { name: "Projects", rows: [["Mercury"]] },
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

/**
 * A runtime the test drives by hand: each run waits until the test settles
 * it, and the runtime records why each was terminated.
 */
function scriptedRuntime(
  options: { unavailable?: () => string | undefined } = {},
) {
  const runs: {
    invocation: PluginInvocation;
    settle: (outcome: PluginRunOutcome) => void;
    terminated: PluginTerminateReason[];
  }[] = [];
  const runtime: PluginRuntime = {
    runsPluginApi4: true,
    ...(options.unavailable ? { unavailableReason: options.unavailable } : {}),
    start(invocation) {
      let settle!: (outcome: PluginRunOutcome) => void;
      const settled = new Promise<PluginRunOutcome>((resolve) => {
        settle = resolve;
      });
      const run = {
        invocation,
        settle,
        terminated: [] as PluginTerminateReason[],
      };
      runs.push(run);
      return {
        settled,
        terminate: async (reason) => {
          run.terminated.push(reason);
          settle({ ok: false, failure: "terminated" });
        },
      };
    },
  };
  return { runtime, runs };
}

describe("the runtime port's endings", () => {
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

  async function setup(runtime: PluginRuntime, requestTimeoutMs = 5_000) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-runtime-end-"));
    directories.push(root);
    const directory = path.join(root, "github");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "plugin.json"),
      JSON.stringify({
        id: "github",
        version: "1.0.0",
        apiVersion: 3,
        displayName: "GitHub",
        description: "Test plugin.",
        iconSvg: ICON,
        entrypoint: "plugin.mjs",
        capabilities: { connector: {}, codeHost: {} },
        connectionFields: [
          { id: "token", label: "Token", type: "password", secret: true },
        ],
      }),
    );
    await writeFile(path.join(directory, "plugin.mjs"), "export {};");
    const sink = createRecordingSink<AjourEvent>();
    const manager = new PluginManager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [directory],
      allowDevelopmentPlugins: true,
      runtime,
      requestTimeoutMs,
      events: createApiEvents({ sink, userDataPath: root }),
    });
    shutdowns.push(() => manager.shutdown());
    return { manager, sink };
  }

  const started = async (runs: unknown[], count: number) => {
    for (let wait = 0; runs.length < count && wait < 200; wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  it("terminates a run with why it ended: settled, timed out or cancelled", async () => {
    const { runtime, runs } = scriptedRuntime();
    const { manager } = await setup(runtime, 100);

    const settled = manager.syncConnection("github", connection);
    await started(runs, 1);
    runs[0]!.settle({ ok: true, result: { items: [] } });
    await expect(settled).resolves.toMatchObject({ items: [] });

    await expect(manager.syncConnection("github", connection)).rejects.toThrow(
      "timed out",
    );

    const cancelled = manager.syncConnection("github", connection);
    await started(runs, 3);
    await manager.cancelPluginOperations(
      "github",
      new Error("Plugin turned off."),
      "plugin_off",
    );
    await expect(cancelled).rejects.toThrow("Plugin turned off.");

    expect(runs.map((run) => run.terminated)).toEqual([
      ["settled"],
      ["timeout"],
      ["cancelled"],
    ]);
  });

  it("fails a run whose process crashed with the cause, on the event too", async () => {
    const { runtime, runs } = scriptedRuntime();
    const { manager, sink } = await setup(runtime);

    const pending = manager.syncConnection("github", connection);
    await started(runs, 1);
    runs[0]!.settle({ ok: false, failure: "crashed", cause: "oom" });

    await expect(pending).rejects.toMatchObject({
      reason: "crashed",
      message:
        'Plugin "github" stopped before returning a result: its process ran out of memory.',
    });
    expect(sink.events.at(-1)).toMatchObject({
      name: "backlog.sync",
      outcome: "error",
      outcome_reason: "crashed",
      worker: { crash_cause: "oom" },
    });
  });

  it("refuses every run while the sandboxed runtime can't run plugins, never as the plugin's error", async () => {
    const { runtime, runs } = scriptedRuntime({
      unavailable: () => "Ajour was started with --no-sandbox.",
    });
    const split = new SplitPluginRuntime({ api3: runtime, api4: runtime });
    const { manager, sink } = await setup(split);

    await expect(
      manager.syncConnection("github", connection),
    ).rejects.toMatchObject({
      reason: "runtime_unavailable",
      message:
        "Plugins are turned off: this computer can't run them in a sandbox. Ajour was started with --no-sandbox.",
    });
    expect(runs).toEqual([]);
    expect(sink.events.at(-1)).toMatchObject({
      name: "backlog.sync",
      outcome: "refused",
      outcome_reason: "runtime_unavailable",
    });
  });
});

describe("the split runtime", () => {
  const invocation = {
    pluginId: "github",
    packageDirectory: "/plugins/github",
    entrypoint: "plugin.mjs",
    method: "syncConnection",
    args: [],
  };

  it("runs API 3 packages on one runtime and API 4 packages on the sandboxed one", () => {
    const api3 = scriptedRuntime();
    const api4 = scriptedRuntime({ unavailable: () => undefined });
    const split = new SplitPluginRuntime({
      api3: { start: api3.runtime.start },
      api4: api4.runtime,
    });

    split.start({ ...invocation, apiVersion: 3 });
    split.start({ ...invocation, apiVersion: 4 });

    expect(split.runsPluginApi4).toBe(true);
    expect(split.unavailableReason()).toBeUndefined();
    expect(api3.runs.map((run) => run.invocation.apiVersion)).toEqual([3]);
    expect(api4.runs.map((run) => run.invocation.apiVersion)).toEqual([4]);
  });

  it("runs no plugin, API 3 included, while the sandboxed runtime can't", async () => {
    let reason: string | undefined = "Plugins run only on Windows and macOS.";
    const api3 = scriptedRuntime();
    const api4 = scriptedRuntime({ unavailable: () => reason });
    const split = new SplitPluginRuntime({
      api3: api3.runtime,
      api4: api4.runtime,
    });

    for (const apiVersion of [3, 4]) {
      await expect(
        split.start({ ...invocation, apiVersion }).settled,
      ).resolves.toEqual({
        ok: false,
        failure: "runtime_unavailable",
        reason: "Plugins run only on Windows and macOS.",
      });
    }
    expect(api3.runs.length + api4.runs.length).toBe(0);

    reason = undefined;
    split.start({ ...invocation, apiVersion: 3 });
    expect(api3.runs).toHaveLength(1);
  });

  it("hands the runtimes the API they report blocked attempts to", () => {
    const attached: unknown[] = [];
    const host = { recordBlocked: async () => undefined };
    const split = new SplitPluginRuntime({
      api3: { start: () => settledRun({ ok: true, result: null }) },
      api4: {
        start: () => settledRun({ ok: true, result: null }),
        attach: (given) => attached.push(given),
      },
    });

    split.attach(host);

    expect(attached).toEqual([host]);
  });
});
