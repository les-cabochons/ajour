import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { activeViewLink, viewSlug } from "../../fixtures/sidebar";
const { When, Then } = createBdd();

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

function backLink(page: Page) {
  return page.getByRole("link", { name: /^Back to / });
}

When("I open the Time week view", async ({ page }) => {
  await page.goto("/time/2026-10-14?view=week");
});

When("I open the Projects page", async ({ page }) => {
  await page.goto("/projects");
});

Then("the sidebar nav marks {string}", async ({ page }, view: string) => {
  await expect(activeViewLink(page)).toHaveAttribute(
    "data-view",
    viewSlug(view),
  );
});

Then("the item page offers {string}", async ({ page }, label: string) => {
  await expect(backLink(page)).toHaveText(label);
});

When("I follow the item page's back link", async ({ page }) => {
  await backLink(page).click();
});

Then("the Time week view is open", async ({ page }) => {
  await expect(page).toHaveURL(/\/time\/2026-10-14\?view=week$/);
});

Then("the Projects page is open", async ({ page }) => {
  await expect(page).toHaveURL(/\/projects$/);
});
