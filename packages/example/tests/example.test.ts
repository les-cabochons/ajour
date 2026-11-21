import { describe, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../shared/plugin-api-4.ts";
import { backlogItemTypesResultSchema } from "../../shared/plugins.ts";
import { projectSourceSnapshotSchema } from "../../shared/project-source.ts";
import {
  describeExampleItemTypes,
  exampleProjectSourceDirectory,
  exampleProjectSourceManifest,
  exampleTrackerDirectory,
  exampleTrackerManifest,
  fixtureSnapshot,
} from "../index.ts";

// What the plugins answer when Ajour loads them from their folders is
// checked through the real API, in apps/api/src/project-source-routes.test.ts
// and apps/api/src/item-types-route.test.ts.

describe("the example project source", () => {
  it("declares a manifest Ajour's plugin API 4 schema accepts", () => {
    expect(
      pluginApi4ManifestSchema.safeParse(exampleProjectSourceManifest).success,
    ).toBe(true);
    expect(exampleProjectSourceDirectory).toMatch(
      /packages[\\/]example[\\/]plugin$/,
    );
  });

  it("serves a fixture Ajour's snapshot schema accepts", () => {
    expect(projectSourceSnapshotSchema.safeParse(fixtureSnapshot).success).toBe(
      true,
    );
  });
});

describe("the example tracker", () => {
  it("declares a manifest Ajour's plugin API 4 schema accepts, with item types", () => {
    const parsed = pluginApi4ManifestSchema.safeParse(exampleTrackerManifest);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data?.capabilities.connector?.itemTypes).toBe(true);
    expect(exampleTrackerDirectory).toMatch(
      /packages[\\/]example[\\/]tracker$/,
    );
  });

  it("describes the types it was asked about and offers others", async () => {
    const result = await describeExampleItemTypes(
      { id: "tracker-1", config: {} } as never,
      { types: [{ name: "Task", sourceId: "TR-2" }] },
    );

    expect(backlogItemTypesResultSchema.safeParse(result).success).toBe(true);
    expect(result.types.map((type) => type.name)).toEqual(
      expect.arrayContaining(["Task", "Epic"]),
    );
  });
});
