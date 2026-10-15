import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
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

Then(
  "the sidebar view switcher shows {string}",
  async ({ page }, view: string) => {
    // The switcher's trigger is named after the view it shows.
    await expect(
      sidebar(page).getByRole("button", { name: view, exact: true }),
    ).toBeVisible();
  },
);

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
