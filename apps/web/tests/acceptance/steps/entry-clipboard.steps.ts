import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When, Then } = createBdd();

/** A Day list row, found by its task or note. */
function dayRow(page: Page, text: string) {
  return page.locator(".time-entry-row", { hasText: text });
}

/** A Days column, named like "Monday, October 5". */
function daysColumn(page: Page, day: string) {
  return page.getByRole("region", { name: new RegExp(`^${day},`) });
}

function daysCard(page: Page, day: string, text: string) {
  return daysColumn(page, day).locator(".weekly-entry-card", { hasText: text });
}

/** Matches each item's text to one expected label, so the order reads plainly. */
async function readLabels(
  items: ReturnType<Page["locator"]>,
  labels: string[],
) {
  return (await items.allInnerTexts()).map(
    (text) => labels.find((label) => text.includes(label)) ?? text,
  );
}

function quotedList(list: string) {
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

When("I open Monday's Day list", async ({ page }) => {
  await page.goto("/time/2026-10-05");
  await expect(dayRow(page, "API")).toBeVisible();
});

When("I click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).click();
});

When("I Cmd-click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).click({ modifiers: ["ControlOrMeta"] });
});

When("I Shift-click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).click({ modifiers: ["Shift"] });
});

When("I double-click the {string} entry", async ({ page }, text: string) => {
  await dayRow(page, text).dblclick();
});

Then("only the {string} entry is selected", async ({ page }, text: string) => {
  await expect(dayRow(page, text)).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator(".time-entry-row[aria-selected='true']"),
  ).toHaveCount(1);
});

Then("no entry is selected", async ({ page }) => {
  await expect(dayRow(page, "API")).toBeVisible();
  await expect(
    page.locator(".time-entry-row[aria-selected='true']"),
  ).toHaveCount(0);
});

When("I go to {word} in the day strip", async ({ page }, day: string) => {
  await page
    .getByRole("tab", { name: new RegExp(`^${day.slice(0, 3)}`, "i") })
    .click();
});

Then(/^the Day list reads (.+)$/, async ({ page }, list: string) => {
  const expected = quotedList(list);
  await expect
    .poll(() => readLabels(page.locator(".time-entry-row"), expected))
    .toEqual(expected);
});

Then("a toast says {string}", async ({ page }, title: string) => {
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByText(title),
  ).toBeVisible();
});

When(
  "I click {word}'s {string} card",
  async ({ page }, day: string, text: string) => {
    await daysCard(page, day, text).click();
  },
);

When(
  "I Shift-click {word}'s {string} card",
  async ({ page }, day: string, text: string) => {
    await daysCard(page, day, text).click({ modifiers: ["Shift"] });
  },
);

Then("{int} cards are dimmed as cut", async ({ page }, count: number) => {
  await expect(page.locator(".weekly-entry-card.is-cut")).toHaveCount(count);
});

Then("{word} has no cards", async ({ page }, day: string) => {
  await expect(daysColumn(page, day)).toBeVisible();
  await expect(daysColumn(page, day).locator(".weekly-entry-card")).toHaveCount(
    0,
  );
});

When(
  "I right-click {word}'s column and choose {string}",
  async ({ page }, day: string, item: string) => {
    // The column's empty space, below its "Add" button.
    await daysColumn(page, day)
      .getByRole("group")
      .click({ button: "right", position: { x: 20, y: 200 } });
    await page.getByRole("menuitem", { name: item }).click();
  },
);
