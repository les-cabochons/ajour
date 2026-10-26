import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";
import type {
  PluginInvocation,
  PluginRun,
  PluginRuntime,
} from "./plugin-runtime.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

const PROJECTS_DATASETS = [
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
      {
        key: "hours",
        header: "hours",
        type: "number",
        required: false,
      },
    ],
  },
];

/** A schema plugin. With `datasets` null, it declares no export layout and only imports. */
async function createPlugin(
  parent: string,
  source: string,
  datasets: unknown[] | null = PROJECTS_DATASETS,
  /** Manifest fields that replace or add to the fixture's own. */
  manifest: Record<string, unknown> = {},
) {
  const pluginDirectory = path.join(parent, "workday-project-data");
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(
    path.join(pluginDirectory, "plugin.json"),
    JSON.stringify({
      id: "workday-project-data",
      version: "1.0.0",
      apiVersion: 1,
      displayName: "Workday",
      description: "Test project data shape.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      ...manifest,
      capabilities: {
        projectDataShape: { apiVersion: 1, ...(datasets ? { datasets } : {}) },
      },
    }),
    "utf8",
  );
  await writeFile(path.join(pluginDirectory, "plugin.mjs"), source, "utf8");
  return pluginDirectory;
}

/** A data shape plugin that exports one row per project and imports one project per row of a sheet. */
const SHAPE_SOURCE = [
  "export async function exportProjects(projects) {",
  "  return { datasets: [{ id: 'projects', rows: projects.map((project) => ({ project: project.name, hours: 2 })) }] };",
  "}",
  "export async function importProjects(sheets) {",
  "  return { projects: sheets[0].rows.slice(1).map((row) => ({ name: row[0], color: '#123456', status: 'active', tasks: [] })) };",
  "}",
].join("\n");

const EXPORTED_PROJECTS = [
  { name: "Mercury", color: "#123456", status: "active" as const, tasks: [] },
  { name: "Venus", color: "#654321", status: "archived" as const, tasks: [] },
];
const IMPORTED_SHEETS = [
  {
    name: "Projects",
    rows: [
      ["project", "hours"],
      ["Mercury", "2,5"],
      ["Venus", 4],
    ],
  },
];

/** Wraps a runtime and keeps the invocations it was asked to start. */
function recordingRuntime(runtime: PluginRuntime) {
  const invocations: PluginInvocation[] = [];
  const recording: PluginRuntime = {
    runsPluginApi4: runtime.runsPluginApi4,
    start: (invocation): PluginRun => {
      invocations.push(invocation);
      return runtime.start(invocation);
    },
  };
  return { runtime: recording, invocations };
}

