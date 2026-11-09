import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { timeEntryEditor } from "../../fixtures/time-entry-editor";

const { Given, When, Then } = createBdd();

/** The day list under the Week's entry editor, named by its date. */
function dayList(page: Page, day?: string) {
  return page.getByRole("region", {
    name: day ? `Entries on ${day}` : /^Entries on /,
  });
}

async function readLocalState(page: Page) {
  return page.evaluate(() => {
    const now = new Date();
    return {
      state: JSON.parse(
        window.localStorage.getItem("ajour.local-state.v2") ?? "null",
      ) as {
        timers: { note?: string; localDate: string }[];
        timesheetEntries: { _id: string; note?: string; localDate: string }[];
      },
      today: [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-"),
    };
  });
}

Given(
  "I have an entry logged today with the note {string}",
  async ({ page }, note: string) => {
    await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
      route.fulfill({
        json: {
          pluginsEnabled: true,
          plugins: [],
          connectionGroups: [],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    await page.addInitScript((entryNote) => {
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      window.localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({
          projects: [
            {
              _id: "project-atlas",
              name: "Client Atlas",
              color: "#1f7667",
              icon: { kind: "preset", name: "dot" },
              status: "active",
              tasks: [
                {
                  _id: "task-dev",
                  name: "Development",
                  status: "active",
                  createdAt: 1,
                },
              ],
            },
          ],
          timers: [],
          workItems: [],
          timesheetEntries: [
            {
              _id: "today-entry",
              localDate: today,
              projectId: "project-atlas",
              taskId: "task-dev",
              label: "",
              note: entryNote,
              durationMs: 60 * 60 * 1000,
              sourceBlockIds: [],
              committedAt: 1,
            },
          ],
          updatedAt: 1,
        }),
      );
    }, note);
  },
);

When("I double-click today's card {string}", async ({ page }, text: string) => {
  await page.locator(".weekly-entry-card", { hasText: text }).dblclick();
});

When(
  "I double-click {word}'s {string} card",
  async ({ page }, day: string, text: string) => {
    await page
      .getByRole("region", { name: new RegExp(`^${day},`) })
      .locator(".weekly-entry-card", { hasText: text })
      .dblclick();
  },
);

Then(
  "the entry's main button reads {string}",
  async ({ page }, label: string) => {
    // One main button after Cancel: no separate Start or Continue beside it.
    const footer = timeEntryEditor(page).locator("footer");
    await expect(footer.getByRole("button")).toHaveText(["Cancel", label]);
    await expect(footer.getByRole("button", { name: label })).toBeEnabled();
  },
);

Then("the entry editor hints {string}", async ({ page }, hint: string) => {
  await expect(timeEntryEditor(page).getByText(hint)).toBeVisible();
});

When(
  "I type {string} in the entry's Hours",
  async ({ page }, hours: string) => {
    await timeEntryEditor(page)
      .getByRole("textbox", { name: "Hours" })
      .fill(hours);
  },
);

When(
  "I change the entry's note to {string}",
  async ({ page }, note: string) => {
    await timeEntryEditor(page).getByLabel("Note", { exact: true }).fill(note);
  },
);

Then(
  "a running entry with the note {string} counts today",
  async ({ page }, note: string) => {
    await expect(
      page.getByRole("button", { name: "Edit the running entry" }),
    ).toBeVisible();
    const { state, today } = await readLocalState(page);
    expect(state.timers).toEqual([
      expect.objectContaining({ note, localDate: today }),
    ]);
  },
);

Then(
  /^the panel lists "(.+)" for (\S+): (.+)$/,
  async ({ page }, day: string, total: string, list: string) => {
    const rows = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const region = dayList(page, day);
    await expect(
      region.getByRole("heading").locator('[data-slot="value"]'),
    ).toHaveText(total);
    await expect(
      region.locator(
        ".time-entry-day-list-row .time-entry-day-list-text > span",
      ),
    ).toHaveText(rows);
  },
);

Then(
  "the panel's list marks {string} as the open entry",
  async ({ page }, text: string) => {
    const current = dayList(page).locator('[aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText(text);
  },
);

When(
  "I move the entry's date to {string}",
  async ({ page }, localDate: string) => {
    await timeEntryEditor(page).getByLabel("Date", { exact: true }).click();
    await page.getByLabel("Pick a date, typed").fill(localDate);
    await page.keyboard.press("Escape");
  },
);

When(
  "I open {string} from the panel's list",
  async ({ page }, text: string) => {
    await dayList(page)
      .locator("button.time-entry-day-list-row", { hasText: text })
      .click();
  },
);

Then(
  "the side panel edits the entry {string}",
  async ({ page }, entryId: string) => {
    await expect(page).toHaveURL(new RegExp(`[?&]entry=${entryId}(&|$)`));
    await expect(dayList(page).locator('[aria-current="true"]')).toHaveCount(1);
  },
);

Then(
  "Monday's {string} entry is saved on Tuesday",
  async ({ page }, note: string) => {
    await expect
      .poll(async () => {
        const { state } = await readLocalState(page);
        return state.timesheetEntries.find((entry) => entry.note === note)
          ?.localDate;
      })
      .toBe("2026-10-06");
  },
);
