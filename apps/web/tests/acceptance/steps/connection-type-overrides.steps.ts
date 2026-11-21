import { expect, type Page, type Route } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  describeExampleItemTypes,
  exampleTrackerManifest,
} from "../../../../../packages/example/index.ts";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const ICON =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>";

// Connection fields by item type (#847, #848), against a local API that
// answers from memory: it records each save and reads the saved values back,
// as the real one does. The types come from the synced items in the local
// state. The example tracker's item types lookup answers what the example
// plugin answers, and records each request.

type Json = Record<string, unknown>;

interface TypeOverridesMock {
  saves: Array<{ values: Json }>;
  saved: Json;
  itemTypeRequests: Json[];
  lookupFails: boolean;
}

let mock: TypeOverridesMock;

/** A backlog plugin whose estimate fields an item type may replace, without the lookup. */
const tracker = {
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

/** The example tracker of packages/example, which describes its item types. */
const exampleTracker = {
  ...exampleTrackerManifest,
  connectionFields: exampleTrackerManifest.connectionFields.map((field) => ({
    secret: false,
    ...field,
  })),
};

type Plugin = typeof tracker | typeof exampleTracker;

function connection(plugin: Plugin, values: Json) {
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

function overviewOf(plugin: Plugin, current: TypeOverridesMock) {
  return {
    vault: { state: "available" },
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        connections: [connection(plugin, current.saved)],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, json, headers: cors });
}

const syncedItem = (pluginId: string, id: string, type: string) => ({
  _id: id,
  title: `${type} ${id}`,
  source: pluginId,
  sourceId: `contoso:${id}`,
  sourceConnectionId: "contoso",
  sourceWorkItemType: type,
  status: "active",
  createdAt: 1,
});

/**
 * Opens the plugin's page on a connection that maps Effort and Remaining
 * Work, with synced items of the given types.
 */
async function openPluginPage(page: Page, plugin: Plugin, types: string[]) {
  mock = {
    saves: [],
    saved: {
      label: "Contoso",
      tenantLabel: "Contoso",
      originalEstimateFieldName: "Effort",
      remainingEstimateFieldName: "Remaining Work",
      estimateFieldsByType: "",
    },
    itemTypeRequests: [],
    lookupFails: false,
  };
  const current = mock;
  await page.route(`${apiUrl}/api/plugins`, (route) =>
    fulfill(route, overviewOf(plugin, current)),
  );
  await page.route(`${apiUrl}/api/backlog/imports`, (route) =>
    fulfill(route, { items: [], totalCount: 0, selectedCount: 0 }),
  );
  await page.route(`${apiUrl}/api/plugins/*/connections`, async (route) => {
    const body = route.request().postDataJSON() as { values: Json };
    current.saves.push(body);
    current.saved = body.values;
    await fulfill(route, {
      overview: overviewOf(plugin, current),
      connection: connection(plugin, body.values),
    });
  });
  await page.route(
    `${apiUrl}/api/plugins/*/connections/*/item-types`,
    async (route) => {
      const body = route.request().postDataJSON() as Json;
      current.itemTypeRequests.push(body);
      if (current.lookupFails) {
        await fulfill(route, { error: "The tracker is down." }, 502);
        return;
      }
      await fulfill(
        route,
        await describeExampleItemTypes(
          { id: "contoso", config: {} } as never,
          body as never,
        ),
      );
    },
  );
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
    types.map((type, index) => syncedItem(plugin.id, String(index + 1), type)),
  );
  await page.goto(`/settings/plugins/${plugin.id}`);
}

const row = (page: Page, name: string) =>
  page.getByRole("group", { name, exact: true });

// A chip with the type's fields to suggest is a combobox, one without a textbox.
const chip = (page: Page, field: string, rowName: string) =>
  row(page, rowName).getByLabel(field, { exact: true });

Given(
  "a connection whose synced items are 2 Tasks and a Bug",
  async ({ page }) => {
    await openPluginPage(page, tracker, ["Task", "Task", "Bug"]);
  },
);

Given(
  "an example tracker connection whose synced items are 2 Tasks, a Story, a Bug and a Spike",
  async ({ page }) => {
    await openPluginPage(page, exampleTracker, [
      "Task",
      "Task",
      "Story",
      "Bug",
      "Spike",
    ]);
  },
);

Given("the example tracker can't describe its item types", async () => {
  mock.lookupFails = true;
});

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

Then("Ajour didn't ask the plugin about item types", async () => {
  expect(mock.itemTypeRequests).toEqual([]);
});

When(
  "I set {string} of {string} to {string}",
  async ({ page }, field: string, rowName: string, text: string) => {
    await chip(page, field, rowName).fill(text);
  },
);

When("I add the type {string}", async ({ page }, name: string) => {
  const picker = page.getByRole("combobox", { name: "Add a type" });
  await picker.fill(name);
  await picker.press("Enter");
});

When(
  "I pick the type {string} under Add a type",
  async ({ page }, name: string) => {
    await page.getByRole("combobox", { name: "Add a type" }).click();
    await page.getByRole("option", { name, exact: true }).click();
  },
);

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
  async ({ page }, field: string, rowName: string, text: string) => {
    await expect(chip(page, field, rowName)).toHaveValue(text);
  },
);

Then(
  "{string} says {string}",
  async ({ page }, rowName: string, text: string) => {
    await expect(row(page, rowName).getByText(text)).toBeVisible();
  },
);

Then(
  "{string} of {string} proposes {string}",
  async ({ page }, field: string, rowName: string, text: string) => {
    // Shown in the empty input, dashed, and not in its value.
    await expect(chip(page, field, rowName)).toHaveValue("");
    await expect(chip(page, field, rowName)).toHaveAttribute(
      "placeholder",
      text,
    );
    await expect(
      row(page, rowName).locator(".composer-chip[data-proposed]"),
    ).toHaveCount(1);
  },
);

Then(
  "{string} of {string} reads {string}",
  async ({ page }, field: string, rowName: string, text: string) => {
    await expect(chip(page, field, rowName)).toHaveValue("");
    await expect(chip(page, field, rowName)).toHaveAttribute(
      "placeholder",
      text,
    );
  },
);

When("I use the proposal of {string}", async ({ page }, rowName: string) => {
  await row(page, rowName)
    .getByRole("button", { name: "Use it", exact: true })
    .click();
});

// The icon is an image without a name: the row's legend names the type.
Then("{string} shows its icon", async ({ page }, rowName: string) => {
  await expect(row(page, rowName).locator("img")).toHaveCount(1);
  await expect(row(page, rowName).locator("img")).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml,/,
  );
});

Then("{string} shows no icon", async ({ page }, rowName: string) => {
  await expect(row(page, rowName)).toBeVisible();
  await expect(row(page, rowName).locator("img")).toHaveCount(0);
});

Then(
  "the fields by item type say {string}",
  async ({ page }, text: string) => {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  },
);
