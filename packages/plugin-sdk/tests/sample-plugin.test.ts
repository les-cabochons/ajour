import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginConnection } from "../index.ts";
import { createFakeAjour } from "../testing.ts";
import { manifest, plugin } from "./sample-plugin/plugin.ts";

const connection: PluginConnection = {
  id: "connection-1",
  pluginId: "ajc-sample",
  label: "Work",
  tenantLabel: "Acme",
  autoSync: false,
  autoSyncIntervalMinutes: 15,
  connectedAt: 1,
  config: { baseUrl: "https://acme.example", email: "ada@acme.example" },
  access: [],
};

describe("a plugin tested against the fake ajour", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("syncs from fixtures and sends exactly the request its access allows", async () => {
    const ajour = createFakeAjour({
      manifest,
      routes: [
        {
          method: "POST",
          path: "/rest/api/3/search/jql",
          respond: {
            json: {
              issues: [
                {
                  key: "ENG-1",
                  fields: { summary: "Fix the login", issuetype: "Bug" },
                },
              ],
            },
          },
        },
      ],
    });
    vi.stubGlobal("ajour", ajour);

    const result = await plugin.syncConnection!(connection, []);

    expect(result.items).toEqual([
      expect.objectContaining({
        sourceId: "ENG-1",
        title: "Fix the login",
        workItemType: "Bug",
      }),
    ]);
    expect(ajour.requests).toEqual([
      expect.objectContaining({
        connectionId: "connection-1",
        method: "POST",
        path: "/rest/api/3/search/jql",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
      }),
    ]);
    expect(JSON.parse(ajour.requests[0]!.bodyText!)).toEqual({
      jql: "assignee = currentUser()",
      fields: ["summary", "issuetype"],
    });
    expect(ajour.logs).toEqual([
      { level: "info", message: "Synced issues", fields: { count: 1 } },
    ]);
  });

  it("says when the service rejects the token", async () => {
    vi.stubGlobal(
      "ajour",
      createFakeAjour({
        manifest,
        routes: [
          {
            method: "GET",
            path: "/rest/api/3/myself",
            respond: { status: 401 },
          },
        ],
      }),
    );

    await expect(
      plugin.validateConnection!(connection, { capabilities: ["connector"] }),
    ).rejects.toThrow("The token was rejected.");
  });
});
