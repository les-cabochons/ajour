import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Then } = createBdd();

function weekSummary(page: Page) {
  return page.getByRole("region", { name: "Week summary" });
}

Then("the pace check says {string}", async ({ page }, text: string) => {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(text);
});

Then("the Commit page shows the week is submitted", async ({ page }) => {
  await expect(
    weekSummary(page).getByText("Submitted", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reopen week", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit week", exact: true }),
  ).toHaveCount(0);
});

Then("the Commit page shows the week is not submitted", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Submit week", exact: true }),
  ).toBeVisible();
  await expect(
    weekSummary(page).getByText("Submitted", { exact: true }),
  ).toHaveCount(0);
});
