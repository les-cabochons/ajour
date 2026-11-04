import {
  getCachedPropertyPlugins,
  listProjectPropertyPlugins,
  listPropertyPlugins,
} from "@/lib/plugin-project-properties";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPluginsOverview, getCachedPluginsOverview, isPluginApiMissing } =
  vi.hoisted(() => ({
    getPluginsOverview: vi.fn(),
    getCachedPluginsOverview: vi.fn(),
    isPluginApiMissing: vi.fn(),
  }));

vi.mock("@/lib/app-api", () => ({
  getPluginsOverview,
  getCachedPluginsOverview,
  isPluginApiMissing,
}));

const capability = {
  section: "Workday",
  fields: [{ id: "name", label: "Workday name" }],
};

const taskCapability = {
  section: "Workday",
  fields: [{ id: "task", label: "Workday task", defaultFrom: "name" }],
};

function group(
  id: string,
  options: {
    enabled?: boolean;
    unavailableReason?: string;
    projectProperties?: typeof capability;
    taskProperties?: typeof taskCapability;
  } = {},
) {
  return {
    enabled: options.enabled ?? true,
    plugin: {
      id,
      unavailableReason: options.unavailableReason,
      capabilities: {
        projectProperties: options.projectProperties,
        taskProperties: options.taskProperties,
      },
    },
  };
}

describe("listProjectPropertyPlugins", () => {
  beforeEach(() => {
    getPluginsOverview.mockReset();
    isPluginApiMissing.mockReset();
  });

  it("keeps only active plugins that add project properties", async () => {
    getPluginsOverview.mockResolvedValue({
      pluginsEnabled: true,
      connectionGroups: [
        group("kept", { projectProperties: capability }),
        group("disabled", { enabled: false, projectProperties: capability }),
        group("unavailable", {
          unavailableReason: "Missing runtime",
          projectProperties: capability,
        }),
        group("no-capability"),
      ],
    });

    await expect(listProjectPropertyPlugins()).resolves.toEqual([
      { pluginId: "kept", capability },
    ]);
  });

  it("lists task properties apart, from the same overview", async () => {
    getPluginsOverview.mockResolvedValue({
      pluginsEnabled: true,
      connectionGroups: [
        group("both", {
          projectProperties: capability,
          taskProperties: taskCapability,
        }),
        group("tasks-only", { taskProperties: taskCapability }),
        group("disabled", { enabled: false, taskProperties: taskCapability }),
      ],
    });

    await expect(listPropertyPlugins()).resolves.toEqual({
      projects: [{ pluginId: "both", capability }],
      tasks: [
        { pluginId: "both", capability: taskCapability },
        { pluginId: "tasks-only", capability: taskCapability },
      ],
    });
    expect(getPluginsOverview).toHaveBeenCalledTimes(1);
  });

  it("returns nothing when plugins are turned off", async () => {
    getPluginsOverview.mockResolvedValue({
      pluginsEnabled: false,
      connectionGroups: [group("kept", { projectProperties: capability })],
    });

    await expect(listProjectPropertyPlugins()).resolves.toEqual([]);
  });

  it("returns nothing when the local API is missing", async () => {
    const error = new Error("no api");
    getPluginsOverview.mockRejectedValue(error);
    isPluginApiMissing.mockReturnValue(true);

    await expect(listProjectPropertyPlugins()).resolves.toEqual([]);
  });

  it("rethrows other errors", async () => {
    getPluginsOverview.mockRejectedValue(new Error("boom"));
    isPluginApiMissing.mockReturnValue(false);

    await expect(listProjectPropertyPlugins()).rejects.toThrow("boom");
  });
});

describe("getCachedPropertyPlugins", () => {
  it("reads the property plugins of the cached overview, without a request", () => {
    getPluginsOverview.mockReset();
    getCachedPluginsOverview.mockReturnValue({
      pluginsEnabled: true,
      connectionGroups: [
        group("workday", { taskProperties: taskCapability }),
        group("disabled", { enabled: false, taskProperties: taskCapability }),
      ],
    });

    expect(getCachedPropertyPlugins()).toEqual({
      projects: [],
      tasks: [{ pluginId: "workday", capability: taskCapability }],
    });
    expect(getPluginsOverview).not.toHaveBeenCalled();
  });

  it("is undefined before any overview is cached", () => {
    getCachedPluginsOverview.mockReturnValue(null);
    expect(getCachedPropertyPlugins()).toBeUndefined();
  });
});
