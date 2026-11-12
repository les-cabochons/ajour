import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { exampleProjectSourceManifest } from "../../../../../packages/example/index.ts";

/*
 * Time sync (#691): the example planner declares a project source and a
 * time sync. A mocked local API serves it with Time entries off, and
 * answers turning it on as the API does when the plugin refuses the
 * connection: a 400 with the connection's label and the plugin's sentence.
 */

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const CONNECTION = "planner";
const REFUSAL =
  "Planner: Time entries need a token that can write. This one can only read.";

const plugin = {
  ...exampleProjectSourceManifest,
  connectionFields: exampleProjectSourceManifest.connectionFields.map(
    (field) => ({ secret: false, ...field }),
  ),
};

function overview() {
  return {
    vault: { state: "available" },
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        inactiveCapabilities: ["timeSync"],
        connections: [
          {
            id: CONNECTION,
            pluginId: plugin.id,
            label: "Planner",
            tenantLabel: "Example",
            autoSync: false,
            autoSyncIntervalMinutes: 15,
            connectedAt: 1,
            lastSyncAt: Date.now(),
            pendingImportCount: 0,
            selectedImportCount: 0,
            configSummary: {},
            editableValues: {
              label: "Planner",
              tenantLabel: "Example",
              serviceUrl: "https://planner.example",
            },
          },
        ],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

Given(
  "the example planner is connected, and refuses a token that can only read for time entries",
  async ({ page }) => {
    // Synced a moment ago, so the project source scheduler leaves it alone.
    await page.addInitScript(
      ({ connectionId, pluginId }) => {
        if (sessionStorage.getItem("time-sync-fixture")) return;
        localStorage.clear();
        sessionStorage.setItem("time-sync-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            projectSources: {
              [connectionId]: {
                pluginId,
                label: "Example planner",
                asOf: "2026-10-01T00:00:00.000Z",
                syncedAt: Date.now(),
                held: [],
              },
            },
          }),
        );
      },
      { connectionId: CONNECTION, pluginId: plugin.id },
    );
    await page.route(`${apiUrl}/api/plugins`, (route) =>
      route.fulfill({ json: overview(), headers: cors }),
    );
    await page.route(
      `${apiUrl}/api/plugins/${plugin.id}/activation`,
      async (route) => {
        expect(route.request().postDataJSON()).toEqual({
          enabled: true,
          capability: "timeSync",
        });
        await route.fulfill({
          status: 400,
          json: { error: REFUSAL },
          headers: cors,
        });
      },
    );
  },
);

When("I open the example planner's settings", async ({ page }) => {
  await page.goto(`/settings/plugins/${plugin.id}`);
  await expect(
    page.getByRole("heading", { name: plugin.displayName, exact: true }),
  ).toBeVisible();
});

Then("the example planner's Time entries switch is off", async ({ page }) => {
  await expect(
    page.getByRole("switch", {
      name: `Activate time entries for ${plugin.displayName}`,
      exact: true,
    }),
  ).not.toBeChecked();
});

When("I turn on time entries for the example planner", async ({ page }) => {
  await page
    .getByRole("switch", {
      name: `Activate time entries for ${plugin.displayName}`,
      exact: true,
    })
    .click();
});
