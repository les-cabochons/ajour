import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginApi4ManifestSchema } from "../../shared/plugin-api-4.ts";
import { parseProjectSourceSyncResult } from "../../shared/project-source.ts";
import type { PluginConnection } from "../index.ts";
import { createFakeAjour } from "../testing.ts";
import { manifest, plugin } from "./sample-project-source/plugin.ts";

/*
 * A project source written against the SDK: its manifest passes Ajour's
 * schema, and what `syncProjects` answers is what Ajour's host accepts.
 */

const connection: PluginConnection = {
  id: "connection-1",
  pluginId: "ajc-sample-source",
  label: "Planner",
  tenantLabel: "Acme",
  autoSync: true,
  autoSyncIntervalMinutes: 15,
  connectedAt: 1,
  config: { serviceUrl: "https://planner.example" },
  access: [],
};

const service = {
  reportedAt: "2026-10-31T23:59:59Z",
  linked: false,
  projects: [
    {
      code: "ACME-SUP",
      title: "Acme - Support",
      done: false,
      hoursCap: 40,
      hoursUsed: 42,
      tasks: [{ id: "1001", title: "Login", phase: "Support", mine: true }],
    },
  ],
};

describe("a project source tested against the fake ajour", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("declares a manifest Ajour's schema accepts", () => {
    expect(pluginApi4ManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("answers a snapshot Ajour accepts, with the service's ETag as the cursor", async () => {
    const ajour = createFakeAjour({
      manifest,
      routes: [
        {
          method: "GET",
          path: "/integration/snapshot",
          respond: {
            status: 200,
            headers: { etag: 'W/"v7"' },
            body: JSON.stringify(service),
          },
        },
      ],
    });
    vi.stubGlobal("ajour", ajour);

    const result = parseProjectSourceSyncResult(
      await plugin.syncProjects!(connection, {}),
    );

    expect(result).toEqual({
      cursor: 'W/"v7"',
      snapshot: {
        source: { label: "Planner", url: "https://planner.example" },
        asOf: "2026-10-31T23:59:59Z",
        me: {
          hoursAvailable: false,
          hoursNote: "Link your account in Planner to compare your hours.",
        },
        projects: [
          {
            remoteId: "ACME-SUP",
            name: "Acme - Support",
            code: "ACME-SUP",
            url: "https://planner.example/projects/ACME-SUP",
            complete: false,
            budget: {
              unit: "hours",
              total: 40,
              consumed: 42,
              remaining: -2,
              status: "over",
            },
            tasks: [
              {
                remoteId: "1001",
                name: "Login",
                group: "Support",
                closed: false,
                assigned: true,
              },
            ],
          },
        ],
      },
    });
    expect(ajour.requests).toMatchObject([
      { method: "GET", path: "/integration/snapshot" },
    ]);
  });

  it("sends the cursor back and reports no change on a 304", async () => {
    const ajour = createFakeAjour({
      manifest,
      routes: [
        {
          method: "GET",
          path: "/integration/snapshot",
          respond: { status: 304, body: "" },
        },
      ],
    });
    vi.stubGlobal("ajour", ajour);

    const result = parseProjectSourceSyncResult(
      await plugin.syncProjects!(connection, { cursor: 'W/"v7"' }),
    );

    expect(result).toEqual({ unchanged: true });
    expect(ajour.requests).toMatchObject([
      { headers: { "if-none-match": 'W/"v7"' } },
    ]);
  });
});
