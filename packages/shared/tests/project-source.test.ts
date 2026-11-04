import { describe, expect, it } from "vitest";
import {
  pluginApi4ManifestSchema,
  projectSourceSyncResultSchema,
} from "../plugin-api-4";
import { pluginManifestSchema } from "../plugins";
import { jiraManifest } from "./fixtures/api-4-manifests";

describe("project sources", () => {
  it("admits a read-only project source only on API 4", () => {
    const manifest = { ...jiraManifest(), capabilities: { projectSource: {} } };
    expect(
      pluginApi4ManifestSchema.parse(manifest).capabilities.projectSource,
    ).toEqual({});
    expect(
      pluginManifestSchema.safeParse({ ...manifest, apiVersion: 3 }).success,
    ).toBe(false);
    expect(
      pluginApi4ManifestSchema.safeParse({ ...manifest, entrypoint: undefined })
        .success,
    ).toBe(false);
  });
});

const snapshot = {
  source: { label: "Planning", url: "https://planning.example.com" },
  asOf: "2026-11-04T07:00:00Z",
  me: { hoursAvailable: true },
  projects: [
    {
      remoteId: "p1",
      name: "Project",
      code: "P1",
      complete: false,
      budget: {
        unit: "hours",
        total: 100,
        consumed: 20,
        remaining: 80,
        status: "ok",
      },
      tasks: [
        {
          remoteId: "t1",
          name: "Build",
          closed: false,
          assigned: true,
          estimateHours: 12,
          myHours: 2,
        },
      ],
    },
  ],
};

it("validates snapshots and identifies invalid nested fields", () => {
  expect(
    projectSourceSyncResultSchema.parse({ snapshot, cursor: "revision-1" }),
  ).toEqual({ snapshot, cursor: "revision-1" });
  expect(projectSourceSyncResultSchema.parse({ unchanged: true })).toEqual({
    unchanged: true,
  });
  const bad = structuredClone(snapshot);
  bad.projects[0]!.tasks[0]!.myHours = -1;
  const result = projectSourceSyncResultSchema.safeParse({ snapshot: bad });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(JSON.stringify(result.error.issues)).toContain("myHours");
  expect(
    projectSourceSyncResultSchema.safeParse({
      snapshot: { ...snapshot, asOf: "yesterday" },
    }).success,
  ).toBe(false);
  expect(
    projectSourceSyncResultSchema.safeParse({ unchanged: true, snapshot })
      .success,
  ).toBe(false);
});
