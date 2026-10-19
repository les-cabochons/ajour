import { listProjectPropertyPlugins } from "@/lib/plugin-project-properties";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPluginsOverview, isPluginApiMissing } = vi.hoisted(() => ({
  getPluginsOverview: vi.fn(),
  isPluginApiMissing: vi.fn(),
}));

vi.mock("@/lib/app-api", () => ({
  getPluginsOverview,
  isPluginApiMissing,
}));

const capability = {
  section: "Workday",
  fields: [{ id: "name", label: "Workday name" }],
};

function group(
  id: string,
  options: {
    enabled?: boolean;
    unavailableReason?: string;
    projectProperties?: typeof capability;
  } = {},
) {
  return {
    enabled: options.enabled ?? true,
    plugin: {
      id,
      unavailableReason: options.unavailableReason,
      capabilities: { projectProperties: options.projectProperties },
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
