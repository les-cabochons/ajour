import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

const ALEX = { id: "alex@contoso.com", displayName: "Alex Trépanier" };
const PEOPLE = [
  ALEX,
  { id: "ana@contoso.com", displayName: "Ana Silva", email: "ana@contoso.com" },
  { id: "bo@contoso.com", displayName: "Bo Chen" },
];

/** The settle writes each page's fixture received, in order. */
const writes = new WeakMap<Page, Array<Record<string, unknown>>>();

async function assigneeFixture(page: Page, assigns: boolean) {
  const plugin = {
    id: "example",
    version: "1.0.0",
    apiVersion: 3,
    displayName: "Fixture source",
    iconSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
    entrypoint: "dist/plugin.js",
    capabilities: { connector: { settle: true, assign: assigns } },
    connectionFields: [
      { id: "url", label: "URL", type: "url", required: true, secret: false },
    ],
  };
  const connection = {
    id: "fixture",
    pluginId: "example",
    label: "Fixture connection",
    tenantLabel: "Fixture tenant",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: {},
  };
  const headers = { "access-control-allow-origin": "*" };
  const sent: Array<Record<string, unknown>> = [];
  writes.set(page, sent);
  await page.route("**/api/plugins", (route) =>
    route.fulfill({
      headers,
      json: {
        pluginsEnabled: true,
        plugins: [plugin],
        connectionGroups: [
          { plugin, enabled: true, connections: [connection] },
        ],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
    }),
  );
  await page.route("**/connections/fixture/settle-states", (route) =>
    route.fulfill({
      headers,
      json: {
        states: [
          { name: "Active", category: "Open", done: false },
          { name: "In review", category: "Open", done: false },
        ],
      },
    }),
  );
  await page.route("**/connections/fixture/assignees", (route) => {
    const { query } = route.request().postDataJSON() as { query: string };
    return route.fulfill({
      headers,
      json: {
        people: PEOPLE.filter((person) =>
          person.displayName.toLowerCase().includes(query.toLowerCase()),
        ),
      },
    });
  });
  await page.route("**/connections/fixture/settle", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ headers, json: {} });
  });
  await page.addInitScript(
    (assignee) => {
      if (sessionStorage.getItem("settle-assignee-fixture")) return;
      localStorage.clear();
      sessionStorage.setItem("settle-assignee-fixture", "true");
      localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({
          workItems: [
            {
              _id: "assign-item",
              title: "Fix login redirect",
              source: "example",
              sourceId: "4821",
              sourceConnectionId: "fixture",
              sourceStatusKey: "active",
              sourceStatusLabel: "Active",
              status: "active",
              priority: 2,
              importedPriority: 2,
              ...(assignee ? { assignee } : {}),
              createdAt: 1,
            },
          ],
        }),
      );
    },
    assigns ? ALEX : null,
  );
  await page.goto("/backlog/assign-item");
  await page.evaluate(async () => {
    const { getPluginsOverview } = await import(
      /* @vite-ignore */ "/src/lib/app-api.ts"
    );
    await getPluginsOverview();
  });
}

const settleDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Settle", exact: true });

async function storedItem(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
      (item: { _id: string }) => item._id === "assign-item",
    ),
  );
}

Given(
  "I have a synced item assigned to Alex Trépanier whose plugin assigns",
  async ({ page }) => assigneeFixture(page, true),
);

Given("I have a synced item whose plugin doesn't assign", async ({ page }) =>
  assigneeFixture(page, false),
);

Given(
  "the assignee fixture refuses the first settle because editing is off",
  async ({ page }) => {
    await page.route(
      "**/connections/fixture/settle",
      (route) => {
        writes.get(page)!.push(route.request().postDataJSON());
        return route.fulfill({
          status: 403,
          headers: { "access-control-allow-origin": "*" },
          json: {
            error: "Editing work items is off.",
            reason: "access_off",
            access: "editWorkItems",
          },
        });
      },
      { times: 1 },
    );
  },
);

