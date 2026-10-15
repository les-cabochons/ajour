import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

Given(
  "I have time logged on working and non-working days",
  async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("capacity-fixture-ready")) return;
      sessionStorage.setItem("capacity-fixture-ready", "true");
      localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({
          projects: [],
          timers: [],
          timesheetEntries: [
            {
              _id: "wednesday-entry",
              localDate: "2026-10-07",
              label: "Capacity test",
              durationMs: 7_200_000,
              sourceBlockIds: [],
              committedAt: 1,
            },
            {
              _id: "saturday-entry",
              localDate: "2026-10-10",
              label: "Capacity test",
              durationMs: 10_800_000,
              sourceBlockIds: [],
              committedAt: 2,
            },
          ],
        }),
      );
    });
  },
);

async function expectWorkingDayStrip(page: Page) {
  const strip = page.getByRole("tablist", { name: "Days of the week" });
  await expect(strip.getByRole("tab")).toHaveCount(5);
  await expect(strip.getByRole("tab").filter({ hasText: "WED" })).toHaveCount(
    0,
  );
  await expect(strip.getByRole("tab").filter({ hasText: "SUN" })).toHaveCount(
    0,
  );
  await expect(strip.getByRole("tab").filter({ hasText: "SAT" })).toBeVisible();
}

When(
  "I enable hiding non-working days with Wednesday off and Saturday working",
  async ({ page }) => {
    await page.goto("/settings/general");
    const toggle = page.getByRole("switch", {
      name: "Hide non-working days",
      exact: true,
    });
    await expect(toggle).not.toBeChecked();
    await page.getByLabel("Wednesday", { exact: true }).fill("0");
    await page.getByLabel("Wednesday", { exact: true }).blur();
    await page.getByLabel("Saturday", { exact: true }).fill("4");
    await page.getByLabel("Saturday", { exact: true }).blur();
    await toggle.check();
    await page.reload();
    await expect(toggle).toBeChecked();
  },
);

Then(
  "the day strip and both Week layouts show only the five working days",
  async ({ page }) => {
    await page.goto("/time/2026-10-05?view=day");
    await expectWorkingDayStrip(page);
    await page.goto("/time/2026-10-05?view=week");
    const headings = page.locator(".weekly-grid-day-column");
    await expect(headings).toHaveCount(5);
    await expect(headings.filter({ hasText: "Wed" })).toHaveCount(0);
    await expect(headings.filter({ hasText: "Sat" })).toHaveCount(1);
    await expect(
      page.locator(".weekly-grid-footer-row .weekly-grid-time-cell"),
    ).toHaveCount(5);
    await expect(
      page.getByRole("button", { name: /^Capacity test, Saturday,/ }),
    ).toHaveText("3:00");
    await expect(
      page.locator(".weekly-grid-footer-row .weekly-grid-total-cell"),
    ).toHaveText("5:00");
    await page.getByRole("button", { name: "Days", exact: true }).click();
    await expect(page.locator(".weekly-days-column")).toHaveCount(5);
    await expect(
      page.getByRole("region", { name: /^Saturday,/ }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: /^Wednesday,/ })).toHaveCount(
      0,
    );
  },
);

Then(
  "the narrow day strip shows only the five working days",
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/time/2026-10-05?view=day");
    await expectWorkingDayStrip(page);
  },
);

When("I disable hiding non-working days", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings/general");
  await page
    .getByRole("switch", { name: "Hide non-working days", exact: true })
    .uncheck();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Hide non-working days", exact: true }),
  ).not.toBeChecked();
});

Then(
  "the day strip and Week grid show all seven days again",
  async ({ page }) => {
    await page.goto("/time/2026-10-05?view=day");
    await expect(
      page.getByRole("tablist", { name: "Days of the week" }).getByRole("tab"),
    ).toHaveCount(7);
    await page.goto("/time/2026-10-05?view=week");
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(page.locator(".weekly-grid-day-column")).toHaveCount(7);
  },
);

When("I set every daily capacity to zero", async ({ page }) => {
  for (const weekday of weekdays) {
    const input = page.getByLabel(weekday, { exact: true });
    await input.fill("0");
    await input.blur();
  }
});

Then("the Week view explains that every day is hidden", async ({ page }) => {
  await page.goto("/time/2026-10-05?view=week");
  await expect(
    page.getByText("All days have 0 hours of capacity.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".weekly-capacity-value.is-summary")).toContainText(
    "5:00",
  );
  await expect(page.locator(".weekly-grid-day-column")).toHaveCount(0);
  await page.goto("/time/2026-10-05?view=day");
  await expect(
    page.getByRole("tablist", { name: "Days of the week" }).getByRole("tab"),
  ).toHaveCount(0);
});
