import { describe, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../../shared/plugin-api-4.ts";
import { projectSourceSnapshotSchema } from "../../shared/project-source.ts";
import {
  exampleProjectSourceDirectory,
  exampleProjectSourceManifest,
  fixtureSnapshot,
} from "../index.ts";

// What the plugin answers when Ajour loads it from `exampleProjectSourceDirectory`
// is checked through the real API, in apps/api/src/project-source-routes.test.ts.

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
