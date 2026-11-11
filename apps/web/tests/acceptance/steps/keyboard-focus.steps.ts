import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { timeEntryEditor } from "../../fixtures/time-entry-editor";

const { Given, When, Then } = createBdd();

const STATE_KEY = "ajour.local-state.v2";

/** The fixture's backlog items, by title. */
const ITEM_IDS: Record<string, string> = {
  "Fix the login form": "item-login",
  "Write release notes": "item-notes",
  "Review the export": "item-export",
  "Fix export rounding": "item-synced",
};

Given("I have a workspace for keyboard work", async ({ page }) => {
  await page.route("**/api/plugins", (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        pluginsEnabled: false,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
    }),
  );
  await page.addInitScript((key) => {
    if (sessionStorage.getItem("keyboard-focus-fixture")) return;
    sessionStorage.setItem("keyboard-focus-fixture", "true");
    localStorage.clear();
    const now = Date.now();
    const hour = 3_600_000;
    const day = new Date();
    const iso = (date: Date) =>
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
    const today = iso(day);
    const task = (id: string, name: string) => ({
      _id: id,
      name,
      status: "active",
      createdAt: 1,
    });
    const item = (
      id: string,
      title: string,
      workflowStateId: string,
      priority: number,
    ) => ({
      _id: id,
      title,
      source: "manual",
      status: "active",
      workflowStateId,
      priority,
      projectId: "p-atlas",
      taskId: "t-atlas-dev",
      createdAt: 1,
    });
    const entry = (
      id: string,
      projectId: string,
      taskId: string,
      note: string,
      hours: number,
      usedAt: number,
    ) => ({
      _id: id,
      localDate: today,
      projectId,
      taskId,
      label: "",
      note,
      durationMs: hours * hour,
      sourceBlockIds: [],
      committedAt: usedAt,
      usedAt,
    });
    localStorage.setItem(
      key,
      JSON.stringify({
        workflowStates: [
          { _id: "todo", name: "To do", color: "#9ca3af", createdAt: 1 },
          { _id: "doing", name: "In progress", color: "#d97706", createdAt: 2 },
          { _id: "review", name: "In review", color: "#2563eb", createdAt: 3 },
          {
            _id: "done",
            name: "Done",
            color: "#059669",
            done: true,
            createdAt: 4,
          },
        ],
        projects: [
          {
            _id: "p-atlas",
            name: "Atlas platform",
            displayName: "Atlas platform",
            code: "ATL",
            color: "#2563eb",
            icon: { kind: "preset", name: "dot" },
            status: "active",
            tasks: [
              task("t-atlas-dev", "Development"),
              task("t-atlas-review", "Code review"),
            ],
          },
          {
            _id: "p-harbor",
            name: "Harbor mobile",
            displayName: "Harbor mobile",
            code: "HRB",
            color: "#d97706",
            icon: { kind: "preset", name: "dot" },
            status: "active",
            tasks: [
              task("t-harbor-dev", "Development"),
              task("t-harbor-qa", "QA and release"),
            ],
          },
        ],
        workItems: [
          item("item-login", "Fix the login form", "todo", 3),
          item("item-notes", "Write release notes", "todo", 2),
          item("item-export", "Review the export", "doing", 1),
        ],
        timesheetEntries: [
          entry(
            "e-standup",
            "p-atlas",
            "t-atlas-dev",
            "Standup notes",
            0.5,
            now - 3 * hour,
          ),
          entry(
            "e-sync",
            "p-harbor",
            "t-harbor-dev",
            "Sync bug",
            1,
            now - 2 * hour,
          ),
          entry(
            "e-review",
            "p-atlas",
            "t-atlas-review",
            "Review comments",
            0.5,
            now - 4 * hour,
          ),
          entry(
            "e-plan",
            "p-harbor",
            "t-harbor-qa",
            "Sprint planning",
            1,
            now - 5 * hour,
          ),
          entry(
            "e-docs",
            "p-atlas",
            "t-atlas-dev",
            "Docs pass",
            0.5,
            now - 6 * hour,
          ),
        ],
        timers: [],
        userPreferences: { closeParentSubitems: "ask" },
        updatedAt: 1,
      }),
    );
  }, STATE_KEY);
});

/** Edits the seeded state once, after the fixture's seed, so reloads keep what the app saved. */
async function changeSeed(
  page: Page,
  name: string,
  change: string,
  arg?: unknown,
) {
  await page.addInitScript(
    ({ key, name, change, arg }) => {
      if (sessionStorage.getItem(name)) return;
      sessionStorage.setItem(name, "true");
      const state = JSON.parse(localStorage.getItem(key) ?? "{}");
      new Function("state", "arg", change)(state, arg);
      localStorage.setItem(key, JSON.stringify(state));
    },
    { key: STATE_KEY, name, change, arg },
  );
}

