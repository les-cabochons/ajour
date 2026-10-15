import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();

const ALL_TITLES = ["Sidebar search", "Backup pipeline", "Loose note"];

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

function sidebarTitles(page: Page) {
  return sidebar(page).locator("[data-backlog-item-id]");
}

Given("I have backlog items in two projects", async ({ page }) => {
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
    if (sessionStorage.getItem("sidebar-search-fixture")) return;
    localStorage.clear();
    sessionStorage.setItem("sidebar-search-fixture", "true");
    const project = (_id: string, name: string) => ({
      _id,
      name,
      status: "active",
      color: "#059669",
      tasks: [],
    });
    const item = (_id: string, title: string, projectId?: string) => ({
      _id,
      title,
      projectId,
      source: "manual",
      status: "active",
      createdAt: Date.now(),
    });
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        projects: [project("ajour", "Ajour"), project("rideau", "Rideau")],
        workItems: [
          item("search", "Sidebar search", "ajour"),
          item("backup", "Backup pipeline", "rideau"),
          item("note", "Loose note"),
        ],
      }),
    );
  });
});

When("I search the sidebar for {string}", async ({ page }, query: string) => {
  const box = sidebar(page).getByRole("searchbox", {
    name: "Search the sidebar",
  });
  if (!(await box.isVisible())) {
    await sidebar(page)
      .getByRole("button", { name: "Search", exact: true })
      .click();
  }
  await box.fill(query);
});

When("I press Escape in the sidebar search", async ({ page }) => {
  await sidebar(page)
    .getByRole("searchbox", { name: "Search the sidebar" })
    .press("Escape");
});

When(
  "I filter the sidebar to the {string} project",
  async ({ page }, name: string) => {
    await sidebar(page)
      .getByRole("button", { name: "Filter by project" })
      .click();
    await page.getByRole("option", { name }).click();
  },
);

When("I filter the sidebar to all projects", async ({ page }) => {
  await sidebar(page)
    .getByRole("button", { name: /^Filtered to / })
    .click();
  await page.getByRole("option", { name: "All projects" }).click();
});

Then("the sidebar lists only {string}", async ({ page }, title: string) => {
  await expect(sidebarTitles(page)).toHaveText([title]);
});

Then("the sidebar lists every backlog item", async ({ page }) => {
  // The sidebar follows the Backlog page's order, which this test leaves alone.
  await expect(sidebarTitles(page)).toHaveCount(ALL_TITLES.length);
  for (const title of ALL_TITLES) {
    await expect(sidebarTitles(page).filter({ hasText: title })).toHaveCount(1);
  }
});

Then("the sidebar Search button has focus", async ({ page }) => {
  await expect(
    sidebar(page).getByRole("button", { name: "Search", exact: true }),
  ).toBeFocused();
});
