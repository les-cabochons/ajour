import { expect, type Locator, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

const STATE_KEY = "ajour.local-state.v2";

interface SavedState {
  projects: {
    _id: string;
    name: string;
    code?: string;
    color: string;
    status: string;
    tasks: { name: string; status: string }[];
  }[];
  timers: { projectId?: string; taskId?: string }[];
  timesheetEntries: {
    projectId?: string;
    taskId?: string;
    durationMs: number;
  }[];
  workItems: { _id: string; workflowStateId?: string }[];
  userPreferences: {
    calendarSuggestions?: { minimumMinutes: number; refreshMinutes: number };
  };
}

function readState(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!) as unknown,
    STATE_KEY,
  ) as Promise<SavedState>;
}

function toasts(page: Page) {
  return page.getByRole("region", { name: "Notifications" });
}

function propertiesCard(page: Page) {
  return page.getByRole("region", { name: "Properties" });
}

async function seedAtlasWorkspace(page: Page, longTitles: boolean) {
  await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: false,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.addInitScript(
    ({ key, longTitles }) => {
      if (sessionStorage.getItem("atlas-fixture")) return;
      localStorage.clear();
      sessionStorage.setItem("atlas-fixture", "true");
      const long = "long".repeat(100);
      const task = (_id: string, name: string, status = "active") => ({
        _id,
        name,
        status,
        createdAt: 1,
      });
      localStorage.setItem(
        key,
        JSON.stringify({
          projects: [
            {
              _id: "p-atlas",
              name: "Atlas Platform",
              displayName: "Atlas",
              code: "ATLAS",
              color: "#2563eb",
              status: "active",
              tasks: [
                task("t-design", "Design"),
                task("t-build", "Build"),
                task("t-old", "Old research", "archived"),
              ],
            },
            {
              _id: "p-beta",
              name: "Beta",
              color: "#059669",
              status: "active",
              tasks: [],
            },
            ...(longTitles
              ? [
                  {
                    _id: "p-long",
                    name: long,
                    color: "#9333ea",
                    status: "active",
                    tasks: [],
                  },
                ]
              : []),
          ],
          workflowStates: [
            { _id: "todo", name: "To do", color: "#64748b", createdAt: 1 },
            {
              _id: "doing",
              name: "In progress",
              color: "#d97706",
              createdAt: 1,
            },
            {
              _id: "review",
              name: "In review",
              color: "#9333ea",
              createdAt: 1,
            },
            {
              _id: "done",
              name: "Done",
              color: "#059669",
              done: true,
              createdAt: 1,
            },
          ],
          workItems: [
            {
              _id: "w-login",
              title: "Atlas login bug",
              source: "manual",
              status: "active",
              projectId: "p-atlas",
              workflowStateId: "doing",
              createdAt: 1,
            },
            {
              _id: "w-docs",
              title: "Beta docs",
              source: "manual",
              status: "active",
              projectId: "p-beta",
              workflowStateId: "doing",
              createdAt: 1,
            },
            ...(longTitles
              ? [
                  {
                    _id: "w-long",
                    title: long,
                    source: "manual",
                    status: "active",
                    createdAt: 1,
                  },
                ]
              : []),
          ],
        }),
      );
    },
    { key: STATE_KEY, longTitles },
  );
  await page.goto("/time");
}

Given("I have the Atlas workspace", async ({ page }) => {
  await seedAtlasWorkspace(page, false);
});

Given("I have the Atlas workspace with long titles", async ({ page }) => {
  await seedAtlasWorkspace(page, true);
});

/* ── Workflow states ───────────────────────────────────────────── */

When(
  "I remove the workflow state {string} in Workflow settings",
  async ({ page }, name: string) => {
    if (!page.url().endsWith("/settings/workflow")) {
      await page.goto("/settings/workflow");
    }
    await page.getByRole("button", { name: `Remove ${name}` }).click();
  },
);

Then("a dialog says {string}", async ({ page }, text: string) => {
  await expect(page.getByRole("alertdialog")).toContainText(text);
});

When(
  "I move them to {string} and remove the state",
  async ({ page }, target: string) => {
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("combobox", { name: "Move them to" }).click();
    await page.getByRole("option", { name: target, exact: true }).click();
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  },
);

