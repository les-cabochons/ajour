import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

function sidebarTitles(page: Page) {
  // Comfortable rows also show the project name, so read the title alone.
  return sidebar(page).locator("[data-backlog-item-id] [data-row-title]");
}

function sidebarRow(page: Page, title: string) {
  return sidebar(page).locator("[data-backlog-item-id]", {
    has: page.locator("[data-row-title]", { hasText: title }),
  });
}

Given("I have backlog items with priorities", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/api/connectors", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: false,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.addInitScript(() => {
    if (sessionStorage.getItem("sidebar-ordering-fixture")) return;
    localStorage.clear();
    sessionStorage.setItem("sidebar-ordering-fixture", "true");
    const item = (_id: string, title: string, priority?: number) => ({
      _id,
      title,
      priority,
      source: "manual",
      status: "active",
      createdAt: Date.now(),
    });
    // The custom order is the stored order. By priority, Urgent (1) is first.
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        backlogSortMode: "custom",
        workItems: [
          item("search", "Sidebar search", 3),
          item("backup", "Backup pipeline", 1),
          item("note", "Loose note"),
        ],
      }),
    );
  });
});

When(
  "I drag the sidebar row {string} above {string}",
  async ({ page }, dragged: string, target: string) => {
    const from = await sidebarRow(page, dragged).boundingBox();
    const to = await sidebarRow(page, target).boundingBox();
    if (!from || !to) throw new Error("A sidebar row is not rendered");
    await page.mouse.move(from.x + from.width / 3, from.y + from.height / 2);
    await page.mouse.down();
    // Above the target's middle drops the row in front of it.
    await page.mouse.move(to.x + to.width / 3, to.y + 4, { steps: 10 });
    await page.mouse.up();
  },
);

When(
  "I press Alt+Down on the sidebar row {string}",
  async ({ page }, title: string) => {
    const row = sidebarRow(page, title);
    await row.focus();
    await row.press("Alt+ArrowDown");
  },
);

Then(/^the sidebar reads (.+)$/, async ({ page }, list: string) => {
  const expected = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  await expect(sidebarTitles(page)).toHaveText(expected);
});

Then("the sidebar row {string} has focus", async ({ page }, title: string) => {
  await expect(sidebarRow(page, title)).toBeFocused();
});

When("I order the sidebar by {string}", async ({ page }, label: string) => {
  await sidebar(page).getByRole("button", { name: "Filter and order" }).click();
  const toggle = page.getByRole("button", { name: `${label} order` });
  await toggle.click();
  // The menu stays open, so the pick shows as pressed. Escape closes it.
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
});
