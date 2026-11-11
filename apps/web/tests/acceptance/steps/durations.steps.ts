import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { timeEntryEditor } from "../../fixtures/time-entry-editor";

const { Given, When, Then } = createBdd();

const hoursField = (page: Page) =>
  timeEntryEditor(page).getByRole("textbox", { name: "Hours", exact: true });

function weekGridCell(page: Page, task: string, day: string) {
  return page
    .getByRole("region", { name: "Week" })
    .getByRole("button", { name: new RegExp(`^${task}, ${day},`) });
}

const gridCellInput = (page: Page, task: string, day: string) =>
  page.getByLabel(`Hours for ${task} on ${day}`, { exact: true });

const capacityField = (page: Page, day: string) =>
  page.getByRole("textbox", { name: day, exact: true });

const taskEditor = (page: Page) =>
  page.getByRole("dialog", { name: /^(New|Edit) task$/ });

const newItemComposer = (page: Page) =>
  page.getByRole("dialog", { name: "New backlog item" });

// The entry editor

When("I type {string} in Hours", async ({ page }, hours: string) => {
  await hoursField(page).fill(hours);
});

Then("Hours shows no message", async ({ page }) => {
  await expect(hoursField(page)).not.toHaveAttribute("aria-invalid", "true");
  await expect(timeEntryEditor(page).locator(".field-error")).toHaveCount(0);
});

Then("Hours says {string}", async ({ page }, message: string) => {
  await expect(hoursField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(hoursField(page)).toHaveAccessibleDescription(message);
  await expect(timeEntryEditor(page).getByText(message)).toBeVisible();
});

Then("Save is disabled", async ({ page }) => {
  await expect(
    timeEntryEditor(page).getByRole("button", {
      name: /^(Save|Create entry)$/,
    }),
  ).toBeDisabled();
});

Then(
  'Hours asks the phone for a keyboard with ":", "." and letters',
  async ({ page }) => {
    // "numeric" and "decimal" keypads lack ":" and the "h" of "1h30".
    await expect(hoursField(page)).toHaveAttribute("inputmode", "text");
  },
);

// The Week Grid

When(
  "I type {string} in the {string} cell on {word} and press Enter",
  async ({ page }, hours: string, task: string, day: string) => {
    await weekGridCell(page, task, day).focus();
    // Any character that starts a duration edits the cell in place with it.
    await page.keyboard.type(hours);
    await page.keyboard.press("Enter");
  },
);

When(
  "I type {string} in the {string} cell on {word} and click the Grid's header",
  async ({ page }, hours: string, task: string, day: string) => {
    await weekGridCell(page, task, day).focus();
    await page.keyboard.type(hours);
    await page
      .getByRole("region", { name: "Week" })
      .getByRole("columnheader", { name: /Project/ })
      .click();
  },
);

Then(
  "the {string} cell on {word} keeps {string} and says {string}",
  async (
    { page },
    task: string,
    day: string,
    typed: string,
    message: string,
  ) => {
    // Focus left: the draft stays, with the message, until fixed or cancelled.
    const input = gridCellInput(page, task, day);
    await expect(input).toHaveValue(typed);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(message);
  },
);

When(
  "I double-click the {string} cell on {word}",
  async ({ page }, task: string, day: string) => {
    await weekGridCell(page, task, day).dblclick();
  },
);

When("I press Enter again", async ({ page }) => {
  await page.keyboard.press("Enter");
});

When("I press Escape in the cell", async ({ page }) => {
  await page.keyboard.press("Escape");
});

Then(
  /^the "([^"]+)" cell on (\w+) (?:still )?says "([^"]+)"$/,
  async ({ page }, task: string, day: string, message: string) => {
    const input = gridCellInput(page, task, day);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(message);
    const shown = page.getByRole("alert").filter({ hasText: message });
    await expect(shown).toBeVisible();
    // The message sits under the cell, inside the window.
    const cellBox = (await input.boundingBox())!;
    const messageBox = (await shown.boundingBox())!;
    expect(messageBox.y).toBeGreaterThanOrEqual(cellBox.y + cellBox.height - 1);
    expect(messageBox.x).toBeGreaterThanOrEqual(0);
  },
);

Then(
  "the {string} cell on {word} is empty",
  async ({ page }, task: string, day: string) => {
    await expect(weekGridCell(page, task, day)).toHaveAccessibleName(
      new RegExp(`no time$`),
    );
  },
);

Given("I have a week with an entry of a million hours", async ({ page }) => {
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
  await page.addInitScript(() => {
    const hour = 60 * 60 * 1000;
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
            _id: "huge",
            localDate: "2026-10-05",
            projectId: "project-atlas",
            taskId: "task-dev",
            label: "",
            durationMs: 999_999_999 * hour,
            sourceBlockIds: [],
            committedAt: 1,
          },
        ],
        updatedAt: 1,
      }),
    );
  });
});

When("I switch the Week view to Days", async ({ page }) => {
  await page.getByRole("button", { name: "Days", exact: true }).click();
  await expect(page.locator(".weekly-days-column").first()).toBeVisible();
});

When("I open the Day view of that entry", async ({ page }) => {
  await page.goto("/time/2026-10-05?view=day");
  await expect(page.locator(".day-strip")).toBeVisible();
});

When("I narrow the window to a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".day-strip")).toBeVisible();
});

