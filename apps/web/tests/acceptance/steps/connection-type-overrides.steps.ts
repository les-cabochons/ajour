import { expect, type Route } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const ICON =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>";

// Connection fields by item type (#847), against a local API that answers
// from memory: it records each save and reads the saved values back, as the
// real one does. The types come from the synced items in the local state.

type Json = Record<string, unknown>;

interface TypeOverridesMock {
  saves: Array<{ values: Json }>;
  saved: Json;
}

let mock: TypeOverridesMock;

/** A backlog plugin whose estimate fields an item type may replace. */
const plugin = {
  id: "tracker",
  displayName: "Tracker",
  version: "1.0.0",
  apiVersion: 4,
  description: "A backlog with item types.",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [
    { id: "label", label: "Connection label", type: "text", required: true },
    { id: "tenantLabel", label: "Tenant", type: "text", required: true },
    {
      id: "originalEstimateFieldName",
      label: "Original estimate field",
      type: "text",
    },
    {
      id: "remainingEstimateFieldName",
      label: "Remaining field",
      type: "text",
    },
    {
      id: "estimateFieldsByType",
      label: "By work item type",
      type: "typeOverrides",
      overrides: ["originalEstimateFieldName", "remainingEstimateFieldName"],
    },
  ],
};

function connection(values: Json) {
  return {
    id: "contoso",
    pluginId: plugin.id,
    label: "Contoso",
    tenantLabel: "Contoso",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: values,
  };
}

function overviewOf(current: TypeOverridesMock) {
  return {
    vault: { state: "available" },
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      { plugin, enabled: true, connections: [connection(current.saved)] },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

async function fulfill(route: Route, json: unknown) {
  await route.fulfill({ status: 200, json, headers: cors });
}

const syncedItem = (id: string, type: string) => ({
  _id: id,
  title: `${type} ${id}`,
  source: plugin.id,
  sourceId: id,
  sourceConnectionId: "contoso",
  sourceWorkItemType: type,
  status: "active",
  createdAt: 1,
});

Given(
  "a connection whose synced items are 2 Tasks and a Bug",
  async ({ page }) => {
    mock = {
      saves: [],
      saved: {
        label: "Contoso",
        tenantLabel: "Contoso",
        originalEstimateFieldName: "Effort",
        remainingEstimateFieldName: "Remaining Work",
        estimateFieldsByType: "",
      },
    };
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
    await page.addInitScript(
      (workItems) => {
        if (sessionStorage.getItem("type-overrides-fixture")) return;
        localStorage.clear();
        sessionStorage.setItem("type-overrides-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({ workItems }),
        );
      },
      [
        syncedItem("1", "Task"),
        syncedItem("2", "Task"),
        syncedItem("3", "Bug"),
      ],
    );
    await page.goto(`/settings/plugins/${plugin.id}`);
  },
);

When("I edit the connection", async ({ page }) => {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
});

Then(
  "the rows by item type are {string} and {string}",
  async ({ page }, first: string, second: string) => {
    const section = page.getByRole("region", { name: "By work item type" });
    await expect(
      section.getByRole("group").and(section.locator("fieldset")),
    ).toHaveCount(2);
    await expect(section.getByRole("group").nth(0)).toHaveAccessibleName(first);
    await expect(section.getByRole("group").nth(1)).toHaveAccessibleName(
      second,
    );
  },
);

When(
  "I set {string} of {string} to {string}",
  async ({ page }, field: string, row: string, text: string) => {
    await page
      .getByRole("group", { name: row, exact: true })
      .getByRole("textbox", { name: field, exact: true })
      .fill(text);
  },
);

When("I add the type {string}", async ({ page }, name: string) => {
  await page.getByRole("button", { name: "Add a type", exact: true }).click();
  await page.getByRole("textbox", { name: "New type name" }).fill(name);
  await page.getByRole("textbox", { name: "New type name" }).press("Enter");
});

When("I save the connection", async ({ page }) => {
  await page
    .getByRole("button", { name: "Update connection", exact: true })
    .click();
});

Then(
  "the connection was saved with the overrides {string}",
  async ({}, text: string) => {
    await expect.poll(() => mock.saves.length).toBe(1);
    expect(mock.saves[0]?.values.estimateFieldsByType).toBe(text);
  },
);

Then(
  "{string} of {string} shows {string}",
  async ({ page }, field: string, row: string, text: string) => {
    await expect(
      page
        .getByRole("group", { name: row, exact: true })
        .getByRole("textbox", { name: field, exact: true }),
    ).toHaveValue(text);
  },
);
