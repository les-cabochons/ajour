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

async function createPlugin(
  parent: string,
  source: string,
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
                {
                  key: "hours",
                  header: "hours",
                  type: "number",
                  required: false,
                },
              ],
            },
          ],
        },
      },
    }),
    "utf8",
  );
  await writeFile(path.join(pluginDirectory, "plugin.mjs"), source, "utf8");
  return pluginDirectory;
}

/** A data shape plugin that exports one row per project and imports one project per row. */
const SHAPE_SOURCE = [
  "export async function exportProjects(projects) {",
  "  return { datasets: [{ id: 'projects', rows: projects.map((project) => ({ project: project.name, hours: 2 })) }] };",
  "}",
  "export async function importProjects(datasets) {",
  "  return { projects: datasets[0].rows.map((row) => ({ name: row.project, color: '#123456', status: 'active', tasks: [] })) };",
  "}",
].join("\n");

const EXPORTED_PROJECTS = [
  { name: "Mercury", color: "#123456", status: "active" as const, tasks: [] },
  { name: "Venus", color: "#654321", status: "archived" as const, tasks: [] },
];
const IMPORTED_DATASETS = [
  {
    id: "projects",
    rows: [
      { project: "Mercury", hours: "2,5" },
      { project: "Venus", hours: 4 },
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
        "export async function importProjects(datasets) {",
        "  return { projects: datasets[0].rows.map((row) => ({ name: row.project, color: '#123456', status: 'active', tasks: [] })) };",
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
          id: "projects",
          rows: [{ project: "Mercury", hours: "2,5" }],
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

  describe("plugin API 4 packages", () => {
    const API_4_MANIFEST = { apiVersion: 4, runtime: { start: "whenNeeded" } };

    async function manager(
      options: {
        manifest?: Record<string, unknown>;
        admitPluginApi4?: boolean;
        runtime?: PluginRuntime;
      } = {},
    ) {
      const root = await tempDir();
      const pluginDirectory = await createPlugin(root, SHAPE_SOURCE, {
        ...API_4_MANIFEST,
        ...options.manifest,
      });
      const created = new ProjectDataShapePluginManager({
        pluginDirectories: [pluginDirectory],
        admitPluginApi4: options.admitPluginApi4 ?? true,
        runtime: options.runtime ?? new InProcessPluginRuntime(),
      });
      managers.push(created);
      return created;
    }

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
        api4.importProjects("workday-project-data", IMPORTED_DATASETS),
      ).resolves.toEqual(
        await api1.importProjects("workday-project-data", IMPORTED_DATASETS),
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
      ["an always ready runtime", { runtime: { start: "alwaysReady" } }],
      ["an unknown manifest field", { signIn: { kind: "oauth" } }],
    ])("skips a package that declares %s", async (_name, manifest) => {
      const api4 = await manager({ manifest });

      await expect(api4.listPlugins()).resolves.toEqual([]);
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