Given("an entry is running on Atlas Development", async ({ page }) => {
  await changeSeed(
    page,
    "keyboard-focus-timer",
    `const now = Date.now();
     const d = new Date();
     const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
     state.timers = [{ _id: "timer-1", startedAt: now - 20 * 60000, localDate: today,
       projectId: "p-atlas", taskId: "t-atlas-dev", note: "Pairing on the export",
       accumulatedDurationMs: 0 }];`,
  );
});

Given("one more half hour completes my week", async ({ page }) => {
  // Today holds 3:30. The week's target sits on today alone, at 4:00.
  await changeSeed(
    page,
    "keyboard-focus-target",
    `const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
     const targets = Object.fromEntries(days.map((day) => [day, 0]));
     targets[days[new Date().getDay()]] = 4 * 3600000;
     state.userPreferences = { ...state.userPreferences, weeklyCapacityTargets: targets };`,
  );
});

Given(
  "a synced item {string} whose Settle asks",
  async ({ page }, title: string) => {
    // A source that settles, so Settle asks with the dialog.
    const plugin = {
      id: "example",
      version: "1.0.0",
      apiVersion: 3,
      displayName: "Fixture source",
      iconSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
      entrypoint: "dist/plugin.js",
      capabilities: { connector: { settle: true } },
      connectionFields: [],
    };
    const headers = { "access-control-allow-origin": "*" };
    await page.route("**/api/plugins", (route) =>
      route.fulfill({
        headers,
        json: {
          pluginsEnabled: true,
          plugins: [plugin],
          connectionGroups: [{ plugin, enabled: true, connections: [] }],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
      }),
    );
    await page.route("**/connections/fixture/settle-states", (route) =>
      route.fulfill({
        headers,
        json: {
          states: [
            { name: "Active", category: "In Progress", done: false },
            { name: "Resolved", category: "Resolved", done: false },
            { name: "Closed", category: "Completed", done: true },
          ],
        },
      }),
    );
    await changeSeed(
      page,
      "keyboard-focus-synced",
      `state.workItems.push({
         _id: "item-synced", title: arg, source: "example", sourceId: "48213",
         sourceConnectionId: "fixture", sourceConnectionLabel: "Fixture",
         sourceProjectName: "Atlas", sourceWorkItemType: "Bug",
         sourceStatusKey: "active", sourceStatusLabel: "Active",
         workflowStateId: "doing", status: "active", priority: 2,
         projectId: "p-atlas", taskId: "t-atlas-dev", createdAt: 1, updatedAt: 1 });`,
      title,
    );
  },
);

/* ── Backlog ─────────────────────────────────────────────────── */

function backlogRow(page: Page, title: string) {
  return page
    .getByRole("main")
    .locator("[data-work-item-id]", {
      has: page.locator(".backlog-item-title", { hasText: title }),
    })
    .first();
}

When("I open the backlog item {string}", async ({ page }, title: string) => {
  await page.goto(`/backlog/${ITEM_IDS[title]}`);
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible({ timeout: 15_000 });
});

When(
  "I rename the item to {string} with Enter",
  async ({ page }, title: string) => {
    await page.locator("main h1").first().click();
    const field = page.getByRole("textbox", { name: "Title" });
    await expect(field).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    await expect(field).toHaveCount(0);
  },
);

Then("focus is on the item's title", async ({ page }) => {
  await expect(page.locator("main h1 button")).toBeFocused();
});

Then(
  "the backlog item {string} is still open and active",
  async ({ page }, title: string) => {
    await expect(
      page.getByRole("heading", { name: title, level: 1 }),
    ).toBeVisible();
    // Settle on a manual item archives it, and its page says so.
    await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/backlog\/item-notes/);
  },
);

When("I open the Backlog page for keyboard work", async ({ page }) => {
  await page.goto("/backlog");
  await expect(backlogRow(page, "Fix the login form")).toBeVisible({
    timeout: 15_000,
  });
});

When("I focus the Backlog row {string}", async ({ page }, title: string) => {
  if (!page.url().endsWith("/backlog")) {
    await page.goto("/backlog");
  }
  const row = backlogRow(page, title);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.focus();
});

Then(
  "focus is on the Backlog row {string}",
  async ({ page }, title: string) => {
    await expect(backlogRow(page, title)).toBeFocused();
  },
);

Then(
  "the open menu highlights {string} and checks it",
  async ({ page }, name: string) => {
    const item = page.getByRole("menuitemradio", { name });
    await expect(item).toBeFocused();
    await expect(item).toHaveAttribute("aria-checked", "true");
  },
);

