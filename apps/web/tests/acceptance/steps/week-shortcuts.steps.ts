import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { timeEntryEditor } from "../../fixtures/time-entry-editor";

const { When, Then } = createBdd();

function weekGridCell(page: Page, task: string, day: string) {
  return page
    .getByRole("region", { name: "Week" })
    .getByRole("button", { name: new RegExp(`^${task}, ${day},`) });
}

const gridCellInput = (page: Page, task: string, day: string) =>
  page.getByLabel(`Hours for ${task} on ${day}`, { exact: true });

function daysCard(page: Page, day: string, text: string) {
  return page
    .getByRole("region", { name: new RegExp(`^${day},`) })
    .locator(".weekly-entry-card", { hasText: text });
}

/** Writes `text` on the system clipboard, as another app would. */
async function putOnClipboard(page: Page, text: string) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
}

async function pressModified(page: Page, key: string) {
  const isMac = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.userAgent),
  );
  await page.keyboard.press(`${isMac ? "Meta" : "Control"}+${key}`);
}

When("I press the labeled Commit week button", async ({ page }) => {
  // The sidebar foot's icon has the same name; this one shows its words.
  await page
    .getByRole("button", { name: "Commit week" })
    .filter({ hasText: "Commit week" })
    .click();
});

When(
  "I copy the {string} cell on {word}",
  async ({ page }, task: string, day: string) => {
    await putOnClipboard(page, "before");
    await weekGridCell(page, task, day).focus();
    await pressModified(page, "c");
  },
);

When(
  "I paste {string} on the {string} cell on {word}",
  async ({ page }, text: string, task: string, day: string) => {
    await putOnClipboard(page, text);
    await weekGridCell(page, task, day).focus();
    await pressModified(page, "v");
  },
);

When(
  "I open the {string} cell on {word} in the side panel",
  async ({ page }, task: string, day: string) => {
    await weekGridCell(page, task, day).click();
    await expect(timeEntryEditor(page)).toBeVisible();
  },
);

When(
  "I change the side panel's note to {string}",
  async ({ page }, note: string) => {
    await timeEntryEditor(page).getByLabel("Note", { exact: true }).fill(note);
  },
);

When(
  "I type {string} in the side panel's Hours",
  async ({ page }, hours: string) => {
    await timeEntryEditor(page)
      .getByRole("textbox", { name: "Hours", exact: true })
      .fill(hours);
  },
);

Then(
  "the side panel still has the Hours {string}",
  async ({ page }, hours: string) => {
    await expect(
      timeEntryEditor(page).getByRole("textbox", {
        name: "Hours",
        exact: true,
      }),
    ).toHaveValue(hours);
  },
);

