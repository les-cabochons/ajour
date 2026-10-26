import { describe, expect, it } from "vitest";
import {
  comparePluginVersions,
  pluginCatalogEntrySchema,
  pluginCatalogResponseSchema,
} from "../plugin-catalog";

const azureDevOps = {
  id: "azure_devops",
  title: "Azure DevOps",
  description: "Sync work items into Ajour.",
  version: "1.1.0",
  author: { name: "Alex", url: "https://example.com/alex" },
  license: { name: "MIT License", spdxId: "MIT" },
  website: "https://example.com/plugin",
  repository: {
    slug: "les-cabochons/ajour-plugins",
    url: "https://github.com/les-cabochons/ajour-plugins",
  },
  source: {
    url: "https://github.com/les-cabochons/ajour-plugins",
    name: "Ajour official plugins",
    official: true,
    signed: true,
    keyFingerprint: "3f2a 9c1d 77e0 b4a2",
  },
  status: "available",
  compatibility: { pluginApiVersion: 3 },
  capabilities: ["connector"],
  features: ["work-item-sync"],
  install: { method: "source" },
  tags: ["project-management"],
} as const;

describe("plugin catalog contracts", () => {
  it("accepts the normalized desktop catalog response", () => {
    expect(
      pluginCatalogResponseSchema.parse({
        entries: [azureDevOps],
        checkedAt: "2026-08-07T04:00:00.000Z",
        source: "network",
      }).entries[0]?.id,
    ).toBe("azure_devops");
  });

  it("rejects remote artwork URLs from the renderer contract", () => {
    expect(() =>
      pluginCatalogEntrySchema.parse({
        ...azureDevOps,
        images: { thumbnailDataUrl: "https://example.com/icon.png" },
      }),
    ).toThrow();
  });

  it("rejects unknown and repeated capabilities", () => {
    expect(() =>
      pluginCatalogEntrySchema.parse({
        ...azureDevOps,
        capabilities: ["work-item-sync"],
      }),
    ).toThrow();
    expect(() =>
      pluginCatalogEntrySchema.parse({
        ...azureDevOps,
        capabilities: ["connector", "connector"],
      }),
    ).toThrow();
  });
});

describe("plugin versions", () => {
  it.each([
    ["1.0.1", "1.0.0", 1],
    ["1.0.0", "1.0.0", 0],
    ["1.0.0-main.130.abc", "1.0.0", -1],
    ["1.0.0-main.130.abc", "1.0.0-main.99.def", 1],
    ["0.10.0", "0.9.9", 1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["not a version", "1.0.0", 0],
  ])("compares %s with %s as %d", (left, right, expected) => {
    expect(comparePluginVersions(left, right)).toBe(expected);
  });
});