Then("both items are in {string}", async ({ page }, name: string) => {
  const id = name === "In review" ? "review" : name;
  await expect
    .poll(async () =>
      (await readState(page)).workItems.map((item) => item.workflowStateId),
    )
    .toEqual([id, id]);
});

Then(
  "no dialog asks and the toast says {string}",
  async ({ page }, text: string) => {
    await expect(toasts(page)).toContainText(text);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  },
);

/* ── Archiving a project with its entry running ────────────────── */

Given("an entry runs on Atlas", async ({ page }) => {
  await page.evaluate(async () => {
    const { localStore } = await import("/src/lib/local-store.ts");
    localStore.startTimer({
      projectId: "p-atlas",
      taskId: "t-design",
      accumulatedDurationMs: 60_000,
    });
  });
});

When("I open the Atlas project page", async ({ page }) => {
  await page.goto("/projects/p-atlas");
  await expect(propertiesCard(page)).toBeVisible();
});

When("I archive the project from its properties card", async ({ page }) => {
  await propertiesCard(page)
    .getByRole("button", { name: "Archive", exact: true })
    .click();
});

Then("no entry runs and the Atlas entry is saved", async ({ page }) => {
  await expect.poll(async () => (await readState(page)).timers).toEqual([]);
  const saved = await readState(page);
  expect(saved.timesheetEntries).toEqual([
    expect.objectContaining({ projectId: "p-atlas", taskId: "t-design" }),
  ]);
  expect(saved.timesheetEntries[0]!.durationMs).toBeGreaterThanOrEqual(60_000);
});

Then(
  "the sidebar no longer lists {string}",
  async ({ page }, title: string) => {
    const sidebar = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    await expect(
      sidebar.locator("[data-backlog-item-id] [data-row-title]", {
        hasText: "Beta docs",
      }),
    ).toBeVisible();
    await expect(
      sidebar.locator("[data-backlog-item-id] [data-row-title]", {
        hasText: title,
      }),
    ).toHaveCount(0);
  },
);

When("I press Undo in the toast", async ({ page }) => {
  await toasts(page).getByRole("button", { name: "Undo" }).click();
});

Then("the Atlas entry runs again", async ({ page }) => {
  await expect
    .poll(async () => (await readState(page)).timers)
    .toEqual([expect.objectContaining({ projectId: "p-atlas" })]);
  expect((await readState(page)).timesheetEntries).toEqual([]);
});

/* ── Number fields ─────────────────────────────────────────────── */

When("I open Calendar settings", async ({ page }) => {
  await page.goto("/settings/calendar");
});

function numberField(page: Page, label: string) {
  return page.getByLabel(label, { exact: true });
}

When(
  "I select all in the number field {string} and type {string}",
  async ({ page }, label: string, text: string) => {
    const field = numberField(page, label);
    await field.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(text);
  },
);

Then(
  "the number field {string} shows {string}",
  async ({ page }, label: string, text) => {
    await expect(numberField(page, label)).toHaveValue(text);
  },
);

Then(
  "the refresh setting is saved as {int} when I leave the field",
  async ({ page }, minutes: number) => {
    await page.keyboard.press("Tab");
    await expect
      .poll(
        async () =>
          (await readState(page)).userPreferences.calendarSuggestions
            ?.refreshMinutes,
      )
      .toBe(minutes);
  },
);

When(
  "I clear the number field {string} with Backspace",
  async ({ page }, label: string) => {
    const field = numberField(page, label);
    await field.click();
    await page.keyboard.press("End");
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press("Backspace");
    }
  },
);

When(
  "I type {string} in the number field {string}",
  async ({ page }, text: string, label: string) => {
    await numberField(page, label).pressSequentially(text);
  },
);

When("I leave the number field", async ({ page }) => {
  await page.keyboard.press("Tab");
});

Then("the number field says {string}", async ({ page }, text: string) => {
  await expect(page.getByRole("alert").filter({ hasText: text })).toBeVisible();
});

