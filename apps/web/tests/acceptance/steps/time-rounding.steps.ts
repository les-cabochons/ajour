import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

Given(
  "an entry has run for {int} minutes today",
  async ({ page }, minutes: number) => {
    // Runs after the week's seed, once, so later loads keep what the app saved.
    await page.addInitScript(
      (accumulatedDurationMs: number) => {
        if (sessionStorage.getItem("running-entry-ready")) return;
        sessionStorage.setItem("running-entry-ready", "true");
        const state = JSON.parse(
          localStorage.getItem("ajour.local-state.v2") ?? "{}",
        );
        state.timers = [
          {
            _id: "timer-today",
            startedAt: Date.now(),
            localDate: new Intl.DateTimeFormat("en-CA").format(new Date()),
            projectId: "project-atlas",
            taskId: "task-dev",
            note: "Long session",
            accumulatedDurationMs,
          },
        ];
        localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
      },
      minutes * 60 * 1000,
    );
  },
);

When(
  "I pick {string} for Rounding in Settings",
  async ({ page }, rule: string) => {
    await page.goto("/settings/general");
    await page.getByRole("combobox", { name: "Rounding", exact: true }).click();
    await page.getByRole("option", { name: rule, exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Rounding", exact: true }),
    ).toHaveText(rule);
  },
);

Then("Rounding says {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

When("I close Settings", async ({ page }) => {
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

Then(
  "this week's Commit page shows {string} for the added {string}",
  async ({ page }, hours: string, note: string) => {
    const monday = await page.evaluate(() => {
      const date = new Date();
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      return new Intl.DateTimeFormat("en-CA").format(date);
    });
    await page.goto(`/time/${monday}/commit`);
    await expect(
      page
        .getByRole("list", { name: "Changes" })
        .getByRole("listitem", { name: /^Added: / })
        .filter({ hasText: note }),
    ).toContainText(hours);
  },
);
