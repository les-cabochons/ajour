import { serialize } from "node:v8";
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_PLUGIN_API_VERSION,
  connectorPluginManifestSchema,
  isCapabilitySwitchedOn,
  pluginHasSwitchableCapabilities,
  pluginHasTeam,
  pluginRunsCode,
  pluginSwitchableCapabilities,
  teamCreateResultSchema,
} from "../connectors";
import { pluginCatalogCapabilitySchema } from "../plugin-catalog";
import {
  TEAM_CAPABILITY_API_VERSION,
  TEAM_SYNC_MAX_PROJECTS,
  TEAM_SYNC_MAX_TASKS,
  teamProjectChangeSchema,
  teamProjectSchema,
  teamSyncRequestSchema,
  teamSyncResultSchema,
} from "../team-sync";

/** `MAX_CONNECTOR_PLUGIN_RESULT_BYTES` in apps/api/src/plugin-worker.mjs. */
const WORKER_RESULT_LIMIT_BYTES = 8 * 1024 * 1024;
const teamCapability = { apiVersion: TEAM_CAPABILITY_API_VERSION };
/** A 1 pixel PNG, as the canvas that rasterizes uploaded icons encodes them. */
const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const teamManifest = {
  id: "example-team",
  version: "0.1.0",
  apiVersion: CONNECTOR_PLUGIN_API_VERSION,
  displayName: "Example team",
  iconSvg: "<svg viewBox='0 0 16 16' />",
  entrypoint: "dist/plugin.js",
  capabilities: { team: { apiVersion: TEAM_CAPABILITY_API_VERSION } },
  connectionFields: [
    {
      id: "deploymentUrl",
      label: "Deployment URL",
      type: "url",
      required: true,
    },
  ],
};

const newProject = {
  localId: "project-1",
  name: "Acme Website Redesign",
  displayName: "Acme",
  code: "ACM-01",
  color: "#4f46e5",
  icon: { kind: "preset", name: "dot" },
  status: "active",
  tasks: [
    {
      localId: "task-1",
      name: "Development",
      status: "active",
      billable: true,
      budgetMs: 36_000_000,
    },
  ],
};

const teamProject = {
  remoteId: "remote-project-1",
  name: "Acme Website Redesign",
  displayName: "Acme",
  code: null,
  color: "#4f46e5",
  icon: { kind: "preset", name: "dot" },
  status: "active",
  tasks: [],
};

describe("team capability in the manifest", () => {
  it("accepts a plugin with only a team, which runs code", () => {
    const manifest = connectorPluginManifestSchema.parse(teamManifest);
    expect(pluginHasTeam(manifest)).toBe(true);
    expect(pluginRunsCode(manifest)).toBe(true);
    expect(pluginHasSwitchableCapabilities(manifest)).toBe(false);
  });

  it("requires an entrypoint and connection fields for a team", () => {
    const { entrypoint: _entrypoint, ...withoutEntrypoint } = teamManifest;
    expect(() =>
      connectorPluginManifestSchema.parse(withoutEntrypoint),
    ).toThrow(/entrypoint/);
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...teamManifest,
        connectionFields: [],
      }),
    ).toThrow(/connection fields/);
  });

  it("refuses a team capability API this Ajour does not run", () => {
    expect(() =>
      connectorPluginManifestSchema.parse({
        ...teamManifest,
        capabilities: { team: { apiVersion: TEAM_CAPABILITY_API_VERSION + 1 } },
      }),
    ).toThrow();
  });

  it("gives a team its own switch when the plugin also declares a connector", () => {
    const manifest = connectorPluginManifestSchema.parse({
      ...teamManifest,
      capabilities: { ...teamManifest.capabilities, connector: {} },
    });
    expect(pluginHasSwitchableCapabilities(manifest)).toBe(true);
    const group = { plugin: manifest, inactiveCapabilities: ["team"] as const };
    expect(isCapabilitySwitchedOn(group, "connector")).toBe(true);
    expect(isCapabilitySwitchedOn(group, "team")).toBe(false);
  });

  it.each([
    [{ connector: {}, codeHost: {} }, ["connector", "codeHost"]],
    [{ connector: {}, team: teamCapability }, ["connector", "team"]],
    [{ codeHost: {}, team: teamCapability }, ["codeHost", "team"]],
    [
      { connector: {}, codeHost: {}, team: teamCapability },
      ["connector", "codeHost", "team"],
    ],
  ])(
    "switches only the capabilities a plugin declares",
    (capabilities, switches) => {
      const manifest = connectorPluginManifestSchema.parse({
        ...teamManifest,
        capabilities,
      });
      expect(pluginSwitchableCapabilities(manifest)).toEqual(switches);
      expect(pluginHasSwitchableCapabilities(manifest)).toBe(true);
    },
  );

  it("lists a team as a catalog capability", () => {
    expect(pluginCatalogCapabilitySchema.parse("team")).toBe("team");
  });

  it("returns the values that join a new team", () => {
    expect(
      teamCreateResultSchema.parse({
        values: { teamId: "team_123", teamSecret: "s3cret" },
      }).values,
    ).toEqual({ teamId: "team_123", teamSecret: "s3cret" });
  });
});

