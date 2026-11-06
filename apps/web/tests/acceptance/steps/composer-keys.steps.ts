import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

const newItemComposer = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "New backlog item" });

When(
  "I start a new backlog item {string} with the description {string}",
  async ({ page }, title: string, description: string) => {
    await page
      .getByRole("button", { name: "New backlog item" })
      .first()
      .click();
    await newItemComposer(page).getByLabel("Item").fill(title);
    await newItemComposer(page)
      .getByRole("textbox", { name: "Description" })
      .click();
    await page.keyboard.type(description);
  },
);

When("I press Ctrl+Enter in the new item's description", async ({ page }) => {
  await expect(
    newItemComposer(page).getByRole("textbox", { name: "Description" }),
  ).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
});

Then("the new item composer is closed", async ({ page }) => {
  await expect(newItemComposer(page)).toHaveCount(0);
});

Then("{string} is in the Backlog", async ({ page }, title: string) => {
  await expect(
    page.getByRole("main").getByText(title, { exact: true }),
  ).toBeVisible();
});

When("I open the New project composer", async ({ page }) => {
  await page.getByRole("button", { name: "New project" }).first().click();
  await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
});

Then(
  "its empty Code field shows its {string} placeholder",
  async ({ page }, placeholder: string) => {
    const code = page
      .getByRole("dialog", { name: "New project" })
      .getByRole("textbox", { name: "Code" });
    await expect(code).toHaveAttribute("placeholder", placeholder);
    // Wide enough to show the placeholder, so it reads as a field to fill.
    expect((await code.boundingBox())!.width).toBeGreaterThanOrEqual(24);
  },
);

When(
  "I name the new project {string} and press Ctrl+Enter",
  async ({ page }, name: string) => {
    await page
      .getByRole("dialog", { name: "New project" })
      .getByRole("textbox", { name: "Full name" })
      .fill(name);
    await page.keyboard.press("ControlOrMeta+Enter");
  },
);

Then("the project composer is closed", async ({ page }) => {
  await expect(page.getByRole("dialog", { name: "New project" })).toHaveCount(
    0,
  );
});

When("I type {string} and press Enter", async ({ page }, text: string) => {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
});

Then("Monday's first entry is saved with 0:45 hours", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(
          localStorage.getItem("ajour.local-state.v2") ?? "{}",
        );
        return state.timesheetEntries?.find(
          (entry: { note?: string }) => entry.note === "Login form",
        )?.durationMs;
      }),
    )
    .toBe(45 * 60 * 1000);
});
