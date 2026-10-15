import { listProjectPropertyPlugins } from "@/lib/plugin-project-properties";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConnectorsOverview, isConnectorApiMissing } = vi.hoisted(() => ({
  getConnectorsOverview: vi.fn(),
  isConnectorApiMissing: vi.fn(),
}));

vi.mock("@/lib/app-api", () => ({
  getConnectorsOverview,
  isConnectorApiMissing,
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
    getConnectorsOverview.mockReset();
    isConnectorApiMissing.mockReset();
  });

  it("keeps only active plugins that add project properties", async () => {
    getConnectorsOverview.mockResolvedValue({
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
    getConnectorsOverview.mockResolvedValue({
      pluginsEnabled: false,
      connectionGroups: [group("kept", { projectProperties: capability })],
    });

    await expect(listProjectPropertyPlugins()).resolves.toEqual([]);
  });

  it("returns nothing when the local API is missing", async () => {
    const error = new Error("no api");
    getConnectorsOverview.mockRejectedValue(error);
    isConnectorApiMissing.mockReturnValue(true);

    await expect(listProjectPropertyPlugins()).resolves.toEqual([]);
  });

  it("rethrows other errors", async () => {
    getConnectorsOverview.mockRejectedValue(new Error("boom"));
    isConnectorApiMissing.mockReturnValue(false);

    await expect(listProjectPropertyPlugins()).rejects.toThrow("boom");
  });
});