Then(
  "the shortest event setting is still {int}",
  async ({ page }, minutes: number) => {
    expect(
      (await readState(page)).userPreferences.calendarSuggestions
        ?.minimumMinutes,
    ).toBe(minutes);
  },
);

/* ── Project codes and names ───────────────────────────────────── */

async function editProperty(page: Page, label: string, text: string) {
  const card = propertiesCard(page);
  await card
    .getByRole("button", { name: new RegExp(`^Edit ${label.toLowerCase()},`) })
    .click();
  const field = card.getByRole("textbox", { name: label, exact: true });
  await field.fill(text);
  await field.press("Enter");
}

When(
  "I set the code to {string} in its properties",
  async ({ page }, text: string) => {
    await editProperty(page, "Code", text);
  },
);

When(
  "I set the full name to {string} in its properties",
  async ({ page }, text: string) => {
    await editProperty(page, "Full name", text);
  },
);

Then("the code reads {string}", async ({ page }, code: string) => {
  await expect(
    propertiesCard(page).getByRole("button", { name: `Edit code, ${code}` }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await readState(page)).projects.find((p) => p._id === "p-atlas")?.code,
    )
    .toBe(code);
});

Then("the property says {string}", async ({ page }, text: string) => {
  await expect(
    propertiesCard(page).getByRole("alert").filter({ hasText: text }),
  ).toBeVisible();
});

Then("the saved code is still {string}", async ({ page }, code: string) => {
  expect(
    (await readState(page)).projects.find((p) => p._id === "p-atlas")?.code,
  ).toBe(code);
});

Then(
  "the saved full name is still {string}",
  async ({ page }, name: string) => {
    expect(
      (await readState(page)).projects.find((p) => p._id === "p-atlas")?.name,
    ).toBe(name);
  },
);

/* ── Duplicate names ───────────────────────────────────────────── */

When("I start a new project named {string}", async ({ page }, name: string) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByRole("textbox", { name: "Full name" }).fill(name);
});

Then("the composer warns {string}", async ({ page }, text: string) => {
  await expect(page.getByRole("dialog")).toContainText(text);
});

When("I close the composer", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

When("I start a new task named {string}", async ({ page }, name: string) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
});

/* ── Color field ───────────────────────────────────────────────── */

When(
  "I type {string} in the project color field and press Enter",
  async ({ page }, text: string) => {
    const trigger = propertiesCard(page).getByRole("button", {
      name: /^Project color:/,
    });
    const field = page.getByRole("textbox", { name: "Hex color" });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await expect(field).toHaveCount(0);
      await trigger.click();
    }
    await field.fill(text);
    await field.press("Enter");
  },
);

Then("the project color is {string}", async ({ page }, color: string) => {
  await expect
    .poll(
      async () =>
        (await readState(page)).projects.find((p) => p._id === "p-atlas")
          ?.color,
    )
    .toBe(color);
});

Then("the color field says {string}", async ({ page }, text: string) => {
  await expect(page.getByRole("alert").filter({ hasText: text })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Hex color" })).toHaveValue(
    "#1234567",
  );
});

/* ── Long titles ───────────────────────────────────────────────── */

async function expectInside(inner: Locator, outer: Locator) {
  const innerBox = (await inner.boundingBox())!;
  const outerBox = (await outer.boundingBox())!;
  expect(innerBox.x).toBeGreaterThanOrEqual(outerBox.x - 1);
  expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(
    outerBox.x + outerBox.width + 1,
  );
}

When("I open the long backlog item", async ({ page }) => {
  await page.goto("/backlog/w-long");
});

/** Whether the element's text runs past its own box, cut or overflowing. */
function overflowsItself(locator: Locator) {
  return locator.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
}

Then("its title and buttons stay inside the page", async ({ page }) => {
  const main = page.locator("main");
  const title = main.getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  await expectInside(title, main);
  expect(await overflowsItself(title)).toBe(false);
  const titleBox = (await title.boundingBox())!;
  const actions = main.getByRole("group", { name: "Item actions" });
  for (const button of await actions.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    await expectInside(button, main);
    // No action sits over the title's text.
    const overlaps =
      box.x < titleBox.x + titleBox.width &&
      box.x + box.width > titleBox.x &&
      box.y < titleBox.y + titleBox.height &&
      box.y + box.height > titleBox.y;
    expect(overlaps).toBe(false);
  }
});

