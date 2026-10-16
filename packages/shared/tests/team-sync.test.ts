import { describe, expect, it } from "vitest";
import {
  CONNECTOR_PLUGIN_API_VERSION,
  connectorPluginManifestSchema,
  isCapabilitySwitchedOn,
  pluginHasSwitchableCapabilities,
  pluginHasTeam,
  pluginRunsCode,
  teamCreateResultSchema,
} from "../connectors";
import { pluginCatalogCapabilitySchema } from "../plugin-catalog";
import {
  TEAM_CAPABILITY_API_VERSION,
  TEAM_SYNC_MAX_PROJECTS,
  teamProjectChangeSchema,
  teamProjectSchema,
  teamSyncRequestSchema,
  teamSyncResultSchema,
} from "../team-sync";

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

  it("refuses an icon that points outside the workspace", () => {
    expect(() =>
      teamProjectChangeSchema.parse({
        ...newProject,
        icon: { kind: "upload", src: "https://tracker.example/pixel.png" },
      }),
    ).toThrow();
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