describe("ProjectDataShapePluginManager", () => {
  const tempDirectories: string[] = [];
  const managers: ProjectDataShapePluginManager[] = [];

  async function tempDir() {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-project-shape-"),
    );
    tempDirectories.push(directory);
    return directory;
  }

  afterEach(async () => {
    await Promise.allSettled(
      managers.splice(0).map((manager) => manager.shutdown()),
    );
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("discovers a shape and executes import and export in workers", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPlugin(
      root,
      [
        "export async function exportProjects(projects) {",
        "  return { datasets: [{ id: 'projects', rows: projects.map((project) => ({ project: project.name, hours: 2 })) }] };",
        "}",
        "export async function importProjects(sheets) {",
        "  return { projects: sheets[0].rows.slice(1).map((row) => ({ name: row[0], color: '#123456', status: 'active', tasks: [] })) };",
        "}",
      ].join("\n"),
    );
    const manager = new ProjectDataShapePluginManager({
      pluginDirectories: [pluginDirectory],
    });
    managers.push(manager);

    await expect(manager.listPlugins()).resolves.toEqual([
      expect.objectContaining({
        id: "workday-project-data",
        displayName: "Workday",
      }),
    ]);
    await expect(
      manager.exportProjects("workday-project-data", [
        {
          name: "Mercury",
          color: "#123456",
          status: "active",
          tasks: [],
        },
      ]),
    ).resolves.toEqual({
      datasets: [
        {
          id: "projects",
          rows: [{ project: "Mercury", hours: 2 }],
        },
      ],
    });
    await expect(
      manager.importProjects("workday-project-data", [
        {
          name: "Projects",
          rows: [
            ["project", "hours"],
            ["Mercury", "2,5"],
          ],
        },
      ]),
    ).resolves.toEqual({
      projects: [
        {
          name: "Mercury",
          color: "#123456",
          status: "active",
          tasks: [],
        },
      ],
    });
  });

  it("rejects plugin output that does not match the declared shape", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPlugin(
      root,
      [
        "export async function exportProjects() {",
        "  return { datasets: [{ id: 'projects', rows: [{ project: 'Mercury', unexpected: true }] }] };",
        "}",
      ].join("\n"),
    );
    const manager = new ProjectDataShapePluginManager({
      pluginDirectories: [pluginDirectory],
    });
    managers.push(manager);

    await expect(
      manager.exportProjects("workday-project-data", []),
    ).rejects.toThrow('contains unknown field "unexpected"');
    expect(manager.activeOperationCount).toBe(0);
  });

  it("imports with a schema that has no export layout, and refuses its export", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPlugin(
      root,
      [
        "export async function importProjects(sheets) {",
        "  return { projects: [{ status: 'active', tasks: sheets.map((sheet) => ({ name: sheet.name })) }] };",
        "}",
      ].join("\n"),
      null,
    );
    const manager = new ProjectDataShapePluginManager({
      pluginDirectories: [pluginDirectory],
    });
    managers.push(manager);

    await expect(
      manager.importProjects("workday-project-data", [
        { name: "Plan", rows: [] },
      ]),
    ).resolves.toEqual({
      projects: [{ status: "active", tasks: [{ name: "Plan" }] }],
    });
    await expect(
      manager.exportProjects("workday-project-data", []),
    ).rejects.toThrow('Schema plugin "workday-project-data" only imports.');
    expect(manager.activeOperationCount).toBe(0);
  });

  describe("plugin API 4 packages", () => {
    const API_4_MANIFEST = { apiVersion: 4, runtime: { start: "whenNeeded" } };

    async function manager(
      options: {
        manifest?: Record<string, unknown>;
        admitPluginApi4?: boolean;
        runtime?: PluginRuntime;
        requestTimeoutMs?: number;
      } = {},
    ) {
      const root = await tempDir();
      const pluginDirectory = await createPlugin(
        root,
        SHAPE_SOURCE,
        undefined,
        {
          ...API_4_MANIFEST,
          ...options.manifest,
        },
      );
      const created = new ProjectDataShapePluginManager({
        pluginDirectories: [pluginDirectory],
        admitPluginApi4: options.admitPluginApi4 ?? true,
        runtime: options.runtime ?? new InProcessPluginRuntime(),
        ...(options.requestTimeoutMs
          ? { requestTimeoutMs: options.requestTimeoutMs }
          : {}),
      });
      managers.push(created);
      return created;
    }

    /** A runtime whose runs never settle until they are terminated. */
    function hangingRuntime() {
      const terminated: string[] = [];
      const runtime: PluginRuntime = {
        runsPluginApi4: true,
        start: (): PluginRun => ({
          settled: new Promise<never>(() => {}),
          terminate: async (reason) => {
            terminated.push(reason);
          },
        }),
      };
      return { runtime, terminated };
    }

    // The data shape host shares the lifecycle's runtime but not its crash
    // budget: its runs are one-shot and asked for by the user, so the
    // limits that apply are the worker lifetime's own.
    it("times a run out and terminates it, as a plugin host call does", async () => {
      const { runtime, terminated } = hangingRuntime();
      const api4 = await manager({ runtime, requestTimeoutMs: 20 });

      await expect(
        api4.exportProjects("workday-project-data", EXPORTED_PROJECTS),
      ).rejects.toThrow("timed out while handling exportProjects");
      expect(terminated).toEqual(["timeout"]);
      expect(api4.activeOperationCount).toBe(0);
    });

    it("refuses a fifth run of one plugin at once", async () => {
      const { runtime } = hangingRuntime();
      const api4 = await manager({ runtime, requestTimeoutMs: 60_000 });

      const running = Array.from({ length: 4 }, () =>
        api4.exportProjects("workday-project-data", EXPORTED_PROJECTS),
      );
      running.forEach((run) => run.catch(() => {}));
      await expect(
        api4.exportProjects("workday-project-data", EXPORTED_PROJECTS),
      ).rejects.toThrow("Too many operations");
      await api4.cancelOperations(new Error("done"));
      await Promise.allSettled(running);
    });

    it("exports and imports the same datasets as an API 1 package", async () => {
      const api1Root = await tempDir();
      const api1 = new ProjectDataShapePluginManager({
        pluginDirectories: [await createPlugin(api1Root, SHAPE_SOURCE)],
        runtime: new InProcessPluginRuntime(),
      });
      managers.push(api1);
      const api4 = await manager();

      const exported = await api1.exportProjects(
        "workday-project-data",
        EXPORTED_PROJECTS,
      );
      expect(exported.datasets[0]?.rows).toHaveLength(2);
      await expect(
        api4.exportProjects("workday-project-data", EXPORTED_PROJECTS),
      ).resolves.toEqual(exported);
      await expect(
        api4.importProjects("workday-project-data", IMPORTED_SHEETS),
      ).resolves.toEqual(
        await api1.importProjects("workday-project-data", IMPORTED_SHEETS),
      );
    });

    it("lists the package as API 4 and starts it as API 4 with no broker", async () => {
      const { runtime, invocations } = recordingRuntime(
        new InProcessPluginRuntime(),
      );
      const api4 = await manager({ runtime });

      await expect(api4.listPlugins()).resolves.toEqual([
        expect.objectContaining({
          id: "workday-project-data",
          apiVersion: 4,
          displayName: "Workday",
          entrypoint: "plugin.mjs",
        }),
      ]);
      await api4.exportProjects("workday-project-data", EXPORTED_PROJECTS);
      expect(invocations).toEqual([
        expect.objectContaining({
          pluginId: "workday-project-data",
          apiVersion: 4,
          method: "exportProjects",
          entrypoint: "plugin.mjs",
        }),
      ]);
      expect(invocations[0]).not.toHaveProperty("broker");
    });

    it("hands an API 1 package to the runtime as API 1", async () => {
      const { runtime, invocations } = recordingRuntime(
        new InProcessPluginRuntime(),
      );
      const root = await tempDir();
      const api1 = new ProjectDataShapePluginManager({
        pluginDirectories: [await createPlugin(root, SHAPE_SOURCE)],
        admitPluginApi4: true,
        runtime,
      });
      managers.push(api1);

      await api1.exportProjects("workday-project-data", EXPORTED_PROJECTS);
      expect(invocations.map((invocation) => invocation.apiVersion)).toEqual([
        1,
      ]);
    });

    it("keeps checking the dataset contract on its output", async () => {
      const root = await tempDir();
      const pluginDirectory = await createPlugin(
        root,
        "export async function exportProjects() { return { datasets: [{ id: 'projects', rows: [{ project: 'Mercury', unexpected: true }] }] }; }",
        undefined,
        API_4_MANIFEST,
      );
      const api4 = new ProjectDataShapePluginManager({
        pluginDirectories: [pluginDirectory],
        admitPluginApi4: true,
        runtime: new InProcessPluginRuntime(),
      });
      managers.push(api4);

      await expect(
        api4.exportProjects("workday-project-data", []),
      ).rejects.toThrow('contains unknown field "unexpected"');
    });

    it("is not admitted when the build does not admit plugin API 4", async () => {
      const api4 = await manager({ admitPluginApi4: false });

      await expect(api4.listPlugins()).resolves.toEqual([]);
      await expect(
        api4.exportProjects("workday-project-data", EXPORTED_PROJECTS),
      ).rejects.toThrow(
        'Schema plugin "workday-project-data" is not available',
      );
    });

    it("is refused on a runtime that can't keep a plugin from the network", async () => {
      const api4 = await manager({
        runtime: {
          start: () => {
            throw new Error("must not start");
          },
        },
      });

      await expect(
        api4.exportProjects("workday-project-data", EXPORTED_PROJECTS),
      ).rejects.toThrow(
        'Schema plugin "workday-project-data" uses plugin API 4, which this version of Ajour can\'t run yet.',
      );
      expect(api4.activeOperationCount).toBe(0);
    });

    it.each([
      [
        "network",
        {
          connectionFields: [
            { id: "baseUrl", label: "Address", type: "url", required: true },
          ],
          network: {
            baseAddress: { field: "baseUrl" },
            endpoints: [{ method: "GET", path: "/api/me" }],
          },
        },
      ],
      [
        "connection fields",
        {
          connectionFields: [
            { id: "label", label: "Label", type: "text", required: false },
          ],
        },
      ],
      [
        "connection access",
        { connectionAccess: [{ id: "write", label: "Write back" }] },
      ],
      ["an always ready runtime", { runtime: { start: "alwaysReady" } }],
      ["an unknown manifest field", { signIn: { kind: "oauth" } }],
    ])("skips a package that declares %s", async (_name, manifest) => {
      const api4 = await manager({ manifest });

      await expect(api4.listPlugins()).resolves.toEqual([]);
    });

    describe("a plugin id the plugin host already holds", () => {
      async function managerBesidePluginHost(
        hostFolder: (own: string) => string,
      ) {
        const root = await tempDir();
        const pluginDirectory = await createPlugin(
          root,
          SHAPE_SOURCE,
          undefined,
          API_4_MANIFEST,
        );
        const created = new ProjectDataShapePluginManager({
          pluginDirectories: [pluginDirectory],
          admitPluginApi4: true,
          runtime: new InProcessPluginRuntime(),
          pluginHostPackages: async () =>
            new Map([["workday-project-data", hostFolder(pluginDirectory)]]),
        });
        managers.push(created);
        return created;
      }

      it("refuses a data shape from another folder, and says why", async () => {
        const other = await tempDir();
        const shape = await managerBesidePluginHost(() => other);

        await expect(shape.listPlugins()).resolves.toEqual([]);
        await expect(
          shape.exportProjects("workday-project-data", EXPORTED_PROJECTS),
        ).rejects.toThrow(
          'Schema plugin "workday-project-data" shares its id with a plugin from another folder',
        );
        expect(shape.activeOperationCount).toBe(0);
      });

      it("keeps a package that is the plugin host's own folder", async () => {
        const shape = await managerBesidePluginHost((own) => own);

        await expect(shape.listPlugins()).resolves.toEqual([
          expect.objectContaining({ id: "workday-project-data" }),
        ]);
        await expect(
          shape.exportProjects("workday-project-data", EXPORTED_PROJECTS),
        ).resolves.toMatchObject({ datasets: [{ id: "projects" }] });
      });
    });

    it("skips an API 4 package without the project data shape capability", async () => {
      const root = await tempDir();
      const directory = path.join(root, "no-shape");
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "plugin.json"),
        JSON.stringify({
          id: "no-shape",
          version: "1.0.0",
          apiVersion: 4,
          displayName: "No shape",
          iconSvg: ICON,
          capabilities: { projectProperties: { properties: [] } },
        }),
        "utf8",
      );
      const api4 = new ProjectDataShapePluginManager({
        pluginDirectories: [directory],
        admitPluginApi4: true,
        runtime: new InProcessPluginRuntime(),
      });
      managers.push(api4);

      await expect(api4.listPlugins()).resolves.toEqual([]);
    });
  });
});