Then("no assignee write occurs while Undo is available", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  expect(writes.get(page)).toEqual([]);
});

Then(
  "Sync review lists the held assignee as {string}",
  async ({ page }, detail: string) => {
    await expect
      .poll(async () => (await storedItem(page))?.pendingSourceWrite?.heldAt)
      .toBeTruthy();
    expect(writes.get(page)).toHaveLength(1);
    await page.goto("/settings/sync-review");
    const change = page
      .getByRole("region", { name: "Held changes" })
      .locator('[data-held-edit="settle"]');
    await expect(change).toContainText("Fix login redirect");
    await expect(change.getByText(detail, { exact: true })).toBeVisible();
  },
);

When("I send the held assignee change", async ({ page }) => {
  await page
    .locator('[data-held-edit="settle"]')
    .getByRole("button", { name: "Send", exact: true })
    .click();
});

Then("the next source write assigns {string}", async ({ page }, id: string) => {
  const request = { sourceId: "4821", assignee: id === "null" ? null : id };
  await expect.poll(() => writes.get(page)).toEqual([request, request]);
  await expect(page.locator('[data-held-edit="settle"]')).toHaveCount(0);
});

When("I open Settle on the assignee fixture", async ({ page }) => {
  await page
    .getByRole("group", { name: "Item actions" })
    .getByRole("button", { name: "Settle", exact: true })
    .click();
  await expect(settleDialog(page)).toBeVisible();
  await expect(
    settleDialog(page).getByLabel("State", { exact: true }),
  ).toBeEnabled();
});

Then(
  "the Settle Assignee field shows {string}",
  async ({ page }, name: string) => {
    await expect(
      settleDialog(page).getByRole("combobox", { name: "Assignee" }),
    ).toHaveText(new RegExp(name));
  },
);

When(
  "I pick {string} as the Settle assignee",
  async ({ page }, name: string) => {
    await settleDialog(page)
      .getByRole("combobox", { name: "Assignee" })
      .click();
    if (name !== "Unassigned") {
      await page
        .getByRole("combobox", { name: "Search people" })
        .fill(name.split(" ")[0]!);
    }
    await page.getByRole("option", { name: new RegExp(name) }).click();
    await expect(
      settleDialog(page).getByRole("combobox", { name: "Assignee" }),
    ).toHaveText(new RegExp(name));
  },
);

When("I press Settle in the Settle dialog", async ({ page }) => {
  await settleDialog(page)
    .getByRole("button", { name: "Settle", exact: true })
    .click();
  await expect(settleDialog(page)).toHaveCount(0);
});

Then("the Undo toast says {string}", async ({ page }, title: string) => {
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

When("I press Undo on the settle", async ({ page }) => {
  await page.getByRole("button", { name: "Undo", exact: true }).click();
});

Then(
  "the item shows {string} as its assignee",
  async ({ page }, name: string) => {
    await expect
      .poll(async () => (await storedItem(page))?.assignee?.displayName)
      .toBe(name);
  },
);

Then(
  "the source was asked to assign the item to {string}",
  async ({ page }, id: string) => {
    await expect
      .poll(() => writes.get(page))
      .toEqual([{ sourceId: "4821", assignee: id }]);
  },
);

Then("the source was asked to unassign the item", async ({ page }) => {
  await expect
    .poll(() => writes.get(page))
    .toEqual([{ sourceId: "4821", assignee: null }]);
});

Then("no assignee was sent to the source", async ({ page }) => {
  await page.mouse.move(0, 0);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0, { timeout: 15_000 });
  expect(writes.get(page)).toEqual([]);
});

Then("the Settle dialog has no Assignee field", async ({ page }) => {
  // The form has loaded: its Priority chip shows, which names its field.
  await expect(
    settleDialog(page).getByLabel("Priority", { exact: true }),
  ).toBeVisible();
  await expect(
    settleDialog(page).getByRole("combobox", { name: "Assignee" }),
  ).toHaveCount(0);
});
