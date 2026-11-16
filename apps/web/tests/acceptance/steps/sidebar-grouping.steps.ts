import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

/** A project's section: its header button, then its rows. */
function section(page: Page, name: string) {
  return sidebar(page).getByRole("region", { name, exact: true });
}

function projectSections(page: Page) {
  return sidebar(page).locator("section:has(> button[aria-expanded])");
}

function quotedList(list: string) {
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

Given("I have backlog items across projects and none", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
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
    if (sessionStorage.getItem("sidebar-grouping-fixture")) return;
    localStorage.clear();
    sessionStorage.setItem("sidebar-grouping-fixture", "true");
    const project = (_id: string, name: string, color: string) => ({
      _id,
      name,
      status: "active",
      color,
      tasks: [],
    });
    const item = (
      _id: string,
      title: string,
      extra: Record<string, unknown> = {},
    ) => ({
      _id,
      title,
      source: "manual",
      status: "active",
      createdAt: Date.now(),
      ...extra,
    });
    // The custom order is the stored order. Harbor's pinned item leads the
    // list, so Harbor comes first; Atlas follows its first item.
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        backlogSortMode: "custom",
        projects: [
          project("atlas", "Atlas", "#2563eb"),
          project("harbor", "Harbor", "#d97706"),
        ],
        workItems: [
          item("atlas-export", "Atlas export", {
            projectId: "atlas",
            remainingEstimateHours: 1.5,
          }),
          item("loose", "Loose note"),
          item("harbor-sync", "Harbor sync", { projectId: "harbor" }),
          item("atlas-grid", "Atlas grid", {
            projectId: "atlas",
            remainingEstimateHours: 2,
          }),
          item("harbor-pinned", "Harbor pinned", {
            projectId: "harbor",
            pinnedAt: 1,
          }),
        ],
      }),
    );
  });
});

When("I group the sidebar by project in Settings", async ({ page }) => {
  await sidebar(page)
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Sidebar grouping" })
    .getByRole("button", { name: "By project", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("navigation", { name: "Settings sections" }),
  ).toHaveCount(0);
});

When("I collapse the section {string}", async ({ page }, name: string) => {
  const header = section(page, name).locator("> button[aria-expanded]");
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
});

Then("the sidebar shows no project sections", async ({ page }) => {
  await expect(sidebar(page).locator("[data-backlog-item-id]")).toHaveCount(5);
  await expect(projectSections(page)).toHaveCount(0);
});

Then(/^the sidebar sections read (.+)$/, async ({ page }, list: string) => {
  await expect
    .poll(() =>
      projectSections(page).evaluateAll((sections) =>
        sections.map((element) => element.getAttribute("aria-label")),
      ),
    )
    .toEqual(quotedList(list));
});

Then(
  "the section {string} totals {string}",
  async ({ page }, name: string, total: string) => {
    await expect(
      section(page, name).locator("> button[aria-expanded]"),
    ).toContainText(total);
  },
);

Then(
  /^the section "([^"]+)" lists (.+)$/,
  async ({ page }, name: string, list: string) => {
    const titles = section(page, name).locator(
      "[data-backlog-item-id] [data-row-title]",
    );
    if (list === "nothing") {
      await expect(section(page, name)).toBeVisible();
      await expect(titles).toHaveCount(0);
      return;
    }
    await expect(titles).toHaveText(quotedList(list));
  },
);
