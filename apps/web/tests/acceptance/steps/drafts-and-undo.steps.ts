import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { timeEntryEditor } from "../../fixtures/time-entry-editor";

const { Given, When, Then } = createBdd();

const HOUR = 60 * 60 * 1000;

interface StoredEntry {
  _id: string;
  localDate: string;
  note?: string;
  durationMs: number;
}

async function readStoredState(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(
        window.localStorage.getItem("ajour.local-state.v2") ?? "null",
      ) as {
        timesheetEntries: StoredEntry[];
        timers: { _id: string; taskId?: string; note?: string }[];
      },
  );
}

async function storedEntries(page: Page) {
  return (await readStoredState(page)).timesheetEntries;
}

function dayRow(page: Page, note: string) {
  return page.locator(".time-entry-row").filter({ hasText: note });
}

function toasts(page: Page) {
  return page.getByRole("region", { name: "Notifications" });
}

Given("an entry is running on {string}", async ({ page }, task: string) => {
  await page.addInitScript((taskName) => {
    const key = "ajour.local-state.v2";
    const state = JSON.parse(window.localStorage.getItem(key) ?? "null");
    const taskId = state.projects[0].tasks.find(
      (candidate: { name: string }) => candidate.name === taskName,
    )._id;
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    state.timers = [
      {
        _id: "timer-running",
        startedAt: Date.now() - 10 * 60 * 1000,
        localDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        projectId: "project-atlas",
        taskId,
        accumulatedDurationMs: 0,
      },
    ];
    window.localStorage.setItem(key, JSON.stringify(state));
  }, task);
});

