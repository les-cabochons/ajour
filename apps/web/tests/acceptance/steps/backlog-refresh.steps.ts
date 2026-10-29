import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { commentsOverview } from "../../fixtures/backlog-comments";
import { syncWithParentDescription } from "../../fixtures/backlog-descriptions";

const { Given, When, Then } = createBdd();
const pending = new WeakMap<Page, () => void>();
const cors = { "access-control-allow-origin": "*" };
async function readySource(page: Page, holdAutomatic = false) {
  const overview = structuredClone(commentsOverview);
  overview.connectionGroups[0]!.plugin.capabilities.connector = {};
  overview.connectionGroups[0]!.connections[0]!.backlogLastSyncAt =
    Date.now() - 120_000;
  await page.route("**/api/plugins", (route) =>
    route.fulfill({ json: overview, headers: cors }),
  );
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    const parent = state.workItems.find(
      (item: { _id: string }) => item._id === "parent",
    );
    Object.assign(parent, {
      source: "example",
      sourceId: "source-parent",
      sourceConnectionId: "fixture",
    });
    localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
  });
  await page.route(
    "**/api/plugins/example/connections/fixture/sync",
    async (route) => {
      const body = route.request().postDataJSON();
      expect(body.refresh).toBe(true);
      const itemPage = new URL(page.url()).pathname.includes("/backlog/parent");
      expect(body.sourceId).toBe(itemPage ? "source-parent" : undefined);
      if (itemPage) expect(body.workItems).toHaveLength(1);
      if (body.trigger === "auto" && !holdAutomatic) {
        const initial = syncWithParentDescription({ text: "Before refresh" });
        initial.connection.backlogLastSyncAt = Date.now();
        await route.fulfill({ json: initial, headers: cors });
        return;
      }
      await new Promise<void>((resolve) => pending.set(page, resolve));
      const result = syncWithParentDescription({
        text: "Fresh description from the source",
      });
      result.items[0]!.title = "Source title after refresh";
      result.connection.backlogLastSyncAt = Date.now();
      await route.fulfill({ json: result, headers: cors });
    },
  );
  await page.reload();
}
Given("a source is ready for a backlog refresh", async ({ page }) => {
  await readySource(page);
});
Given("a source waits while Backlog opens", async ({ page }) => {
  await readySource(page, true);
});
When("I refresh from the backlog freshness control", async ({ page }) => {
  await page
    .getByRole("button", { name: "Refresh backlog", exact: true })
    .click();
});
When("I refresh from the item freshness control", async ({ page }) => {
  await page.getByRole("button", { name: "Refresh item", exact: true }).click();
});
Then(
  "the backlog freshness control shows a small neutral spinning icon and syncing text",
  async ({ page }) => {
    const control = page.locator(".backlog-refresh");
    await expect(control.getByRole("status")).toHaveText("Syncing…");
    await expect(control.getByRole("button")).toBeDisabled();
    const visual = await control.evaluate((el) => {
      const icon = el.querySelector("button svg")!;
      const text = el.querySelector('[role="status"]')!;
      return {
        width: parseFloat(getComputedStyle(icon).width),
        color: getComputedStyle(icon).color,
        textColor: getComputedStyle(text).color,
        animation: getComputedStyle(icon).animationName,
      };
    });
    expect(visual.width).toBe(12);
    expect(visual.color).toBe(visual.textColor);
    expect(visual.animation).toBe("backlog-refresh-spin");
  },
);
Then("the item freshness control shows syncing text", async ({ page }) => {
  await expect(
    page.locator(".backlog-item-page .backlog-refresh").getByRole("status"),
  ).toHaveText("Syncing…");
});
When("the source finishes the backlog refresh", async ({ page }) => {
  await expect.poll(() => pending.has(page)).toBe(true);
  pending.get(page)!();
  await expect(
    page.locator(".backlog-refresh").getByRole("status"),
  ).toContainText("last sync just now");
});
Then(
  "the refreshed source title is visible in the backlog",
  async ({ page }) => {
    await expect(
      page.locator('main [data-backlog-item-id="parent"]').first(),
    ).toContainText("Source title after refresh");
  },
);
Then("the open item shows the refreshed source title", async ({ page }) => {
  await expect(page.locator(".backlog-item-page")).toContainText(
    "Source title after refresh",
  );
});
