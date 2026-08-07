import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

async function createPlugin(parent: string, source: string) {
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

describe("ProjectDataShapePluginManager", () => {
  const tempDirectories: string[] = [];
  const managers: ProjectDataShapePluginManager[] = [];

  async function tempDir() {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "timetracker-project-shape-"),
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

  it("reserves capacity before discovery and drains reservations on shutdown", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPlugin(
      root,
      "export async function exportProjects() { return await new Promise(() => {}); }",
    );
    const manager = new ProjectDataShapePluginManager({
      pluginDirectories: [pluginDirectory],
      requestTimeoutMs: 60_000,
    });
    managers.push(manager);

    const pending = Array.from({ length: 4 }, () =>
      manager
        .exportProjects("workday-project-data", [])
        .then(() => undefined, (error: unknown) => error),
    );
    expect(manager.activeOperationCount).toBe(4);
    await expect(manager.exportProjects("missing-plugin", [])).rejects.toThrow(
      /Too many project data shape plugin operations/u,
    );

    await manager.shutdown();
    const results = await Promise.all(pending);
    expect(results.every((result) => result instanceof Error)).toBe(true);
    expect(manager.activeOperationCount).toBe(0);
  });
});
