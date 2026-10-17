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

const lockReason = "The week of Oct 5 is submitted. Reopen it to change it.";

Then("the entry editor is read-only", async ({ page }) => {
  const editor = page.getByRole("complementary", { name: "Time entry editor" });
  await expect(editor.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(editor.getByText(lockReason)).toBeVisible();
  await expect(editor.getByLabel("Note")).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
});

Then(
  "{string} is disabled in the menu with the reason {string}",
  async ({ page }, label: string, reason: string) => {
    const item = page
      .getByRole("menu")
      .getByRole("menuitem")
      .filter({ hasText: label });
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toContainText(reason);
  },
);

Then("the Week view shows the week is submitted", async ({ page }) => {
  const week = page.getByRole("region", { name: "Week", exact: true });
  await expect(week.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(
    week.getByRole("button", { name: "Add", exact: true }).first(),
  ).toBeDisabled();
});

Then(
  "a toast shows the whole sentence {string}",
  async ({ page }, sentence: string) => {
    const title = page
      .getByRole("region", { name: "Notifications" })
      .getByText(sentence, { exact: true });
    await expect(title).toBeVisible();
    // A truncated title is wider inside than its box.
    expect(
      await title.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  },
);