describe("team sync changes", () => {
  it("accepts a new project that carries every team-owned field", () => {
    expect(teamProjectChangeSchema.parse(newProject).tasks).toHaveLength(1);
  });

  it("refuses a new project or task that leaves out a field", () => {
    const { color: _color, ...withoutColor } = newProject;
    expect(() => teamProjectChangeSchema.parse(withoutColor)).toThrow(/color/);
    expect(() =>
      teamProjectChangeSchema.parse({
        localId: "project-1",
        remoteId: "remote-project-1",
        tasks: [{ localId: "task-2", name: "Meetings" }],
      }),
    ).toThrow(/billable/);
  });

  it("sends only the changed fields of a shared project", () => {
    const change = teamProjectChangeSchema.parse({
      localId: "project-1",
      remoteId: "remote-project-1",
      name: "Acme Website Rebuild",
      tasks: [{ localId: "task-1", remoteId: "remote-task-1", budgetMs: null }],
    });
    expect(change).not.toHaveProperty("color");
    expect(change.tasks[0]).toEqual({
      localId: "task-1",
      remoteId: "remote-task-1",
      budgetMs: null,
    });
  });

  it("accepts an uploaded icon as a base64 PNG data URL", () => {
    const icon = { kind: "upload", src: pngDataUrl, maskSrc: pngDataUrl };
    expect(teamProjectChangeSchema.parse({ ...newProject, icon }).icon).toEqual(
      icon,
    );
  });

  it.each([
    ["a remote URL", "https://tracker.example/pixel.png"],
    [
      "a data URL that closes the CSS url and opens another",
      `${pngDataUrl}"), url("https://tracker.example/pixel.png`,
    ],
    ["an SVG data URL", "data:image/svg+xml;base64,PHN2Zz4="],
  ])("refuses an icon image that is %s, as src or maskSrc", (_, image) => {
    for (const icon of [
      { kind: "upload", src: image },
      { kind: "upload", src: pngDataUrl, maskSrc: image },
    ]) {
      expect(() =>
        teamProjectChangeSchema.parse({ ...newProject, icon }),
      ).toThrow();
    }
  });

  it("refuses a color the color field cannot produce", () => {
    for (const color of ["red", "#fff", "#4f46e5; background: url(x)"]) {
      expect(() =>
        teamProjectChangeSchema.parse({ ...newProject, color }),
      ).toThrow();
    }
  });

  it("carries no time data, even when a client sends it", () => {
    const change = teamProjectChangeSchema.parse({
      ...newProject,
      pinnedSlot: "1",
      pluginProperties: { workday: { code: "CA004" } },
      tasks: [
        {
          ...newProject.tasks[0],
          adjustmentMs: 3_600_000,
          trackedMs: 7_200_000,
        },
      ],
    });
    expect(change).not.toHaveProperty("pinnedSlot");
    expect(change).not.toHaveProperty("pluginProperties");
    expect(change.tasks[0]).not.toHaveProperty("adjustmentMs");
    expect(change.tasks[0]).not.toHaveProperty("trackedMs");
  });

  it("bounds the tasks of one request across its projects", () => {
    const task = (i: number) => ({
      localId: `task-${i}`,
      remoteId: `remote-task-${i}`,
      name: `Task ${i}`,
    });
    expect(() =>
      teamSyncRequestSchema.parse({
        changes: [0, 1].map((p) => ({
          localId: `project-${p}`,
          remoteId: `remote-project-${p}`,
          tasks: Array.from({ length: TEAM_SYNC_MAX_TASKS / 2 + p }, (_, i) =>
            task(p * TEAM_SYNC_MAX_TASKS + i),
          ),
        })),
      }),
    ).toThrow(/at most/);
  });

  it("bounds a request to one page of projects", () => {
    expect(teamSyncRequestSchema.parse({}).changes).toEqual([]);
    expect(() =>
      teamSyncRequestSchema.parse({
        changes: Array.from({ length: TEAM_SYNC_MAX_PROJECTS + 1 }, (_, i) => ({
          ...newProject,
          localId: `project-${i}`,
        })),
      }),
    ).toThrow();
  });
});

