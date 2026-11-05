import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAppApiServer,
  installPluginForServer,
  stopAppApiServer,
} from "./server.ts";
import { PluginManager } from "./plugin-host.ts";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";
import type { PluginRuntime, PluginRuntimeHost } from "./plugin-runtime.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * Project data shape plugins run on the plugin host's terms (#403): the
 * Projects import and export list and run only the packages the plugin host
 * would run. A shape plugin the user hasn't turned on, an unsigned one while
 * unsigned plugins are off, one held for consent, one that keeps stopping, or
 * one whose folder an update is replacing, is neither offered nor run.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const ID = "workday-project-data";

const SOURCE = [
  "export async function exportProjects(projects) {",
  "  return { datasets: [{ id: 'projects', rows: projects.map((p) => ({ project: p.name })) }] };",
  "}",
  "export async function importProjects(sheets) {",
  "  return { projects: sheets[0].rows.slice(1).map((row) => ({ name: row[0], color: '#123456', status: 'active', tasks: [] })) };",
  "}",
].join("\n");

function manifest(version: string, extra: Record<string, unknown> = {}) {
  return {
    id: ID,
    version,
    apiVersion: 4,
    displayName: "Workday",
    iconSvg: ICON,
    entrypoint: "plugin.mjs",
    connectionFields: [],
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
    ...extra,
  };
}

const EXPORT_BODY = {
  projects: [
    { name: "Mercury", color: "#123456", status: "active", tasks: [] },
  ],
};
const IMPORT_BODY = {
  sheets: [{ name: "Projects", rows: [["project"], ["Mercury"]] }],
};

