import { describe, expect, it } from "vitest";
import type { PluginCatalogEntry } from "@ajour/shared";
import { canInstallCatalogPlugin } from "./plugin-catalog-ui";

function entry(
  capabilities: PluginCatalogEntry["capabilities"],
): PluginCatalogEntry {
  return {
    schemaVersion: 2,
    id: "sample",
    title: "Sample",
    description: "Sample plugin.",
    author: { name: "Ajour", url: "https://github.com/les-cabochons" },
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://github.com/les-cabochons/ajour/blob/main/LICENSE",
    },
    website: "https://docs.ajour.day",
    repository: {
      provider: "github",
      slug: "les-cabochons/sample",
      url: "https://github.com/les-cabochons/sample",
    },
    status: "available",
    compatibility: { pluginApiVersion: 3 },
    capabilities,
    features: ["sample"],
    tags: ["sample"],
  };
}

describe("canInstallCatalogPlugin", () => {
  it.each([["connector"], ["codeHost"], ["calendar"], ["team"], ["agentTask"]])(
    "allows downloading a packaged %s plugin",
    (capability) => {
      expect(
        canInstallCatalogPlugin(
          entry([capability as PluginCatalogEntry["capabilities"][number]]),
        ),
      ).toBe(true);
    },
  );

  it("leaves a schema-only plugin to the built-in shapes for now", () => {
    expect(canInstallCatalogPlugin(entry(["schema"]))).toBe(false);
  });
});
