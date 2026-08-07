import { describe, expect, it } from "vitest";
import {
  pluginCatalogEntrySchema,
  pluginCatalogResponseSchema,
} from "../src/plugin-catalog";

const azureDevOps = {
  schemaVersion: 1,
  id: "azure_devops",
  type: "connector",
  title: "Azure DevOps",
  description: "Sync work items into Ajour.",
  author: { name: "Alex", url: "https://example.com/alex" },
  license: {
    name: "MIT License",
    spdxId: "MIT",
    url: "https://example.com/license",
  },
  website: "https://example.com/plugin",
  repository: {
    provider: "github",
    slug: "example/plugin",
    url: "https://github.com/example/plugin",
  },
  status: "available",
  compatibility: { pluginApiVersion: 1 },
  capabilities: ["work-item-sync"],
  install: {
    method: "github-release",
    allowPrereleases: true,
    assetPattern: "^plugin-.+\\.harday-connector$",
  },
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
});
