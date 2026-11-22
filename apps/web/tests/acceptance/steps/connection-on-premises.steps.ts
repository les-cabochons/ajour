import { expect, type Route } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const ICON =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>";

// On-premises connections (#647), against a local API that answers from
// memory: it records each save and reads the saved values back, as the
// real one does. The API's own tests cover the broker's http rule.

type Json = Record<string, unknown>;

interface OnPremisesMock {
  saves: Json[];
  /** The values of the saved connection, once there is one. */
  saved?: Json;
}

let mock: OnPremisesMock;

/** A plugin API 4 plugin whose server runs on the user's own computer. */
const plugin = {
  id: "local_tracker",
  displayName: "Local tracker",
  version: "1.0.0",
  apiVersion: 4,
  description: "A tracker served from this computer.",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [
    {
      id: "label",
      label: "Connection label",
      type: "text",
      required: true,
      defaultValue: "Local tracker",
    },
    {
      id: "tenantLabel",
      label: "Computer",
      type: "text",
      required: true,
      defaultValue: "This computer",
    },
    {
      id: "serverUrl",
      label: "Server address",
      type: "url",
      required: true,
    },
  ],
  network: {
    baseAddress: { field: "serverUrl", allowOnPremises: true },
    endpoints: [{ method: "GET", path: "/health" }],
  },
};

function connection(values: Json) {
  return {
    id: "local",
    pluginId: plugin.id,
    label: "Local tracker",
    tenantLabel: "This computer",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: values,
  };
}

function overviewOf(current: OnPremisesMock) {
  return {
    vault: { state: "available" },
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        connections: current.saved ? [connection(current.saved)] : [],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, json, headers: cors });
}

Given(
  "a plugin whose connections may be marked on-premises",
  async ({ page }) => {
    mock = { saves: [] };
    const current = mock;
    await page.route(`${apiUrl}/api/plugins`, (route) =>
      fulfill(route, overviewOf(current)),
    );
    await page.route(`${apiUrl}/api/backlog/imports`, (route) =>
      fulfill(route, { items: [], totalCount: 0, selectedCount: 0 }),
    );
    await page.route(`${apiUrl}/api/plugins/*/connections`, async (route) => {
      const body = route.request().postDataJSON() as { values: Json };
      current.saves.push(body);
      current.saved = body.values;
      await fulfill(route, {
        overview: overviewOf(current),
        connection: connection(body.values),
      });
    });
  },
);

When(
  "I add a connection to {string} marked on-premises",
  async ({ page }, address: string) => {
    await page.goto(`/settings/plugins/${plugin.id}`);
    await page
      .getByRole("button", { name: "Add a connection", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Server address" }).fill(address);
    await page.getByRole("switch", { name: "On-premises" }).click();
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
  },
);

Then(
  "the connection was saved on-premises with the address {string}",
  async ({}, address: string) => {
    await expect.poll(() => mock.saves.length).toBe(1);
    expect(mock.saves[0]).toMatchObject({
      values: { serverUrl: address, onPremises: true },
    });
  },
);

When("I edit the saved connection", async ({ page }) => {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
});

Then("{string} is still on", async ({ page }, label: string) => {
  await expect(page.getByRole("switch", { name: label })).toBeChecked();
});
