import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

/*
 * A settle or a snooze on the item page opens the next item (#488). The
 * backlog view fixture lists Backlog parent, Backlog subitem and Other
 * backlog item, in that order.
 */

const headerButton = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Item actions" })
    .getByRole("button", { name, exact: true });

const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Primary navigation" });

When(
  "I settle the open item from its page header with its subitems",
  async ({ page }) => {
    await headerButton(page, "Settle").click();
    const choice = page.getByRole("dialog", { name: /^Also settle/ });
    await choice.getByRole("button", { name: /^Include subitem/ }).click();
    await expect(choice).toHaveCount(0);
  },
);

When("I press B on the item page", async ({ page }) => {
  await page.locator(".backlog-item-page").focus();
  await page.keyboard.press("b");
});

When(
  "I open the settle dialog from its page header and cancel it",
  async ({ page }) => {
    await headerButton(page, "Settle").click();
    const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  },
);

When("I settle the other item from its sidebar row", async ({ page }) => {
  const row = sidebar(page).locator('[data-backlog-item-id="other"]');
  await row.hover();
  await row.getByRole("button", { name: "Settle", exact: true }).click();
  await expect(row).toHaveCount(0);
});

Then("the item page shows {string}", async ({ page }, title: string) => {
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
});

Then("the sidebar lists {string} again", async ({ page }, title: string) => {
  await expect(
    sidebar(page).locator("[data-row-title]").filter({ hasText: title }),
  ).toHaveCount(1);
});
