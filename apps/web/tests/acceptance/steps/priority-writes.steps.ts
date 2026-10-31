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
    await cachePluginList(page);
  },
);

Given(
  "editing work items is off on the synced item's connection",
  async ({ page }) => {
    // The newest route wins: the connection now refuses every write.
    await page.route("**/connections/fixture/settle", (route) =>
      route.fulfill({
        status: 403,
        headers: { "access-control-allow-origin": "*" },
        json: {
          error: "Editing work items is off.",
          reason: "access_off",
          access: "editWorkItems",
        },
      }),
    );
  },
);

Given(
  "a manual item {string} with High priority too",
  async ({ page }, title: string) => {
    await page.evaluate((title) => {
      const key = "ajour.local-state.v2";
      const state = JSON.parse(localStorage.getItem(key)!);
      state.workItems.push({
        _id: "manual-high-item",
        title,
        source: "manual",
        status: "active",
        priority: 2,
        createdAt: 2,
      });
      localStorage.setItem(key, JSON.stringify(state));
    }, title);
    await page.reload();
    await cachePluginList(page);
  },
);

/** The plugin list is cached before an action asks whether it can write. */
async function cachePluginList(page: Page) {
  await page.evaluate(async () => {
    const { getPluginsOverview } = await import(
      /* @vite-ignore */ "/src/lib/app-api.ts"
    );
    await getPluginsOverview();
  });
}

/** Opens the Backlog page's editor on the synced item, from its "…" menu. */
async function openEditor(page: Page) {
  await page.goto("/backlog");
  await cachePluginList(page);
  // The row shows its "…" button on hover.
  const row = page.locator(`main [data-work-item-id="${ITEM_ID}"]`);
  await row.hover();
  await row.getByRole("button", { name: `Actions for ${ITEM_TITLE}` }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.getByLabel("Backlog item editor");
  await editor.getByRole("combobox", { name: "Priority" }).click();
  return editor;
}

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

When(
  "I change the synced item's priority to {string} in the editor and save",
  async ({ page }, level: string) => {
    const editor = await openEditor(page);
    await page.getByRole("option", { name: level, exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
  },
);

When(
  "I open the priority field of the synced item's editor",
  async ({ page }) => {
    await openEditor(page);
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
  "the item's source received priority {string} and no state at once",
  async ({}, priority: string) => {
    // Well before an Undo window would have closed.
    await expect
      .poll(() => written, { timeout: 3_000 })
      .toEqual([{ sourceId: "source-item", priority }]);
  },
);

Then("no Undo toast showed", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0);
});

Then("the change is held on this computer", async ({ page }) => {
  await expect(
    page.getByText("Held on this computer: editing work items is off", {
      exact: false,
    }),
  ).toBeVisible();
});

Then(
  "Sync review lists the synced item's held change as {string}",
  async ({ page }, detail: string) => {
    await page.goto("/settings/sync-review");
    const change = page
      .getByRole("region", { name: "Held changes" })
      .locator("[data-held-edit]")
      .filter({ hasText: ITEM_TITLE });
    await expect(change).toContainText("Settle or move");
    await expect(change).toContainText(detail);
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
  "the editor's {string} is disabled with the reason {string}",
  async ({ page }, name: string, reason: string) => {
    const option = page.getByRole("option", { name, exact: true });
    await expect(option).toHaveAttribute("aria-disabled", "true");
    await expect(option).toHaveAttribute("aria-description", reason);
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
