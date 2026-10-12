import { createRequire } from "node:module";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { PluginCatalogEntry } from "@ajour/shared";

const { Given, When, Then } = createBdd();
const { BUILT_IN_PLUGIN_CATALOG_ENTRIES: builtInEntries } = createRequire(
  import.meta.url,
)("../../../../desktop/electron/plugin-catalog-seed.cjs") as {
  BUILT_IN_PLUGIN_CATALOG_ENTRIES: PluginCatalogEntry[];
};

Given(
  "the catalog contains a plugin with connector and code host capabilities",
  async ({ page }) => {
    const entries: PluginCatalogEntry[] = [
      ...builtInEntries,
      {
        ...builtInEntries[0]!,
        id: "combined",
        title: "Combined plugin",
        capabilities: ["connector", "codeHost"],
        features: ["work-item-sync", "pull-requests"],
      },
    ];
    await page.addInitScript((catalogEntries) => {
      window.ajourDesktop = {
        bootstrapLocalState: null,
        runtime: {
          automaticUpdatesEnabled: false,
          developmentBuild: false,
          platform: "win32",
          version: "0.1.0",
        },
        getPluginCatalog: async () => ({
          entries: catalogEntries,
          source: "cache",
          checkedAt: "2026-10-12T00:00:00Z",
        }),
        downloadCatalogPlugin: async () => {
          throw new Error("This scenario must not download a package.");
        },
      };
    }, entries);
  },
);

When(
  "I open the catalog at {int} pixels wide",
  async ({ page }, width: number) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/settings/plugins");
  },
);

Then("all four plugin filters fit inside the viewport", async ({ page }) => {
  for (const name of ["All", "Connectors", "Code hosts", "Schemas"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.screenshot({
    path: `test-results/catalog-${page.viewportSize()!.width}.png`,
  });
});

When("I select the {string} plugin filter", async ({ page }, name: string) => {
  await page.getByRole("tab", { name, exact: true }).click();
});

Then(
  "the combined plugin appears with its connector and code host badge",
  async ({ page }) => {
    const entry = page.getByRole("link", {
      name: "View Combined plugin",
      exact: true,
    });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("Connector · Code host");
  },
);

Then("the GitHub catalog entry is hidden", async ({ page }) => {
  await expect(
    page.getByRole("link", { name: "View GitHub", exact: true }),
  ).toHaveCount(0);
});

Then("the GitHub catalog entry offers a download", async ({ page }) => {
  const entry = page.getByRole("link", { name: "View GitHub", exact: true });
  await expect(entry).toBeVisible();
  await expect(
    entry
      .locator("..")
      .getByRole("button", { name: "Download GitHub", exact: true }),
  ).toBeEnabled();
});

Then("the Workday schema is the only catalog entry", async ({ page }) => {
  await expect(page.getByRole("link", { name: /^View / })).toHaveText(
    /Workday schema/,
  );
});