When(
  "I type {string} in the open menu and press Enter",
  async ({ page }, text: string) => {
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  },
);

Then(
  "the Backlog row {string} shows the priority {string}",
  async ({ page }, title: string, priority: string) => {
    await expect(page.getByRole("menu")).toHaveCount(0);
    const levels: Record<string, number> = {
      Urgent: 1,
      High: 2,
      Medium: 3,
      Low: 4,
    };
    await expect
      .poll(() =>
        page.evaluate(
          ({ key, id }) =>
            JSON.parse(localStorage.getItem(key) ?? "{}").workItems.find(
              (item: { _id: string }) => item._id === id,
            )?.priority,
          { key: STATE_KEY, id: ITEM_IDS[title] },
        ),
      )
      .toBe(levels[priority]);
  },
);

Then(
  "the Backlog row {string} is in the {string} group",
  async ({ page }, title: string, group: string) => {
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(
      page
        .locator(`section[aria-label="${group}"]`)
        .locator("[data-work-item-id]", {
          has: page.locator(".backlog-item-title", { hasText: title }),
        }),
    ).toBeVisible();
  },
);

Then("the Backlog has no row {string}", async ({ page }, title: string) => {
  await expect(backlogRow(page, title)).toHaveCount(0);
});

When(
  "I create the backlog item {string} from the Backlog page",
  async ({ page }, title: string) => {
    await page.goto("/backlog");
    await expect(backlogRow(page, "Fix the login form")).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: "New backlog item" })
      .first()
      .click();
    const composer = page.getByRole("dialog", { name: "New backlog item" });
    await composer.getByLabel("Item").fill(title);
    await composer.getByLabel("Item").press("Enter");
    await expect(composer).toHaveCount(0);
  },
);

/* ── Time ────────────────────────────────────────────────────── */

function entryRow(page: Page, note: string) {
  return page
    .getByRole("main")
    .locator("tr[data-entry-id]", { hasText: note })
    .first();
}

When("I open today's Day view for keyboard work", async ({ page }) => {
  await page.goto("/time/today");
  await expect(entryRow(page, "Standup notes")).toBeVisible({
    timeout: 15_000,
  });
  // Keys from the page itself, as after a click on empty space.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
});

When(
  "I create an entry of {string} with the note {string} from the open editor",
  async ({ page }, hours: string, note: string) => {
    const editor = timeEntryEditor(page);
    await expect(editor).toBeVisible();
    await editor.getByLabel("Hours").fill(hours);
    await editor.getByLabel("Note").fill(note);
    await editor.getByLabel("Note").press("Enter");
    await expect(editor).toHaveCount(0);
  },
);

Then(
  "focus is on today's entry row {string}",
  async ({ page }, note: string) => {
    await expect(entryRow(page, note)).toBeFocused();
  },
);

When(
  "I open the running entry from the dock and press Stop",
  async ({ page }) => {
    await page.getByRole("button", { name: "Edit the running entry" }).click();
    const editor = page.getByRole("dialog", { name: "Edit time entry" });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(editor).toHaveCount(0);
  },
);

Then("focus is on the dock's Start button", async ({ page }) => {
  await expect(
    page
      .getByRole("region", { name: "Timer" })
      .getByRole("button", { name: "Start", exact: true }),
  ).toBeFocused();
});

When("I open the running entry's row and press Stop", async ({ page }) => {
  const row = entryRow(page, "Pairing on the export");
  await row.dblclick();
  const editor = timeEntryEditor(page);
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(editor).toHaveCount(0);
});

When(
  "I move today's entry {string} to yesterday from its menu",
  async ({ page }, note: string) => {
    await entryRow(page, note).click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Move to/ }).click();
    const dialog = page.getByRole("dialog", { name: "Move time entry" });
    await expect(dialog).toBeVisible();
    // The calendar opens on the entry's day: the day before it is yesterday.
    await dialog.locator('[aria-selected="true"] button').focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(entryRow(page, note)).toHaveCount(0);
  },
);

Then("Ajour asks whether to commit the complete week", async ({ page }) => {
  await expect(
    page.getByRole("alertdialog", { name: "Week complete" }),
  ).toBeVisible();
});

When(
  "I open the editor's Project or task menu with the keyboard",
  async ({ page }) => {
    const button = timeEntryEditor(page).getByRole("button", {
      name: "Project or task",
    });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByPlaceholder(/^Search .*\.\.\.$/)).toBeFocused();
  },
);

Then("the task menu highlights {string}", async ({ page }, name: string) => {
  await expect(
    page.locator('[cmdk-item][data-selected="true"]'),
  ).toHaveAttribute("aria-label", new RegExp(`^${name}\\b`));
});