When("I delete the Monday entry {string}", async ({ page }, note: string) => {
  await page.getByText(note, { exact: true }).first().click({
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(dayRow(page, note)).toHaveCount(0);
});

When("I press Cmd+Z {int} times", async ({ page }, count: number) => {
  for (let press = 0; press < count; press += 1) {
    const before = (await storedEntries(page)).length;
    await page.locator("body").press("ControlOrMeta+z");
    // Each press undoes one action; the last finds nothing left to undo.
    if (press < count - 1) {
      await expect
        .poll(async () => (await storedEntries(page)).length)
        .toBe(before + 1);
    }
  }
});

Then("Monday's entries are back exactly as they were", async ({ page }) => {
  await expect(dayRow(page, "API")).toBeVisible();
  await expect(dayRow(page, "Login form")).toBeVisible();
  expect(
    (await storedEntries(page)).map(({ _id, note, durationMs }) => ({
      _id,
      note,
      durationMs,
    })),
  ).toEqual([
    { _id: "mon-dev-1", note: "Login form", durationMs: HOUR },
    { _id: "mon-dev-2", note: "API", durationMs: 2 * HOUR },
    { _id: "mon-review", note: undefined, durationMs: HOUR },
    { _id: "tue-dev", note: "Login form", durationMs: HOUR },
  ]);
});

When("I open the Monday entry {string}", async ({ page }, note: string) => {
  await dayRow(page, note).first().dblclick();
  await expect(timeEntryEditor(page)).toBeVisible();
});

When(
  "I type {string} in Hours and press Enter",
  async ({ page }, hours: string) => {
    const field = timeEntryEditor(page).getByLabel("Hours");
    await field.fill(hours);
    await field.press("Enter");
  },
);

Then("a toast says {string} with Undo", async ({ page }, title: string) => {
  await expect(toasts(page)).toContainText(title);
  await expect(
    toasts(page).getByRole("button", { name: "Undo" }),
  ).toBeVisible();
});

Then(
  "the Monday entry {string} has {word} hours",
  async ({ page }, idOrNote: string, hours: string) => {
    const [h, m] = hours.split(":").map(Number);
    await expect
      .poll(async () => {
        const entry = (await storedEntries(page)).find(
          (candidate) =>
            candidate._id === idOrNote ||
            (candidate.note === idOrNote &&
              candidate.localDate === "2026-10-05"),
        );
        return entry?.durationMs;
      })
      .toBe(h * HOUR + m * 60_000);
  },
);

Then(
  "the Monday entry {string} has the note {string}",
  async ({ page }, id: string, note: string) => {
    await expect
      .poll(
        async () =>
          (await storedEntries(page)).find((entry) => entry._id === id)?.note,
      )
      .toBe(note);
  },
);

When(
  "I write a new entry of {string} with the note {string}",
  async ({ page }, hours: string, note: string) => {
    await page.locator("body").press("n");
    const editor = timeEntryEditor(page);
    await expect(editor.getByLabel("Hours")).toBeFocused();
    if (hours) await page.keyboard.type(hours);
    await page.keyboard.press("Tab");
    await page.keyboard.type(note);
    await expect(editor.getByLabel("Note")).toHaveValue(note);
  },
);

When("I press Enter in the note", async ({ page }) => {
  await timeEntryEditor(page).getByLabel("Note").press("Enter");
});

When("I press Escape in the note", async ({ page }) => {
  await timeEntryEditor(page).getByLabel("Note").press("Escape");
});

When("I add {string} to the note", async ({ page }, text: string) => {
  const note = timeEntryEditor(page).getByLabel("Note");
  await note.click();
  await note.press("End");
  await page.keyboard.type(text);
});

When("I click the Day view's empty space", async ({ page }) => {
  // Clicking outside the side panel does nothing to its draft.
  const main = await page.locator(".time-page-main").boundingBox();
  if (!main) throw new Error("The Time page has no main area");
  await page.mouse.click(main.x + 40, main.y + main.height - 40);
  await expect(timeEntryEditor(page)).toBeVisible();
});

Then("the new entry form is open", async ({ page }) => {
  await expect(
    timeEntryEditor(page).getByRole("heading", { name: "New time entry" }),
  ).toBeVisible();
});

Then("Monday has no entry {string}", async ({ page }, note: string) => {
  await expect(dayRow(page, note)).toHaveCount(0);
  expect(
    (await storedEntries(page)).filter((entry) => entry.note === note),
  ).toEqual([]);
});

Then(
  "Monday has an entry {string} of {word}",
  async ({ page }, note: string, hours: string) => {
    const [h, m] = hours.split(":").map(Number);
    await expect
      .poll(async () =>
        (await storedEntries(page))
          .filter((entry) => entry.note === note)
          .map(({ localDate, durationMs }) => ({ localDate, durationMs })),
      )
      .toEqual([
        { localDate: "2026-10-05", durationMs: h * HOUR + m * 60_000 },
      ]);
  },
);

Then(
  "the entry editor shows {string} and the note {string}",
  async ({ page }, hours: string, note: string) => {
    const editor = timeEntryEditor(page);
    await expect(editor.getByLabel("Hours")).toHaveValue(hours);
    await expect(editor.getByLabel("Note")).toHaveValue(note);
  },
);

When("I press Cancel in the entry editor", async ({ page }) => {
  await timeEntryEditor(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(timeEntryEditor(page)).toHaveCount(0);
});

Then("the entry editor says {string}", async ({ page }, text: string) => {
  await expect(timeEntryEditor(page)).toContainText(text);
});

Then(
  "the entry on {string} is still running",
  async ({ page }, task: string) => {
    expect(task).toBe("Development");
    const { timers } = await readStoredState(page);
    expect(timers).toEqual([
      expect.objectContaining({ _id: "timer-running", taskId: "task-dev" }),
    ]);
  },
);

When("I press Start in the entry editor", async ({ page }) => {
  await timeEntryEditor(page)
    .getByRole("button", { name: /^Start( today)?$/ })
    .click();
});

Then(
  "the running entry has the note {string}",
  async ({ page }, note: string) => {
    await expect
      .poll(async () => (await readStoredState(page)).timers)
      .toEqual([expect.objectContaining({ note })]);
  },
);

const BACKLOG_EDITOR = /^(New|Edit) (backlog item|subitem)$/;

function backlogEditor(page: Page) {
  return page.getByRole("dialog", { name: BACKLOG_EDITOR });
}

Then("{string} is not in the Backlog", async ({ page }, title: string) => {
  await expect(
    page.getByRole("main").getByText(title, { exact: true }),
  ).toHaveCount(0);
  const titles = await page.evaluate(() =>
    (
      JSON.parse(window.localStorage.getItem("ajour.local-state.v2")!) as {
        workItems: { title: string }[];
      }
    ).workItems.map((item) => item.title),
  );
  expect(titles).not.toContain(title);
});

When("I press Escape in the open Backlog editor", async ({ page }) => {
  await backlogEditor(page)
    .getByRole("textbox", { name: /^(Item|Subitem)$/ })
    .press("Escape");
});

When("I open a new backlog item", async ({ page }) => {
  await page.getByRole("button", { name: "New backlog item" }).first().click();
  await expect(backlogEditor(page)).toBeVisible();
});

Then(
  "the open Backlog editor's title reads {string}",
  async ({ page }, title: string) => {
    await expect(
      backlogEditor(page).getByRole("textbox", { name: /^(Item|Subitem)$/ }),
    ).toHaveValue(title);
  },
);

When("I cancel the open Backlog editor", async ({ page }) => {
  await backlogEditor(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(backlogEditor(page)).toHaveCount(0);
});

function taskComposer(page: Page) {
  return page.getByRole("dialog", { name: /^(New|Edit) task$/ });
}

Then(
  "the task editor's name reads {string}",
  async ({ page }, name: string) => {
    await expect(
      taskComposer(page).getByRole("textbox", { name: "Name" }),
    ).toHaveValue(name);
  },
);

When("I cancel the task editor", async ({ page }) => {
  await taskComposer(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(taskComposer(page)).toHaveCount(0);
});

function projectComposer(page: Page) {
  return page.getByRole("dialog", { name: "New project" });
}

When(
  "I type {string} as the new project's full name and press Escape",
  async ({ page }, name: string) => {
    const field = projectComposer(page).getByRole("textbox", {
      name: "Full name",
    });
    await field.fill(name);
    await field.press("Escape");
  },
);

Then("there is no project {string}", async ({ page }, name: string) => {
  const names = await page.evaluate(() =>
    (
      JSON.parse(window.localStorage.getItem("ajour.local-state.v2")!) as {
        projects: { name: string }[];
      }
    ).projects.map((project) => project.name),
  );
  expect(names).not.toContain(name);
});

Then(
  "the new project's full name reads {string}",
  async ({ page }, name: string) => {
    await expect(
      projectComposer(page).getByRole("textbox", { name: "Full name" }),
    ).toHaveValue(name);
  },
);

When("I cancel the project composer", async ({ page }) => {
  await projectComposer(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(projectComposer(page)).toHaveCount(0);
});

When(
  "another tab sets the Monday entry {string} to {word} hours",
  async ({ page }, id: string, hours: string) => {
    const [h, m] = hours.split(":").map(Number);
    // As another window's save arrives: written to storage, then announced.
    await page.evaluate(
      ({ id, durationMs }) => {
        const key = "ajour.local-state.v2";
        const state = JSON.parse(window.localStorage.getItem(key)!);
        const entry = state.timesheetEntries.find(
          (candidate: { _id: string }) => candidate._id === id,
        );
        entry.durationMs = durationMs;
        window.localStorage.setItem(key, JSON.stringify(state));
        window.dispatchEvent(new StorageEvent("storage", { key }));
      },
      { id, durationMs: h * HOUR + m * 60_000 },
    );
  },
);

When("I change Hours to {string}", async ({ page }, hours: string) => {
  await timeEntryEditor(page).getByLabel("Hours").fill(hours);
});

Then("the entry editor shows no changed field", async ({ page }) => {
  await expect(
    timeEntryEditor(page).getByRole("group", { name: "Changed elsewhere" }),
  ).toHaveCount(0);
});

Then("the entry editor's Save is disabled", async ({ page }) => {
  await expect(
    timeEntryEditor(page).getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
});

When(
  "I press {string} in the entry editor",
  async ({ page }, label: string) => {
    await timeEntryEditor(page)
      .getByRole("button", { name: label, exact: true })
      .click();
  },
);
