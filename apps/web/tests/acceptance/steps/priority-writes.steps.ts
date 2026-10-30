import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

/** The settle writes the fixture's plugin received, in order. */
let written: unknown[] = [];

const ITEM_ID = "priority-item";
const ITEM_TITLE = "Prioritized item";

Given(
  "a synced item with High priority whose plugin writes",
  async ({ page }) => {
    written = [];
    const plugin = {
      id: "example",
      version: "1.0.0",
      apiVersion: 3,
      displayName: "Fixture source",
      iconSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
      entrypoint: "dist/plugin.js",
      capabilities: { connector: { settle: true } },
      connectionFields: [
        { id: "url", label: "URL", type: "url", required: true, secret: false },
      ],
    };
    const headers = { "access-control-allow-origin": "*" };
    await page.route("**/api/plugins", (route) =>
      route.fulfill({
        headers,
        json: {
          pluginsEnabled: true,
          plugins: [plugin],
          connectionGroups: [{ plugin, enabled: true, connections: [] }],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
      }),
    );
    await page.route("**/connections/fixture/settle", (route) => {
      written.push(route.request().postDataJSON());
      return route.fulfill({ headers, json: {} });
    });
    await page.addInitScript(
      ({ id, title }) => {
        if (sessionStorage.getItem("priority-writes-fixture")) return;
        localStorage.clear();
        sessionStorage.setItem("priority-writes-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            workItems: [
              {
                _id: id,
                title,
                source: "example",
                sourceId: "source-item",
                sourceConnectionId: "fixture",
                sourceStatusKey: "active",
                sourceStatusLabel: "Active",
                status: "active",
                priority: 2,
                importedPriority: 2,
                createdAt: 1,
              },
            ],
          }),
        );
      },
      { id: ITEM_ID, title: ITEM_TITLE },
    );
    await page.goto(`/backlog/${ITEM_ID}`);
    // The plugin list is cached before a picker asks whether it can write.
    await page.evaluate(async () => {
      const { getPluginsOverview } = await import(
        /* @vite-ignore */ "/src/lib/app-api.ts"
      );
      await getPluginsOverview();
    });
  },
);

/** The item page's properties card holds the full priority picker. */
function priorityPicker(page: Page) {
  return page
    .getByRole("button", { name: `Change priority of ${ITEM_TITLE}` })
    .first();
}

When("I open the synced item's priority picker", async ({ page }) => {
  await priorityPicker(page).click();
});

When(
  "I change the synced item's priority to {string}",
  async ({ page }, level: string) => {
    await priorityPicker(page).click();
    await page.getByRole("menuitem", { name: level, exact: true }).click();
    await expect(page.getByText(`Priority changed to ${level}`)).toBeVisible();
  },
);

Then("nothing was written to the item's source yet", async () => {
  expect(written).toEqual([]);
});

Then(
  "the item's source received priority {string} and no state",
  async ({}, priority: string) => {
    await expect
      .poll(() => written, { timeout: 10_000 })
      .toEqual([{ sourceId: "source-item", priority }]);
  },
);

Then(
  "the synced item's priority is High with no write waiting",
  async ({ page }) => {
    const item = await page.evaluate(
      (id) =>
        JSON.parse(
          localStorage.getItem("ajour.local-state.v2")!,
        ).workItems.find((candidate: { _id: string }) => candidate._id === id),
      ITEM_ID,
    );
    expect(item).toMatchObject({ priority: 2, importedPriority: 2 });
    expect(item.pendingSourceWrite).toBeUndefined();
  },
);

Then(
  "the picker's {string} is disabled with the reason {string}",
  async ({ page }, name: string, reason: string) => {
    const option = page.getByRole("menuitem", { name, exact: true });
    await expect(option).toBeDisabled();
    await expect(option).toHaveAttribute("aria-description", reason);
  },
);