When("I open the long project", async ({ page }) => {
  await page.goto("/projects/p-long");
});

Then("its title stays inside the page", async ({ page }) => {
  const main = page.locator("main");
  const title = main.getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  await expectInside(title, main);
  // The whole title shows: it wraps instead of being cut.
  expect(await overflowsItself(title.getByRole("button"))).toBe(false);
});

/* ── Tasks tab ─────────────────────────────────────────────────── */

Then("the Tasks tab counts {int}", async ({ page }, count: number) => {
  await expect(page.getByRole("tab", { name: /^Tasks/ })).toHaveText(
    `Tasks ${count}`,
  );
});

/* ── Create more ───────────────────────────────────────────────── */

When("I create the task", async ({ page }) => {
  await page.getByRole("button", { name: "Create task", exact: true }).click();
});

Then("the New task button has the focus", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeFocused();
});

When("I turn on Create more", async ({ page }) => {
  await page.getByRole("switch", { name: "Create more" }).click();
});

Then("the task name field is empty and has the focus", async ({ page }) => {
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(name).toHaveValue("");
  await expect(name).toBeFocused();
});

When(
  "I type {string} in the task name field and press Enter",
  async ({ page }, text: string) => {
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await name.pressSequentially(text);
    await name.press("Enter");
  },
);

Then(
  "Atlas Platform has the tasks {string}, {string} and {string}",
  async ({ page }, first: string, second: string, third: string) => {
    await expect
      .poll(async () =>
        (await readState(page)).projects
          .find((p) => p._id === "p-atlas")
          ?.tasks.map((task) => task.name),
      )
      .toEqual(["Design", "Build", "Old research", first, second, third]);
  },
);

/* ── Workbook import ───────────────────────────────────────────── */

const HEADERS = [
  "project",
  "code",
  "color",
  "status",
  "task",
  "task_status",
  "billable",
  "budget_hours",
  "adjustment_hours",
];

async function workbook(rows: (string | number)[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Projects");
  sheet.addRow(HEADERS);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function importWorkbook(page: Page, buffer: Buffer) {
  await page.locator("#project-import-file").setInputFiles({
    name: "projects.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByRole("button", { name: "Import workbook" }).click();
}

When("I open Projects settings", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto("/settings/projects");
});

When(
  "I import a workbook whose row 3 has budget hours {string}",
  async ({ page }, hours: string) => {
    await importWorkbook(
      page,
      await workbook([
        [
          "Atlas Platform",
          "ATLAS",
          "#2563eb",
          "active",
          "Design",
          "",
          "",
          4,
          "",
        ],
        [
          "Atlas Platform",
          "ATLAS",
          "#2563eb",
          "active",
          "Build",
          "",
          "",
          hours,
          "",
        ],
      ]),
    );
  },
);

Then(
  "the import error names row {int} and its budget hours {string}",
  async ({ page }, row: number, hours: string) => {
    await expect(
      page.getByText(
        `Row ${row} is invalid. budget_hours "${hours}" is not a number.`,
        { exact: true },
      ),
    ).toBeVisible();
  },
);

Then("the import error is in view", async ({ page }) => {
  await expect(page.getByText(/^Row 3 is invalid/)).toBeInViewport();
});

When(
  "I import a workbook that renames Atlas, has a negative budget, a color {string} and a duplicate task row",
  async ({ page }, color: string) => {
    await importWorkbook(
      page,
      await workbook([
        ["atlas platform", "", color, "active", "Design", "", "", 4, ""],
        ["atlas platform", "", "", "active", "Build", "", "", -5, ""],
        ["atlas platform", "", "", "active", "Design", "", "", 6, ""],
      ]),
    );
  },
);

Then(
  "the import summary says it skipped the color {string} of {}",
  async ({ page }, color: string, project: string) => {
    await expect(
      page.getByText(
        `Skipped color "${color}" of ${project}: use a hex color such as #4f46e5.`,
        { exact: true },
      ),
    ).toBeVisible();
  },
);

Then("the import summary says {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});