Then(
  "the entry {string} holds {word} with the note {string}",
  async ({ page }, entryId: string, hours: string, note: string) => {
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const state = JSON.parse(
            localStorage.getItem("ajour.local-state.v2") ?? "{}",
          );
          const entry = state.timesheetEntries?.find(
            (candidate: { _id: string }) => candidate._id === id,
          );
          if (!entry) return null;
          const minutes = Math.round(entry.durationMs / 60_000);
          return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} ${entry.note}`;
        }, entryId),
      )
      .toBe(`${hours} ${note}`);
  },
);

When(
  "I type {string} in the {string} cell on {word} and paste {string}",
  async ({ page }, typed: string, task: string, day: string, text: string) => {
    await putOnClipboard(page, text.replace(/\\n/g, "\n"));
    await weekGridCell(page, task, day).focus();
    await page.keyboard.type(typed);
    await expect(gridCellInput(page, task, day)).toBeFocused();
    await pressModified(page, "v");
  },
);

Then(
  "the {string} cell on {word} holds {string}",
  async ({ page }, task: string, day: string, text: string) => {
    await expect(gridCellInput(page, task, day)).toHaveValue(text);
  },
);

When(
  "I type {string} on the {string} cell on {word}",
  async ({ page }, typed: string, task: string, day: string) => {
    await weekGridCell(page, task, day).focus();
    await page.keyboard.type(typed);
  },
);

Then(
  "the {string} cell on {word} explains {string}",
  async ({ page }, task: string, day: string, message: string) => {
    const cell = page
      .getByRole("region", { name: "Week" })
      .getByRole("cell")
      .filter({
        has: page.getByRole("button", {
          name: new RegExp(`^${task}, ${day},`),
        }),
      });
    await expect(cell.getByRole("status")).toContainText(message);
    // Focus stays on the cell, so Enter opens the entries too.
    await expect(weekGridCell(page, task, day)).toBeFocused();
  },
);

When("I press {string} under the cell", async ({ page }, label: string) => {
  await page
    .getByRole("region", { name: "Week" })
    .getByRole("status")
    .getByRole("button", { name: label })
    .click();
});

Then(
  "the side panel lists the cell's {int} entries",
  async ({ page }, count: number) => {
    const panel = page.getByRole("complementary", { name: "Cell entries" });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /^\S.* \d+:\d{2}$/ }),
    ).toHaveCount(count);
  },
);

When("I open the Week Grid of the week after", async ({ page }) => {
  await page.goto("/time/2026-10-12?view=week");
  await expect(
    page.getByRole("button", { name: "Add row", exact: true }),
  ).toBeVisible();
});

Then(
  "the Grid has the rows {string} and {string} with no time",
  async ({ page }, first: string, second: string) => {
    for (const task of [first, second]) {
      await expect(weekGridCell(page, task, "Monday")).toHaveAccessibleName(
        `${task}, Monday, no time`,
      );
    }
    await expect(
      page.locator(".weekly-grid-footer-row .weekly-grid-total-cell"),
    ).toHaveText("0:00");
  },
);

When("I open the Week Days", async ({ page }) => {
  await page.goto("/time/2026-10-05?view=week");
  await page.getByRole("button", { name: "Days", exact: true }).click();
  await expect(daysCard(page, "Monday", "Login form")).toBeVisible();
});

Then(
  "{word}'s {string} card shows {string}",
  async ({ page }, day: string, text: string, hours: string) => {
    await expect(
      daysCard(page, day, text).locator(".weekly-entry-card-project strong"),
    ).toHaveText(hours);
    await expect(timeEntryEditor(page)).toHaveCount(0);
  },
);

When("I open the Commit page for this week", async ({ page }) => {
  await page.goto("/time/today/commit");
});

Then("the Commit page notes {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then(
  "the Commit page opens for the week of {word}",
  async ({ page }, weekOf: string) => {
    await expect(page).toHaveURL(new RegExp(`/time/${weekOf}/commit`));
    await expect(
      page.getByText("Commit week of October 5–11", { exact: true }),
    ).toBeVisible();
  },
);

const cardHours = (page: Page, day: string, text: string) =>
  daysCard(page, day, text).getByRole("textbox", { name: /^Hours for / });

Then(
  "{word}'s {string} card says {string}",
  async ({ page }, day: string, text: string, message: string) => {
    const input = cardHours(page, day, text);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(message);
  },
);

Then(
  "{word}'s {string} card holds {string} and says {string}",
  async (
    { page },
    day: string,
    text: string,
    hours: string,
    message: string,
  ) => {
    // Focus goes back to the card's hours, which keep what was typed.
    const input = cardHours(page, day, text);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(hours);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(message);
  },
);

When(
  "I focus {word}'s {string} card and type {string}",
  async ({ page }, day: string, text: string, typed: string) => {
    await daysCard(page, day, text).focus();
    await page.keyboard.type(typed);
  },
);

Then(
  "{word}'s {string} card is being edited",
  async ({ page }, day: string, text: string) => {
    await expect(cardHours(page, day, text)).toBeFocused();
  },
);