describe("team sync result", () => {
  it("reads a page with its cursor, assigned IDs and no more pages by default", () => {
    const result = teamSyncResultSchema.parse({
      cursor: "c1",
      projects: [teamProject],
      assigned: [{ localId: "project-1", remoteId: "remote-project-1" }],
    });
    expect(result.hasMore).toBe(false);
    expect(result.projects[0]?.code).toBeNull();
  });

  it("refuses a team project without its remote ID", () => {
    const { remoteId: _remoteId, ...withoutRemoteId } = teamProject;
    expect(() => teamProjectSchema.parse(withoutRemoteId)).toThrow();
  });

  it("lets a project's tasks span pages, but bounds the tasks of one page", () => {
    const tasks = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        remoteId: `remote-task-${i}`,
        name: `Task ${i}`,
        status: "active",
        billable: true,
        budgetMs: null,
      }));
    const page = (projects: unknown[]) => ({ cursor: "c1", projects });

    expect(() =>
      teamSyncResultSchema.parse(
        page([{ ...teamProject, tasks: tasks(TEAM_SYNC_MAX_TASKS) }]),
      ),
    ).not.toThrow();
    expect(() =>
      teamSyncResultSchema.parse(
        page([
          { ...teamProject, tasks: tasks(TEAM_SYNC_MAX_TASKS / 2) },
          {
            ...teamProject,
            remoteId: "remote-project-2",
            tasks: tasks(TEAM_SYNC_MAX_TASKS / 2 + 1),
          },
        ]),
      ),
    ).toThrow(/at most/);
  });

  it("keeps a worst-case page under half the worker's result limit", () => {
    // V8 stores these characters in two bytes each, the costliest case.
    const wide = (length: number) => "漢".repeat(length);
    const tasksPerProject = TEAM_SYNC_MAX_TASKS / TEAM_SYNC_MAX_PROJECTS;
    const largestIcon = `data:image/png;base64,${"A".repeat(16_384 - 22)}`;
    const result = teamSyncResultSchema.parse({
      cursor: wide(2_000),
      projects: Array.from({ length: TEAM_SYNC_MAX_PROJECTS }, (_, p) => ({
        remoteId: `${p}${wide(98)}`,
        name: wide(240),
        displayName: wide(240),
        code: wide(120),
        color: "#4f46e5",
        icon: { kind: "upload", src: largestIcon, maskSrc: largestIcon },
        status: "archived",
        tasks: Array.from({ length: tasksPerProject }, (_, t) => ({
          remoteId: `${p}-${t}${wide(90)}`,
          name: wide(240),
          status: "archived",
          billable: false,
          budgetMs: Number.MAX_SAFE_INTEGER,
        })),
      })),
      assigned: Array.from(
        { length: TEAM_SYNC_MAX_PROJECTS + TEAM_SYNC_MAX_TASKS },
        (_, i) => ({
          localId: `${i}${wide(190)}`,
          remoteId: `${i}${wide(90)}`,
        }),
      ),
      hasMore: true,
    });

    expect(serialize(result).byteLength).toBeLessThan(
      WORKER_RESULT_LIMIT_BYTES / 2,
    );
  });

  it("refuses a page with more projects than the bound", () => {
    expect(() =>
      teamSyncResultSchema.parse({
        cursor: "c1",
        projects: Array.from(
          { length: TEAM_SYNC_MAX_PROJECTS + 1 },
          (_, i) => ({
            ...teamProject,
            remoteId: `remote-${i}`,
          }),
        ),
      }),
    ).toThrow();
  });
});