Then("no figure runs out of its cell", async ({ page }) => {
  const main = page.getByRole("main");
  await expect(main.getByText(/999999/).first()).toBeAttached();
  // What doesn't fit is clipped, with an ellipsis, inside its own box: no
  // text runs into a neighbor or out of the window.
  const spilling = await main.evaluate((root) => {
    const width = document.documentElement.clientWidth;
    const holdsText = (node: Element) =>
      [...node.childNodes].some(
        (child) => child.nodeType === 3 && child.textContent?.trim(),
      );
    const spills = [...root.querySelectorAll<HTMLElement>("*")].filter(
      (node) =>
        holdsText(node) &&
        node.clientWidth > 0 &&
        getComputedStyle(node).overflowX === "visible" &&
        node.scrollWidth > node.clientWidth + 1,
    );
    const outOfWindow = [...root.querySelectorAll<HTMLElement>("*")].filter(
      (node) => {
        if (!holdsText(node)) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.right > width + 1;
      },
    );
    // Each day's figures stay inside their own day.
    const days = [
      ...root.querySelectorAll<HTMLElement>(
        ".weekly-grid-day-column, .weekly-days-column-header, .day-strip-day",
      ),
    ];
    const outOfDay = days.filter((day) => {
      const box = day.getBoundingClientRect();
      return [...day.querySelectorAll<HTMLElement>("*")].some((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.width > 0 &&
          (rect.left < box.left - 1 || rect.right > box.right + 1)
        );
      });
    });
    return [...spills, ...outOfWindow, ...outOfDay].map(
      (node) => `${node.className}: ${node.textContent?.slice(0, 24)}`,
    );
  });
  expect(spilling).toEqual([]);
});

// Settings › General capacity

When("I open Settings General", async ({ page }) => {
  await page.goto("/settings/general");
});

When(
  "I type {string} in the {word} capacity and press Enter",
  async ({ page }, hours: string, day: string) => {
    const field = capacityField(page, day);
    await field.fill(hours);
    await field.press("Enter");
  },
);

Then(
  "the {word} capacity is saved as {string}",
  async ({ page }, day: string, hours: string) => {
    const key = day.toLowerCase();
    await expect
      .poll(() =>
        page.evaluate((weekday) => {
          const raw = window.localStorage.getItem("ajour.local-state.v2");
          const state = raw ? JSON.parse(raw) : {};
          const ms = state.userPreferences?.weeklyCapacityTargets?.[weekday];
          if (typeof ms !== "number") return null;
          const minutes = Math.round(ms / 60_000);
          return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
        }, key),
      )
      .toBe(hours);
  },
);

Then(
  "the {word} capacity says {string}",
  async ({ page }, day: string, message: string) => {
    const field = capacityField(page, day);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(message);
    await expect(page.getByText(message)).toBeVisible();
  },
);

// Task budgets

When("I open task {string}", async ({ page }, task: string) => {
  await page.getByText(task, { exact: true }).dblclick();
  await expect(taskEditor(page)).toBeVisible();
});

When(
  "I type {string} in the task's budget",
  async ({ page }, hours: string) => {
    await taskEditor(page).getByLabel("budget", { exact: true }).fill(hours);
  },
);

When(
  "I type {string} in the task's adjustment",
  async ({ page }, hours: string) => {
    await taskEditor(page)
      .getByLabel("adjustment", { exact: true })
      .fill(hours);
  },
);

Then("the task editor shows no budget message", async ({ page }) => {
  await expect(taskEditor(page).getByText(/^Budget:/)).toHaveCount(0);
});

Then("the task editor shows no adjustment message", async ({ page }) => {
  await expect(taskEditor(page).getByText(/^Adjustment:/)).toHaveCount(0);
});

Then("the task editor says {string}", async ({ page }, message: string) => {
  await expect(taskEditor(page).getByText(message)).toBeVisible();
});

// Backlog estimates

When("I start a new backlog item", async ({ page }) => {
  await page.getByRole("button", { name: "New backlog item" }).first().click();
  await expect(newItemComposer(page)).toBeVisible();
});

When("I type {string} in its estimate", async ({ page }, hours: string) => {
  await newItemComposer(page)
    .getByLabel("estimated", { exact: true })
    .fill(hours);
});

Then("the composer shows no estimate message", async ({ page }) => {
  await expect(
    newItemComposer(page).getByText(/^(Original|Remaining|Completed):/),
  ).toHaveCount(0);
});

Then("the composer says {string}", async ({ page }, message: string) => {
  await expect(newItemComposer(page).getByText(message)).toBeVisible();
});

When(
  "I type {string} in its remaining estimate on its page and press Enter",
  async ({ page }, hours: string) => {
    const field = page.getByRole("textbox", {
      name: "Remaining estimate in hours",
    });
    if (!(await field.isVisible())) {
      await page
        .getByRole("button", { name: /^Edit remaining estimate/ })
        .click();
    }
    await field.fill(hours);
    await field.press("Enter");
  },
);

Then(
  "the remaining estimate on its page says {string}",
  async ({ page }, message: string) => {
    const field = page.getByRole("textbox", {
      name: "Remaining estimate in hours",
    });
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(message);
    await expect(page.getByText(message)).toBeVisible();
  },
);

Then(
  "its remaining estimate on its page reads {string}",
  async ({ page }, hours: string) => {
    await expect(
      page.getByRole("button", {
        name: `Edit remaining estimate, ${hours}`,
      }),
    ).toBeVisible();
  },
);
