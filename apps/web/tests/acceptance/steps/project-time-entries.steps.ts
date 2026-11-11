import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

const STATE_KEY = "ajour.local-state.v2";

// Adds entries to the saved Atlas workspace. "I open the Atlas project page"
// loads the page again, and the app reads them from storage then.
Given(
  "Atlas has {int} entries a day for {int} days",
  async ({ page }, perDay: number, dayCount: number) => {
    await page.evaluate(
      ({ key, perDay, dayCount }) => {
        const state = JSON.parse(localStorage.getItem(key)!) as {
          timesheetEntries?: unknown[];
        };
        const entries = [];
        for (let day = 0; day < dayCount; day += 1) {
          const localDate = new Date(Date.UTC(2026, 9, 1 + day))
            .toISOString()
            .slice(0, 10);
          for (let index = 0; index < perDay; index += 1) {
            entries.push({
              _id: `atlas-${localDate}-${index}`,
              localDate,
              projectId: "p-atlas",
              taskId: "t-build",
              label: "",
              note: `Build ${localDate} #${index + 1}`,
              durationMs: 30 * 60_000,
              sourceBlockIds: [],
              committedAt: 1,
            });
          }
        }
        state.timesheetEntries = [
          ...(state.timesheetEntries ?? []),
          ...entries,
        ];
        localStorage.setItem(key, JSON.stringify(state));
      },
      { key: STATE_KEY, perDay, dayCount },
    );
  },
);

When("I open the Time entries tab", async ({ page }) => {
  await page.getByRole("tab", { name: /^Time entries/ }).click();
});

When("I press Show more", async ({ page }) => {
  await page.getByRole("button", { name: "Show more", exact: true }).click();
});

Then(
  "the tab lists {int} entries over {int} days",
  async ({ page }, entryCount: number, dayCount: number) => {
    const panel = page.getByRole("tabpanel");
    await expect(panel.locator(".project-entry-row")).toHaveCount(entryCount);
    await expect(panel.locator(".project-entry-rows")).toHaveCount(dayCount);
  },
);

Then("there is no Show more", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Show more", exact: true }),
  ).toHaveCount(0);
});