describe(
  "project data shape plugins run on the plugin host's terms",
  { timeout: 30_000 },
  () => {
    const directories: string[] = [];
    const servers: Server[] = [];

    afterEach(async () => {
      await Promise.all(
        servers
          .splice(0)
          .map((server) => stopAppApiServer(server).catch(() => undefined)),
      );
      await Promise.all(
        directories
          .splice(0)
          .map((directory) => rm(directory, { recursive: true, force: true })),
      );
    });

    async function tempDir() {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "ajour-shape-on-"),
      );
      directories.push(directory);
      return directory;
    }

    /** An archive of the shape package. */
    async function archive(root: string, value: unknown) {
      const directory = path.join(
        root,
        `source-${(value as { version: string }).version}`,
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "plugin.json"),
        JSON.stringify(value),
      );
      await writeFile(path.join(directory, "plugin.mjs"), SOURCE);
      const files = ["plugin.json", "plugin.mjs"];
      if (JSON.stringify(value).includes("prompts/")) {
        await mkdir(path.join(directory, "prompts"), { recursive: true });
        await writeFile(path.join(directory, "prompts", "task.md"), "Do it.");
        files.push("prompts");
      }
      const file = path.join(root, `shape-${Date.now()}.ajour-connector`);
      await create({ cwd: directory, file, gzip: true }, files);
      return { bytes: await readFile(file), name: path.basename(file) };
    }

    /** `hold` keeps every operation running until `release()`. */
    async function setup({ hold = false } = {}) {
      const root = await tempDir();
      const inProcess = new InProcessPluginRuntime();
      const started: string[] = [];
      let host: PluginRuntimeHost | undefined;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let terminated = 0;
      const runtime: PluginRuntime = {
        runsPluginApi4: true,
        unavailableReason: () => undefined,
        attach: (attached) => {
          host = attached;
        },
        start: (invocation) => {
          started.push(`${invocation.pluginId}.${invocation.method}`);
          const run = inProcess.start(invocation);
          if (!hold) return run;
          return {
            settled: held.then(() => run.settled),
            terminate: (reason) => {
              terminated += 1;
              return run.terminate(reason);
            },
          };
        },
      };
      const clock = { now: 1_700_000_000_000 };
      const server = createAppApiServer({
        ...windowServerOptions,
        vault: new MemorySecretVault(),
        pluginRuntime: runtime,
        statePath: path.join(root, "state.json"),
        installedPluginDirectory: path.join(root, "installed"),
        developmentPluginDirectories: [],
        projectDataShapePluginDirectories: [],
        allowDevelopmentPlugins: false,
        brokerActivityWindowMs: 0,
        pluginClock: () => clock.now,
      });
      servers.push(server);
      const request = (method: string, url: string, body?: unknown) =>
        dispatchJsonRequest(server, {
          method,
          path: url,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      return {
        root,
        server,
        started,
        request,
        release: () => release(),
        terminated: () => terminated,
        stop: (cause: "crashed" | "killed" | "memory") =>
          host!.recordStopped!(ID, cause, clock.now),
        install: async (value: unknown, enableAfterInstall = true) => {
          const { bytes, name } = await archive(root, value);
          await installPluginForServer(server, bytes, name, {
            enableAfterInstall,
          });
        },
        activate: async (enabled: boolean) => {
          const response = await request(
            "POST",
            `/api/plugins/${ID}/activation`,
            {
              enabled,
            },
          );
          expect(response.status).toBe(200);
        },
        listed: async () =>
          (
            (await request("GET", "/api/project-data-shapes")).body as {
              plugins: { id: string }[];
            }
          ).plugins.map((plugin) => plugin.id),
      };
    }

    /** Both operations answer a refusal and start nothing. */
    async function expectRefused(
      fixture: Awaited<ReturnType<typeof setup>>,
      message: string | RegExp,
    ) {
      const before = fixture.started.length;
      expect(await fixture.listed()).toEqual([]);
      for (const [operation, body] of [
        ["export", EXPORT_BODY],
        ["import", IMPORT_BODY],
      ] as const) {
        const response = await fixture.request(
          "POST",
          `/api/project-data-shapes/${ID}/${operation}`,
          body,
        );
        expect(response.status).toBe(400);
        expect((response.body as { error: string }).error).toMatch(message);
      }
      expect(fixture.started).toHaveLength(before);
    }

    async function expectRuns(fixture: Awaited<ReturnType<typeof setup>>) {
      expect(await fixture.listed()).toEqual([ID]);
      const exported = await fixture.request(
        "POST",
        `/api/project-data-shapes/${ID}/export`,
        EXPORT_BODY,
      );
      expect(exported.status).toBe(200);
      const imported = await fixture.request(
        "POST",
        `/api/project-data-shapes/${ID}/import`,
        IMPORT_BODY,
      );
      expect(imported.status).toBe(200);
    }

    it("neither lists nor runs a downloaded shape plugin that is still off (#394)", async () => {
      const fixture = await setup();
      await fixture.install(manifest("1.0.0"), false);

      await expectRefused(fixture, /Activate this plugin/);
      expect(fixture.started).toEqual([]);

      await fixture.activate(true);
      await expectRuns(fixture);
    });

    it("stops offering and running a shape plugin the user turns off", async () => {
      const fixture = await setup();
      await fixture.install(manifest("1.0.0"));
      await expectRuns(fixture);

      await fixture.activate(false);

      await expectRefused(fixture, /Activate this plugin/);
    });

    it("neither lists nor runs a file package while unsigned plugins are off", async () => {
      const fixture = await setup();
      await fixture.install(manifest("1.0.0"));
      await expectRuns(fixture);

      await fixture.request("POST", "/api/plugins/unsigned-activation", {
        enabled: false,
      });

      await expectRefused(fixture, /Unsigned plugins are deactivated/);

      await fixture.request("POST", "/api/plugins/unsigned-activation", {
        enabled: true,
      });
      await expectRuns(fixture);
    });

    it("neither lists nor runs an update that reaches more, until the user allows it (#395)", async () => {
      const fixture = await setup();
      await fixture.install(manifest("1.0.0"));
      await expectRuns(fixture);

      // A shape plugin may reach no network, but it may ship an agent task.
      const withTask = manifest("1.1.0");
      withTask.capabilities = {
        ...withTask.capabilities,
        agentTask: {
          tasks: [
            {
              id: "task",
              label: "Do it",
              placement: "commit-week",
              prompt: "prompts/task.md",
              estimateMinutes: 5,
              tools: ["get_week_status"],
            },
          ],
        },
      } as typeof withTask.capabilities;
      await fixture.install(withTask);

      await expectRefused(fixture, /Allow the new access first/);

      await fixture.activate(true);
      await expectRuns(fixture);
    });

    it("neither lists nor runs a shape plugin that keeps stopping, until it is turned back on", async () => {
      const fixture = await setup();
      await fixture.install(manifest("1.0.0"));
      await expectRuns(fixture);

      fixture.stop("crashed");
      fixture.stop("killed");
      fixture.stop("memory");

      await expectRefused(fixture, /keeps stopping/);
    });

    it.each([
      [
        "turning the plugin off",
        (fixture: Awaited<ReturnType<typeof setup>>) =>
          fixture.request("POST", `/api/plugins/${ID}/activation`, {
            enabled: false,
          }),
        /Plugin "workday-project-data" was deactivated/,
      ],
      [
        "turning unsigned plugins off",
        (fixture: Awaited<ReturnType<typeof setup>>) =>
          fixture.request("POST", "/api/plugins/unsigned-activation", {
            enabled: false,
          }),
        /Unsigned plugins were deactivated/,
      ],
    ])("cancels a running import on %s", async (_name, turnOff, message) => {
      const fixture = await setup({ hold: true });
      await fixture.install(manifest("1.0.0"));

      const importing = fixture.request(
        "POST",
        `/api/project-data-shapes/${ID}/import`,
        IMPORT_BODY,
      );
      while (fixture.started.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect((await turnOff(fixture)).status).toBe(200);

      const response = await importing;
      expect(response.status).toBe(400);
      expect((response.body as { error: string }).error).toMatch(message);
      expect(fixture.terminated()).toBe(1);
      fixture.release();
    });

    it("runs no import while an update replaces the plugin's folder, and an update waits for a running one", async () => {
      const root = await tempDir();
      const installed = path.join(root, "installed");
      const inProcess = new InProcessPluginRuntime();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let running = 0;
      const runtime: PluginRuntime = {
        runsPluginApi4: true,
        start: (invocation) => {
          running += 1;
          const run = inProcess.start(invocation);
          return {
            settled: held.then(() => run.settled),
            terminate: run.terminate,
          };
        },
      };
      let shapes: ProjectDataShapePluginManager;
      const plugins = new PluginManager({
        installedPluginDirectory: installed,
        runtime,
        operationGate: async () => undefined,
        outsideOperations: () => shapes.activeOperationCount,
      });
      shapes = new ProjectDataShapePluginManager({
        runtime,
        pluginHost: plugins,
      });
      try {
        const first = await archive(root, manifest("1.0.0"));
        await plugins.installPluginArchive(first.bytes, first.name);

        // An import still running keeps an update out.
        const importing = shapes.importProjects(ID, IMPORT_BODY.sheets);
        while (running === 0) await new Promise((r) => setTimeout(r, 5));
        const second = await archive(root, manifest("1.0.1"));
        await expect(
          plugins.installPluginArchive(second.bytes, second.name),
        ).rejects.toThrow(/active plugin operations/);
        release();
        await importing;
        while (shapes.activeOperationCount > 0) {
          await new Promise((r) => setTimeout(r, 5));
        }

        // While the update replaces the folder, nothing starts: the import
        // waits for the change to end, then runs the package that landed.
        const before = running;
        let finish!: () => void;
        const replacing = new Promise<void>((resolve) => {
          finish = resolve;
        });
        let replacingStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          replacingStarted = resolve;
        });
        const update = plugins.installPluginArchive(
          second.bytes,
          second.name,
          () => {
            replacingStarted();
            return replacing;
          },
        );
        await started;
        const waiting = shapes.importProjects(ID, IMPORT_BODY.sheets);
        await new Promise((r) => setTimeout(r, 100));
        expect(running).toBe(before);
        finish();
        await update;
        await expect(waiting).resolves.toMatchObject({ projects: [{}] });
        expect(running).toBe(before + 1);
      } finally {
        release();
        await shapes.shutdown();
        await plugins.shutdown();
      }
    });
  },
);