Then(
  "the editor's Project or task reads {string}",
  async ({ page }, label: string) => {
    await expect(
      timeEntryEditor(page).getByRole("button", { name: "Project or task" }),
    ).toHaveText(label);
  },
);

Then(
  "Recent tasks lists {string} in {string} and {string} in {string}",
  async ({ page }, firstTask, firstProject, secondTask, secondProject) => {
    const recent = page.locator("[cmdk-group]", {
      has: page.locator("[cmdk-group-heading]", { hasText: "Recent tasks" }),
    });
    for (const [task, project] of [
      [firstTask, firstProject],
      [secondTask, secondProject],
    ]) {
      await expect(
        recent.getByRole("option", { name: `${task}, ${project}` }),
      ).toBeVisible();
      await expect(
        recent
          .getByRole("option", { name: `${task}, ${project}` })
          .getByText(project, { exact: true }),
      ).toBeVisible();
    }
  },
);

Then("focus is on the {string} link", async ({ page }, name: string) => {
  await expect(page.getByRole("link", { name })).toBeFocused();
});

Then("focus is on today's first entry row", async ({ page }) => {
  await expect(
    page.getByRole("main").locator("tr[data-entry-id]").first(),
  ).toBeFocused();
});

When("I focus the sidebar row {string}", async ({ page }, title: string) => {
  const row = page
    .getByRole("navigation", { name: "Primary navigation" })
    .locator("[data-backlog-item-id]", {
      has: page.locator("[data-row-title]", { hasText: title }),
    });
  await row.focus();
  await expect(row).toBeFocused();
});

When(
  "I type {string} in the open editor's Hours",
  async ({ page }, hours: string) => {
    await timeEntryEditor(page).getByLabel("Hours").fill(hours);
  },
);

When(
  "I double-click the open editor's {string} button",
  async ({ page }, name: string) => {
    await timeEntryEditor(page)
      .getByRole("button", { name, exact: true })
      .dblclick();
  },
);

Then("no entry editor opens", async ({ page }) => {
  // Long enough for a second click's editor to open.
  await page.waitForTimeout(300);
  await expect(timeEntryEditor(page)).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "New time entry" }),
  ).toHaveCount(0);
});

When(
  "I double-click Continue on today's entry row {string}",
  async ({ page }, note: string) => {
    await entryRow(page, note)
      .getByRole("button", { name: /^Continue/ })
      .dblclick();
  },
);

Then(
  "today's entry row {string} is running",
  async ({ page }, note: string) => {
    await expect(
      entryRow(page, note).getByRole("button", { name: /^Stop/ }),
    ).toBeVisible();
  },
);

When(
  "I open an entry from the Week Grid for keyboard work",
  async ({ page }) => {
    await page.goto("/time/today?view=week");
    const grid = page.getByRole("radio", { name: "Grid" });
    if (await grid.count()) await grid.click();
    const cell = page.locator("[data-grid-cell]", {
      hasText: /\d:\d\d/,
    });
    await expect(cell.first()).toBeVisible({ timeout: 15_000 });
    await cell.first().click();
    await expect(timeEntryEditor(page)).toBeVisible();
  },
);

When("I focus another cell of the Week Grid", async ({ page }) => {
  await page.locator("[data-grid-cell]").last().focus();
});

Then("the entry on Atlas Development is still running", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Edit the running entry" }),
  ).toBeVisible();
});

/* ── Projects ────────────────────────────────────────────────── */

const newProjectComposer = (page: Page) =>
  page.getByRole("dialog", { name: "New project" });

When("I open the Projects page for keyboard work", async ({ page }) => {
  await page.goto("/projects");
  await expect(
    page.getByRole("main").getByText("Harbor mobile").first(),
  ).toBeVisible({ timeout: 15_000 });
});

When("I click {string} twice", async ({ page }, name: string) => {
  const button = page.getByRole("button", { name }).first();
  await button.click();
  await expect(newProjectComposer(page)).toBeVisible();
  await button.click();
});

When("I click {string} once", async ({ page }, name: string) => {
  await page.getByRole("button", { name }).first().click();
  await expect(newProjectComposer(page)).toBeVisible();
});

When("I click the page behind the composer", async ({ page }) => {
  // The page's empty space below the list takes no action.
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width / 3, viewport.height - 40);
});

Then(
  "focus is in the New project composer's {string} field",
  async ({ page }, name: string) => {
    await expect(
      newProjectComposer(page).getByRole("textbox", { name }),
    ).toBeFocused();
  },
);

Then("the New project composer is still open", async ({ page }) => {
  await expect(newProjectComposer(page)).toBeVisible();
});

/* ── Settle ──────────────────────────────────────────────────── */

Then("the Settle dialog has focus on its State", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Settle" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "State" })).toBeFocused();
});
