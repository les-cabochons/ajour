import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

async function mockEmptyConnectorOverview(page: Page) {
  await page.route("http://127.0.0.1:8787/api/connectors", async (route) => {
    await route.fulfill({
      json: {
        pluginsEnabled: true,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: {
        "access-control-allow-origin": "*",
      },
    });
  });
}

Given("I have no saved Ajour workspace", async ({ page }) => {
  await mockEmptyConnectorOverview(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

Given(
  "I have no saved Ajour workspace, even after a reload",
  async ({ page }) => {
    await mockEmptyConnectorOverview(page);
    // Clear storage on the first load only, so a reload keeps what the app saved.
    await page.addInitScript(() => {
      const clearedKey = "ajour.acceptance.storage-cleared";
      if (window.sessionStorage.getItem(clearedKey)) {
        return;
      }

      window.localStorage.clear();
      window.sessionStorage.clear();
      window.sessionStorage.setItem(clearedKey, "true");
    });
  },
);

Given(
  "I have two saved entries with a timer running on the first",
  async ({ page }) => {
    await page.route("http://127.0.0.1:8787/api/connectors", async (route) => {
      await route.fulfill({
        json: {
          pluginsEnabled: true,
          plugins: [],
          connectionGroups: [],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
        headers: {
          "access-control-allow-origin": "*",
        },
      });
    });
    await page.addInitScript(() => {
      const now = new Date();
      const localDate = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      const startedAt = Date.now() - 60_000;

      window.localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({
          projects: [
            {
              _id: "project-acceptance",
              name: "Acceptance Project",
              displayName: "Acceptance Project",
              color: "#1f7667",
              icon: { kind: "preset", name: "dot" },
              status: "active",
              tasks: [
                {
                  _id: "task-first",
                  name: "First task",
                  status: "active",
                  createdAt: startedAt - 1_000,
                },
                {
                  _id: "task-second",
                  name: "Second task",
                  status: "active",
                  createdAt: startedAt - 1_000,
                },
              ],
            },
          ],
          timers: [
            {
              _id: "timer-first",
              startedAt,
              localDate,
              projectId: "project-acceptance",
              taskId: "task-first",
              note: "First entry",
              accumulatedDurationMs: 60_000,
              entryId: "entry-first",
            },
          ],
          timesheetEntries: [
            {
              _id: "entry-first",
              localDate,
              projectId: "project-acceptance",
              taskId: "task-first",
              label: "First task",
              note: "First entry",
              durationMs: 60_000,
              sourceBlockIds: [],
              committedAt: startedAt - 1_000,
            },
            {
              _id: "entry-second",
              localDate,
              projectId: "project-acceptance",
              taskId: "task-second",
              label: "Second task",
              note: "Second entry",
              durationMs: 300_000,
              sourceBlockIds: [],
              committedAt: startedAt - 500,
            },
          ],
          workItems: [
            {
              _id: "work-item-acceptance",
              title: "Backlog switch item",
              status: "active",
              source: "manual",
              priority: 1,
              projectId: "project-acceptance",
              taskId: "task-second",
              createdAt: startedAt - 2_000,
            },
            {
              _id: "work-item-child-acceptance",
              title: "Backlog child item",
              status: "active",
              source: "manual",
              parentWorkItemId: "work-item-acceptance",
              projectId: "project-acceptance",
              taskId: "task-second",
              createdAt: startedAt - 1_900,
            },
            {
              _id: "work-item-second-root",
              title: "Backlog second root",
              status: "active",
              source: "manual",
              priority: 2,
              projectId: "project-acceptance",
              taskId: "task-second",
              createdAt: startedAt - 1_800,
            },
          ],
          updatedAt: startedAt,
        }),
      );
    });
    await page.goto("/time/today");
  },
);
Given("I have projects with searchable tasks", async ({ page }) => {
  await mockEmptyConnectorOverview(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        projects: [
          {
            _id: "project-aaa",
            name: "aaa xyz",
            displayName: "aaa xyz",
            code: "AAA",
            color: "#1f7667",
            icon: { kind: "preset", name: "dot" },
            status: "active",
            tasks: [
              {
                _id: "task-111",
                name: "111 000",
                status: "active",
                createdAt: 1,
                billable: true,
              },
              {
                _id: "task-222-aaa",
                name: "222 000",
                status: "active",
                createdAt: 2,
                billable: true,
              },
            ],
          },
          {
            _id: "project-bbb",
            name: "bbb zyx",
            displayName: "bbb zyx",
            code: "BBB",
            color: "#ec7a43",
            icon: { kind: "preset", name: "dot" },
            status: "active",
            tasks: [
              {
                _id: "task-222-bbb",
                name: "222 000",
                status: "active",
                createdAt: 3,
                billable: false,
              },
              {
                _id: "task-333",
                name: "333 000",
                status: "active",
                createdAt: 4,
                billable: true,
              },
            ],
          },
        ],
      }),
    );
  });
});

When("I open today's time workspace", async ({ page }) => {
  await page.goto("/time/today");
});

When("I open today's new-entry workspace", async ({ page }) => {
  await page.goto("/time/today?entry=new");
});

When("I narrow the app below the expanded sidebar width", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
});

When("I widen the app back to a desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

When("I collapse the app sidebar with its button", async ({ page }) => {
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
});

When("I reload the app", async ({ page }) => {
  await page.reload();
});

When("I press the sidebar shortcut", async ({ page }) => {
  // The app picks Cmd or Ctrl from the user agent, which the Desktop Chrome
  // device sets to Windows whatever the host is.
  const isMac = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.userAgent),
  );
  await page.keyboard.press(isMac ? "Meta+b" : "Control+b");
});

When("I press the {string} key", async ({ page }, key: string) => {
  await page.keyboard.press(key);
});

When("I type {string} in the entry note", async ({ page }, text: string) => {
  // Typing key by key sends the keydown events that shortcuts listen for.
  await page
    .getByRole("complementary", { name: "Time entry editor" })
    .getByLabel("Note")
    .pressSequentially(text);
});

When(
  "I search the shortcut overlay for {string}",
  async ({ page }, query: string) => {
    await page
      .getByRole("dialog", { name: "Keyboard shortcuts" })
      .getByRole("searchbox", { name: "Search shortcuts" })
      .fill(query);
  },
);

When("I open Time from the app sidebar", async ({ page }) => {
  const timeLink = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Time" });
  await timeLink.focus();
  await timeLink.press("Enter");
});

When("I open Settings directly", async ({ page }) => {
  await page.goto("/settings");
});

When("I open Settings from the desktop sidebar", async ({ page }) => {
  const settingsLink = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" });
  await settingsLink.focus();
  await settingsLink.press("Enter");
});

When("I open Plugins from the Settings navigation", async ({ page }) => {
  const pluginsLink = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Plugins" });
  await pluginsLink.click();
  await expect(page).toHaveURL(/\/settings\/plugins$/);
  await expect(pluginsLink).toHaveAttribute("aria-current", "page");
});

When("I open the Projects workspace", async ({ page }) => {
  await page.goto("/projects");
});

When("I open project {string}", async ({ page }, project: string) => {
  await page.goto("/projects");
  await page
    .getByRole("navigation", { name: "Projects" })
    .getByRole("link", { name: project })
    .click();
  await expect(page.getByRole("heading", { name: project })).toBeVisible();
});

When(
  "I rename task {string} to {string} and press Escape",
  async ({ page }, task: string, name: string) => {
    await page.getByText(task, { exact: true }).click();
    const editor = page.getByRole("complementary", { name: "Task editor" });
    await editor.getByRole("textbox", { name: "Name" }).fill(name);
    await editor.getByRole("textbox", { name: "Name" }).press("Escape");
    await expect(editor).toBeHidden();
  },
);

When(
  "I rename task {string} to {string} and save",
  async ({ page }, task: string, name: string) => {
    await page.getByText(task, { exact: true }).click();
    const editor = page.getByRole("complementary", { name: "Task editor" });
    await editor.getByRole("textbox", { name: "Name" }).fill(name);
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toBeHidden();
  },
);

When("I open the Backlog workspace", async ({ page }) => {
  await page.goto("/backlog");
});

When("I open the command palette", async ({ page }) => {
  // The app picks Cmd or Ctrl from the user agent, like the sidebar shortcut.
  const isMac = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.userAgent),
  );
  await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
});

When(
  "I search the command palette for {string}",
  async ({ page }, query: string) => {
    await page
      .getByRole("dialog", { name: "Command palette" })
      .getByRole("combobox", { name: "Search commands" })
      .fill(query);
  },
);

When(
  "I choose {string} in the command palette",
  async ({ page }, label: string) => {
    await page
      .getByRole("dialog", { name: "Command palette" })
      .getByRole("option")
      .filter({ hasText: label })
      .first()
      .click();
  },
);

Then(
  "a running entry uses project {string} and task {string}",
  async ({ page }, projectId: string, taskId: string) => {
    await expect
      .poll(async () => {
        const state = await page.evaluate(() =>
          JSON.parse(
            window.localStorage.getItem("ajour.local-state.v2") ?? "null",
          ),
        );
        return state?.timers?.[0];
      })
      .toMatchObject({ projectId, taskId });
  },
);

When(
  "I create project {string} in the project form",
  async ({ page }, name: string) => {
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByRole("textbox", { name: "Full name" }).fill(name);
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(dialog).toBeHidden();
  },
);

Then("project {string} is open", async ({ page }, name: string) => {
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

Then("the project lists task {string}", async ({ page }, task: string) => {
  await expect(
    page.getByRole("row").filter({ hasText: task }).first(),
  ).toBeVisible();
});

When("I continue the second entry", async ({ page }) => {
  const secondEntryRow = page
    .getByRole("row")
    .filter({ hasText: "Second task" });
  await secondEntryRow.hover();
  await secondEntryRow
    .getByRole("button", { name: "Continue and stop the running entry" })
    .click();
});

When("I start a fresh timer from the Time page", async ({ page }) => {
  await page.goto("/time/today?entry=new");
  const switchTimer = page.getByRole("button", {
    name: "Switch",
    exact: true,
  });
  await expect(switchTimer).toBeEnabled();
  await switchTimer.click();
});

When(
  "I open the running entry from the titlebar on the Backlog page",
  async ({ page }) => {
    await page.goto("/backlog");
    await page.getByRole("button", { name: "Edit the running entry" }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    // The running entry is always today, so its form has no Date field.
    await expect(
      page.getByRole("dialog").getByLabel("Date", { exact: true }),
    ).toHaveCount(0);
  },
);

When(
  "I change its hours to {string} and save",
  async ({ page }, hours: string) => {
    await page.getByRole("textbox", { name: "Hours" }).fill(hours);
    await page.getByRole("button", { name: "Save", exact: true }).click();
  },
);

Then("the running entry keeps running from one hour", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  const state = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("ajour.local-state.v2") ?? "null"),
  );

  expect(state.timers).toEqual([
    expect.objectContaining({
      _id: "timer-first",
      accumulatedDurationMs: 60 * 60_000,
    }),
  ]);
  // The resumed entry keeps its saved time until the running entry stops.
  expect(
    state.timesheetEntries.find(
      (entry: { _id: string }) => entry._id === "entry-first",
    )?.durationMs,
  ).toBe(60_000);
});

When(
  "I open a new entry from the titlebar on the Backlog page",
  async ({ page }) => {
    await page.goto("/backlog");
    await page.getByRole("button", { name: "Create time entry" }).click();
  },
);

Then("Save waits for hours or Start", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("Enter hours, or press Start")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Start", exact: true }),
  ).toBeEnabled();
});

When("I press Enter in Hours", async ({ page }) => {
  await page.getByRole("textbox", { name: "Hours" }).press("Enter");
});

Then("a running entry starts today with no time counted", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Edit the running entry" }),
  ).toBeVisible();
  const { state, today } = await page.evaluate(() => {
    const now = new Date();
    return {
      state: JSON.parse(
        window.localStorage.getItem("ajour.local-state.v2") ?? "null",
      ),
      today: [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-"),
    };
  });

  expect(state.timers).toEqual([
    expect.objectContaining({ localDate: today, accumulatedDurationMs: 0 }),
  ]);
  expect(state.timesheetEntries).toEqual([]);
});

When("I start the timer on the Backlog item", async ({ page }) => {
  await page.goto("/backlog");
  const backlogRow = page
    .getByRole("row")
    .filter({ hasText: "Backlog switch item" });
  await backlogRow.hover();
  const switchTimer = backlogRow.getByRole("button", {
    name: "Switch to Backlog switch item",
  });
  await expect(switchTimer).toBeEnabled();
  await switchTimer.click();
});

When("I delete the Backlog item with its subitem", async ({ page }) => {
  await page.goto("/backlog");
  await page
    .getByRole("row")
    .filter({ hasText: "Backlog switch item" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete (and 1 subitem)" }).click();
});

Then("the Backlog item is gone and a toast offers Undo", async ({ page }) => {
  // Delete happens at once, without a confirmation dialog.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Backlog switch item" }),
  ).toHaveCount(0);
  const toasts = page.getByRole("region", { name: "Notifications" });
  await expect(toasts).toContainText("Backlog item and 1 subitem deleted");
  await expect(toasts.getByRole("button", { name: "Undo" })).toBeVisible();
});

Then("the Backlog item and its subitem are back in place", async ({ page }) => {
  await expect(
    page.getByRole("row").filter({ hasText: "Backlog switch item" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const state = JSON.parse(
          window.localStorage.getItem("ajour.local-state.v2") ?? "null",
        );
        return state?.workItems?.map(
          (workItem: { _id: string }) => workItem._id,
        );
      }),
    )
    .toEqual([
      "work-item-acceptance",
      "work-item-child-acceptance",
      "work-item-second-root",
    ]);
});

When("I start the timer on the Backlog item from mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/backlog");
  const switchTimer = page.getByRole("button", {
    name: "Switch to Backlog switch item",
  });
  await expect(switchTimer).toBeEnabled();
  await expect(switchTimer).toContainText("Switch");
  await switchTimer.click();
});

When("I open the new time-entry project and task picker", async ({ page }) => {
  await page.getByRole("button", { name: "Create time entry" }).click();
  await page.getByRole("button", { name: "Project or task" }).click();
});

Then(
  "the picker initially lists projects without expanding their tasks",
  async ({ page }) => {
    await expect(
      page.getByText("[AAA] aaa xyz", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("[BBB] bbb zyx", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("111 000", { exact: true })).toHaveCount(0);
    await expect(page.getByText("222 000", { exact: true })).toHaveCount(0);
  },
);

When(
  "I browse the tasks in project {string}",
  async ({ page }, project: string) => {
    await page.getByText(`[AAA] ${project}`, { exact: true }).click();
  },
);

Then("the picker lists that project's tasks", async ({ page }) => {
  await expect(
    page.getByText("Use project without a task", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("111 000", { exact: true })).toBeVisible();
  await expect(page.getByText("222 000", { exact: true })).toBeVisible();
  await expect(page.getByText("333 000", { exact: true })).toHaveCount(0);
});

When("I return to the project list", async ({ page }) => {
  await page.getByText("Back to projects", { exact: true }).click();
});

When(
  "I search for project and task {string}",
  async ({ page }, query: string) => {
    await page.getByPlaceholder("Search projects and tasks...").fill(query);
  },
);

When("I select the matching project and task", async ({ page }) => {
  await expect(page.getByText("222 000", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
});

Then("the combined project and task are selected", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Project or task" }),
  ).toContainText("[AAA] aaa xyz · 222 000");
});

When("I save one hour to the selected project and task", async ({ page }) => {
  await page.getByRole("textbox", { name: "Hours" }).fill("01:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
});

Then(
  "the time entry uses project {string} and task {string}",
  async ({ page }, project: string, task: string) => {
    await expect(
      page.getByText(project, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(task, { exact: true }).first()).toBeVisible();
  },
);

Then("the entry editor is open", async ({ page }) => {
  await expect(
    page.getByRole("complementary", { name: "Time entry editor" }),
  ).toBeVisible();
});

Then("the entry note reads {string}", async ({ page }, text: string) => {
  await expect(
    page
      .getByRole("complementary", { name: "Time entry editor" })
      .getByLabel("Note"),
  ).toHaveValue(text);
  // "?" typed in the note must not open the shortcut overlay.
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toHaveCount(0);
});

Then("the Backlog workspace is open", async ({ page }) => {
  await expect(page).toHaveURL(/\/backlog$/);
});

Then(
  "the shortcut overlay lists only {string}",
  async ({ page }, label: string) => {
    const items = page
      .getByRole("dialog", { name: "Keyboard shortcuts" })
      .getByRole("listitem");
    await expect(items).toHaveCount(1);
    await expect(items).toContainText(label);
  },
);

Then("the Time workspace is visible", async ({ page }) => {
  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  await expect(primaryNavigation).toBeVisible();
  await expect(
    primaryNavigation.getByRole("link", { name: "Time" }),
  ).toHaveAttribute("aria-current", "page");
  // The Time page itself has rendered, so its own shortcuts (such as N opening
  // the side panel instead of the titlebar popover) are registered.
  await expect(
    page.getByRole("button", { name: "Submit week" }).first(),
  ).toBeVisible();
});

Then("the desktop sidebar owns the full left edge", async ({ page }) => {
  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const workspaceTitlebar = page.locator(".ajour-nav");

  const [sidebarBox, titlebarBox, viewport] = await Promise.all([
    primaryNavigation.boundingBox(),
    workspaceTitlebar.boundingBox(),
    page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })),
  ]);

  expect(sidebarBox).not.toBeNull();
  expect(titlebarBox).not.toBeNull();
  expect(sidebarBox?.x).toBe(0);
  expect(sidebarBox?.y).toBe(0);
  expect(sidebarBox?.height).toBe(viewport.height);
  expect(titlebarBox?.x).toBe(sidebarBox?.width);
  expect(titlebarBox?.width).toBe(viewport.width - (sidebarBox?.width ?? 0));
});

Then("the day surfaces stretch around centered content", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });

  const workspace = page.locator(".ajour-app-workspace");
  const content = page.locator(".app-content-shell");
  const dayViewer = page.locator(".time-page-stack .day-viewer");
  const dayViewerStrip = dayViewer.locator(".day-viewer-strip");
  const entriesShell = page.locator(
    ".time-page-stack .entries-table-scroll-shell-time",
  );
  const entriesHeader = entriesShell.locator(".entries-table-header-table");
  const [
    workspaceBox,
    contentBox,
    dayViewerBox,
    dayViewerStripBox,
    entriesHeaderBox,
  ] = await Promise.all([
    workspace.boundingBox(),
    content.boundingBox(),
    dayViewer.boundingBox(),
    dayViewerStrip.boundingBox(),
    entriesHeader.boundingBox(),
  ]);

  expect(workspaceBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(dayViewerBox).not.toBeNull();
  expect(dayViewerStripBox).not.toBeNull();
  expect(entriesHeaderBox).not.toBeNull();
  expect(contentBox?.x).toBe(workspaceBox?.x);
  expect(contentBox?.width).toBe(workspaceBox?.width);
  expect(dayViewerBox?.x).toBe(contentBox?.x);
  expect(dayViewerBox?.width).toBe(contentBox?.width);
  expect(entriesHeaderBox?.x).toBe(contentBox?.x);
  expect(entriesHeaderBox?.width).toBe(contentBox?.width);

  const stripLeftInset = (dayViewerStripBox?.x ?? 0) - (contentBox?.x ?? 0);
  const stripRightInset =
    (contentBox?.x ?? 0) +
    (contentBox?.width ?? 0) -
    ((dayViewerStripBox?.x ?? 0) + (dayViewerStripBox?.width ?? 0));
  expect(dayViewerStripBox?.width).toBe(1440);
  expect(Math.abs(stripLeftInset - stripRightInset)).toBeLessThanOrEqual(1);

  const projectHeadingPadding = await entriesHeader
    .locator(".entry-project-heading")
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingLeft),
    );
  expect(projectHeadingPadding).toBeCloseTo(stripLeftInset + 16, 0);

  await expect(dayViewer).toHaveCSS("border-left-width", "0px");
  await expect(dayViewer).toHaveCSS("border-right-width", "0px");
  await expect(entriesShell).toHaveCSS("border-left-width", "0px");
  await expect(entriesShell).toHaveCSS("border-right-width", "0px");
  await expect(entriesShell).toHaveCSS("border-bottom-width", "0px");
});

Then("the Backlog workspace fills the available page", async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 900 });

  const content = page.locator(".app-content-shell");
  const pageContainer = page.locator(
    ".page-container:has(> .backlog-page-stack)",
  );
  const backlogShell = page.locator(".entries-table-scroll-shell-backlog");
  const backlogHeader = backlogShell.locator(".entries-table-header-table");
  const backlogHeadingLabel = backlogHeader
    .locator(".backlog-task-heading-content > span")
    .first();
  const [
    contentBox,
    pageContainerBox,
    backlogShellBox,
    backlogHeaderBox,
    backlogHeadingLabelBox,
  ] = await Promise.all([
    content.boundingBox(),
    pageContainer.boundingBox(),
    backlogShell.boundingBox(),
    backlogHeader.boundingBox(),
    backlogHeadingLabel.boundingBox(),
  ]);

  expect(contentBox).not.toBeNull();
  expect(pageContainerBox).not.toBeNull();
  expect(backlogShellBox).not.toBeNull();
  expect(backlogHeaderBox).not.toBeNull();
  expect(backlogHeadingLabelBox).not.toBeNull();
  expect(pageContainerBox?.x).toBe(contentBox?.x);
  expect(pageContainerBox?.width).toBe(contentBox?.width);
  expect(backlogShellBox?.x).toBe(contentBox?.x);
  expect(backlogShellBox?.width).toBe(contentBox?.width);
  expect(backlogShellBox?.height).toBe(contentBox?.height);
  expect(backlogHeaderBox?.x).toBe(contentBox?.x);
  expect(backlogHeaderBox?.width).toBe(contentBox?.width);

  const centeredContentGutter = Math.max(
    0,
    ((contentBox?.width ?? 0) - 1440) / 2,
  );
  expect(backlogHeadingLabelBox?.x).toBeCloseTo(
    (contentBox?.x ?? 0) + centeredContentGutter + 16,
    0,
  );
  await expect(backlogShell).toHaveCSS("border-left-width", "0px");
  await expect(backlogShell).toHaveCSS("border-right-width", "0px");
  await expect(backlogShell).toHaveCSS("border-bottom-width", "0px");
  await expect(backlogShell).toHaveCSS("border-radius", "0px");
});

Then("hidden Backlog columns do not reserve mobile width", async ({ page }) => {
  const columnWidths = await page
    .locator(".entries-table-body-table")
    .evaluate((table) => {
      const priorityColumn = table.querySelector<HTMLElement>(
        ".backlog-priority-column",
      );
      const statusColumn = table.querySelector<HTMLElement>(
        ".backlog-status-column",
      );

      return {
        priority: priorityColumn?.getBoundingClientRect().width ?? -1,
        status: statusColumn?.getBoundingClientRect().width ?? -1,
      };
    });

  expect(columnWidths.priority).toBeLessThanOrEqual(0.5);
  expect(columnWidths.status).toBeLessThanOrEqual(0.5);
});

Then(
  "expanded and dragged Backlog rows keep their centered columns",
  async ({ page }) => {
    const rootRow = page.locator(
      'tr[data-backlog-root-id="work-item-acceptance"]:not(.entry-edit-row):not(.backlog-row-child)',
    );
    const rootTaskCell = rootRow.locator(".backlog-task-cell");
    const rootTaskCellBefore = await rootTaskCell.boundingBox();
    expect(rootTaskCellBefore).not.toBeNull();

    const rootTitle = rootRow.getByText("Backlog switch item", { exact: true });
    const rootTitleBox = await rootTitle.boundingBox();
    expect(rootTitleBox).not.toBeNull();

    const dragX = (rootTitleBox?.x ?? 0) + 8;
    const dragY = (rootTitleBox?.y ?? 0) + (rootTitleBox?.height ?? 0) / 2;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 2, dragY + 14, { steps: 5 });

    const dragPreview = page.locator(".backlog-task-drag-preview");
    await expect(dragPreview).toBeVisible();
    const dragPreviewTaskCell = await dragPreview
      .locator(".backlog-task-drag-preview-cell")
      .boundingBox();
    const dragPreviewTitle = await dragPreview
      .getByText("Backlog switch item", { exact: true })
      .boundingBox();
    expect(dragPreviewTaskCell).not.toBeNull();
    expect(dragPreviewTitle).not.toBeNull();
    expect(
      Math.abs((dragPreviewTaskCell?.x ?? 0) - (rootTaskCellBefore?.x ?? 0)),
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs((dragPreviewTitle?.x ?? 0) - (rootTitleBox?.x ?? 0)),
    ).toBeLessThanOrEqual(1.5);
    await page.mouse.up();

    await page.waitForTimeout(100);
    await rootRow
      .getByRole("button", { name: "Show subitems for Backlog switch item" })
      .click();

    const childRow = page
      .locator("tr.backlog-row-child")
      .filter({ hasText: "Backlog child item" });
    await expect(childRow).toBeVisible();
    const [rootTaskCellAfter, childTaskCell] = await Promise.all([
      rootTaskCell.boundingBox(),
      childRow.locator(".backlog-task-cell").boundingBox(),
    ]);
    expect(rootTaskCellAfter).not.toBeNull();
    expect(childTaskCell).not.toBeNull();
    expect(
      Math.abs((rootTaskCellAfter?.x ?? 0) - (rootTaskCellBefore?.x ?? 0)),
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs((childTaskCell?.x ?? 0) - (rootTaskCellBefore?.x ?? 0)),
    ).toBeLessThanOrEqual(1.5);
  },
);

async function expectAppSidebarWidth(page: Page, width: number) {
  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  await expect(primaryNavigation).toBeVisible();
  // The width animates, so wait for it to settle.
  await expect
    .poll(async () => (await primaryNavigation.boundingBox())?.width)
    .toBe(width);
}

Then("the app sidebar is expanded", async ({ page }) => {
  await expectAppSidebarWidth(page, 200);
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByText("Time", { exact: true }),
  ).toBeVisible();
});

Then("the app sidebar is an icon rail", async ({ page }) => {
  await expectAppSidebarWidth(page, 52);
  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  await expect(
    primaryNavigation.getByRole("link", { name: "Time" }),
  ).toBeVisible();
  await expect(
    primaryNavigation.getByText("Time", { exact: true }),
  ).toBeHidden();
});

Then(
  "the Settings pages are listed beside the app sidebar",
  async ({ page }) => {
    const primaryNavigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    const settingsNavigation = page.getByRole("navigation", {
      name: "Settings sections",
    });
    await expect(primaryNavigation).toBeVisible();
    await expect(
      primaryNavigation.getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(settingsNavigation).toBeVisible();
    await expect(
      settingsNavigation.getByRole("link", { name: "General" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);

    const [primaryNavigationBox, settingsNavigationBox] = await Promise.all([
      primaryNavigation.boundingBox(),
      settingsNavigation.boundingBox(),
    ]);
    expect(settingsNavigationBox?.x).toBe(
      (primaryNavigationBox?.x ?? 0) + (primaryNavigationBox?.width ?? 0),
    );
  },
);

Then(
  "the Projects sidebar remains expanded and left-aligned beside primary navigation",
  async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
    const projectsNavigation = page.getByRole("navigation", {
      name: "Projects",
    });
    await expect(projectsNavigation).toBeVisible();
    await expect(
      projectsNavigation.getByRole("link", { name: /aaa xyz/ }),
    ).toBeVisible();

    const [primaryNavigationBox, projectsNavigationBox] = await Promise.all([
      page
        .getByRole("navigation", { name: "Primary navigation" })
        .boundingBox(),
      projectsNavigation.boundingBox(),
    ]);
    expect(primaryNavigationBox).not.toBeNull();
    expect(projectsNavigationBox).not.toBeNull();
    expect(projectsNavigationBox?.x).toBe(
      (primaryNavigationBox?.x ?? 0) + (primaryNavigationBox?.width ?? 0),
    );
  },
);

Then(
  "the Projects navigation remains available as a compact rail",
  async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    const projectsNavigation = page.getByRole("navigation", {
      name: "Projects",
    });
    await expectAppSidebarWidth(page, 52);
    await expect(projectsNavigation).toBeVisible();
    const projectsNavigationBox = await projectsNavigation.boundingBox();
    expect(projectsNavigationBox?.width).toBe(48);
    await expect(
      projectsNavigation.getByRole("link", { name: "aaa xyz" }),
    ).toBeVisible();
    await expect(
      projectsNavigation.getByRole("button", { name: "New project" }),
    ).toBeVisible();
  },
);

Then("the timesheet can be submitted", async ({ page }) => {
  const submitTimesheet = page.getByRole("button", {
    name: "Submit week",
  });

  await expect(submitTimesheet).toBeVisible();
  await expect(submitTimesheet).toBeEnabled();
});

Then(
  "the first timer is saved and the second timer is running",
  async ({ page }) => {
    const state = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("ajour.local-state.v2") ?? "null"),
    );

    expect(state.timers).toHaveLength(1);
    expect(state.timers[0]).toMatchObject({
      entryId: "entry-second",
      accumulatedDurationMs: 300_000,
    });
    expect(
      state.timesheetEntries.find(
        (entry: { _id: string }) => entry._id === "entry-first",
      )?.durationMs,
    ).toBeGreaterThanOrEqual(120_000);
  },
);

Then(
  "the first timer is saved and the fresh timer is running",
  async ({ page }) => {
    const state = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("ajour.local-state.v2") ?? "null"),
    );

    expect(state.timers).toHaveLength(1);
    expect(state.timers[0]).toMatchObject({
      accumulatedDurationMs: 0,
    });
    expect(state.timers[0].entryId).toBeUndefined();
    expect(
      state.timesheetEntries.find(
        (entry: { _id: string }) => entry._id === "entry-first",
      )?.durationMs,
    ).toBeGreaterThanOrEqual(120_000);
  },
);

Then(
  "the first timer is saved and the Backlog timer is running",
  async ({ page }) => {
    const state = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("ajour.local-state.v2") ?? "null"),
    );

    expect(state.timers).toHaveLength(1);
    expect(state.timers[0]).toMatchObject({
      workItemId: "work-item-acceptance",
      projectId: "project-acceptance",
      taskId: "task-second",
      accumulatedDurationMs: 0,
    });
    expect(
      state.timesheetEntries.find(
        (entry: { _id: string }) => entry._id === "entry-first",
      )?.durationMs,
    ).toBeGreaterThanOrEqual(120_000);
  },
);

When("I install a packaged connector from settings", async ({ page }) => {
  const plugin = {
    id: "example",
    version: "1.2.3",
    apiVersion: 1,
    displayName: "Example",
    description: "Example connector used by the acceptance test.",
    iconSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
    entrypoint: "dist/plugin.js",
    connectionFields: [
      {
        id: "url",
        label: "URL",
        type: "url",
        required: true,
        secret: false,
      },
    ],
  };

  const installResponse = {
    plugin,
    replaced: false,
    overview: {
      pluginsEnabled: true,
      plugins: [plugin],
      connectionGroups: [{ plugin, enabled: true, connections: [] }],
      totalPendingImportCount: 0,
      totalSelectedImportCount: 0,
    },
  };
  let currentOverview: typeof installResponse.overview = {
    ...installResponse.overview,
    plugins: [],
    connectionGroups: [],
  };
  await page.exposeFunction("acceptanceInstallPlugin", async () => {
    currentOverview = installResponse.overview;
    return installResponse;
  });
  await page.exposeFunction("acceptanceUninstallPlugin", async () => {
    currentOverview = {
      ...installResponse.overview,
      plugins: [],
      connectionGroups: [],
    };
    return { pluginId: plugin.id, overview: currentOverview };
  });
  await page.route("http://127.0.0.1:8787/api/connectors", async (route) => {
    await route.fulfill({
      json: currentOverview,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.addInitScript((response) => {
    const desktopWindow = window as typeof window & {
      acceptanceInstallPlugin: () => Promise<typeof response>;
      acceptanceUninstallPlugin: () => Promise<{
        pluginId: string;
        overview: typeof response.overview;
      }>;
      ajourDesktop: {
        bootstrapLocalState: null;
        runtime: { developmentBuild: false };
        installConnectorPlugin: () => Promise<typeof response>;
        uninstallConnectorPlugin: () => Promise<{
          pluginId: string;
          overview: typeof response.overview;
        }>;
      };
    };
    desktopWindow.ajourDesktop = {
      bootstrapLocalState: null,
      runtime: { developmentBuild: false },
      installConnectorPlugin: () => desktopWindow.acceptanceInstallPlugin(),
      uninstallConnectorPlugin: () => desktopWindow.acceptanceUninstallPlugin(),
    };
  }, installResponse);

  await page.route(
    "http://127.0.0.1:8787/api/connectors/example/activation",
    async (route) => {
      const payload = route.request().postDataJSON() as { enabled: boolean };
      currentOverview = {
        ...currentOverview,
        connectionGroups: currentOverview.connectionGroups.map((group) => ({
          ...group,
          enabled: payload.enabled,
        })),
      };
      await route.fulfill({
        json: currentOverview,
        headers: {
          "access-control-allow-origin": "*",
        },
      });
    },
  );

  await page.goto("/time/today?entry=new");
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Plugins" })
    .click();

  const installButton = page.getByRole("button", {
    name: "Install from file",
  });
  await expect(installButton).toBeVisible();

  await installButton.click();
});

When(
  "I deactivate the connector plugin with the keyboard",
  async ({ page }) => {
    const deactivateSwitch = page.getByRole("switch", {
      name: "Deactivate Example",
    });
    await deactivateSwitch.focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("switch", { name: "Activate Example" }),
    ).toHaveAttribute("aria-checked", "false");
  },
);

Then("the inactive connector plugin remains configurable", async ({ page }) => {
  await page.getByRole("link", { name: "View Example" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/example$/);
  await expect(page.getByText("This plugin is inactive.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add a connection" }),
  ).toBeVisible();
});

When("I open the plugins catalog", async ({ page }) => {
  await page.goto("/settings/plugins");
});

Then("the empty plugin catalog is explained", async ({ page }) => {
  await expect(page.getByText("No matching plugins")).toBeVisible();
});

Then("Outlook Calendar is not offered", async ({ page }) => {
  await expect(page.getByText("Outlook Calendar")).toHaveCount(0);
});

Then("the connector plugin is reported as installed", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
  await expect(page.getByText("Example 1.2.3 installed.")).toBeVisible();
  await expect(page.getByText("v1.2.3", { exact: true })).toBeVisible();
});

Then("I can open the connector plugin configuration", async ({ page }) => {
  await page.getByRole("link", { name: "View Example" }).click();

  await expect(page).toHaveURL(/\/settings\/plugins\/example$/);
  await expect(page.getByRole("heading", { name: "Example" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add a connection" }),
  ).toBeVisible();
});

When("I open the connector plugin configuration", async ({ page }) => {
  await page.getByRole("link", { name: "View Example" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/example$/);
});

When("I uninstall the connector plugin", async ({ page }) => {
  await page.getByRole("button", { name: "Uninstall", exact: true }).click();
  await page.getByRole("button", { name: "Uninstall plugin" }).click();
});

Then("the connector plugin is reported as uninstalled", async ({ page }) => {
  await expect(page).toHaveURL(/\/settings\/plugins\/example$/);
  await expect(
    page.getByText(
      "Example uninstalled. Imported backlog items were preserved.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "View Example" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "All plugins" })).toBeVisible();
});

When("I open development plugin settings", async ({ page }) => {
  await page.addInitScript(() => {
    const initialSettings = {
      available: true,
      directories: ["/workspace/connectors/example"],
    };
    const selectedSettings = {
      available: true,
      directories: ["/workspace/connectors/selected"],
    };
    const desktopWindow = window as typeof window & {
      ajourDesktop: {
        bootstrapLocalState: null;
        runtime: { developmentBuild: true };
        getDevelopmentPluginSettings: () => Promise<typeof initialSettings>;
        selectDevelopmentPluginDirectory: () => Promise<
          typeof selectedSettings
        >;
        clearDevelopmentPluginDirectories: () => Promise<
          typeof initialSettings
        >;
      };
    };
    desktopWindow.ajourDesktop = {
      bootstrapLocalState: null,
      runtime: { developmentBuild: true },
      getDevelopmentPluginSettings: async () => initialSettings,
      selectDevelopmentPluginDirectory: async () => selectedSettings,
      clearDevelopmentPluginDirectories: async () => initialSettings,
    };
  });
  await page.goto("/settings/debug");
});

Then("I can choose a development plugin directory", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Development plugin directory" }),
  ).toBeVisible();
  await expect(page.getByText("/workspace/connectors/example")).toBeVisible();

  await page.getByRole("button", { name: "Choose directory" }).click();
  await expect(page.getByText("/workspace/connectors/selected")).toBeVisible();
});

Given("I have a saved entry with an unrounded duration", async ({ page }) => {
  await mockEmptyConnectorOverview(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        projects: [],
        timers: [],
        workItems: [],
        timesheetEntries: [
          {
            _id: "entry-precision",
            localDate: "2026-10-05",
            label: "Original note",
            note: "Original note",
            durationMs: 75_123,
            sourceBlockIds: [],
            committedAt: 1,
          },
        ],
        updatedAt: 1,
      }),
    );
  });
});

When(
  "I edit the entry note in the {string} editor",
  async ({ page }, editor: string) => {
    if (editor === "mobile")
      await page.setViewportSize({ width: 390, height: 844 });
    if (editor === "Week") {
      await page.goto("/time/2026-10-05?view=week&entry=entry-precision");
    } else {
      await page.goto("/time/2026-10-05");
      await page
        .locator(".time-entry-row")
        .filter({ hasText: "Original note" })
        .click();
    }
    await page.getByLabel("Note", { exact: true }).fill("Changed note");
    await page.getByRole("button", { name: "Save", exact: true }).click();
  },
);

Then(
  "the edited note is saved with the exact original duration",
  async ({ page }) => {
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const state = JSON.parse(
            window.localStorage.getItem("ajour.local-state.v2") ?? "null",
          );
          return state?.timesheetEntries.find(
            (entry: { _id: string }) => entry._id === "entry-precision",
          );
        }),
      )
      .toMatchObject({ note: "Changed note", durationMs: 75_123 });
  },
);

Given("I have a week of saved entries", async ({ page }) => {
  await mockEmptyConnectorOverview(page);
  await page.addInitScript(() => {
    const hour = 60 * 60 * 1000;
    const entry = (
      _id: string,
      localDate: string,
      taskId: string,
      durationMs: number,
      note: string | undefined,
      committedAt: number,
    ) => ({
      _id,
      localDate,
      projectId: "project-atlas",
      taskId,
      label: "",
      note,
      durationMs,
      sourceBlockIds: [],
      committedAt,
    });
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
              {
                _id: "task-review",
                name: "Code review",
                status: "active",
                createdAt: 1,
              },
            ],
          },
        ],
        timers: [],
        workItems: [],
        timesheetEntries: [
          entry("mon-dev-1", "2026-10-05", "task-dev", hour, "Login form", 1),
          entry("mon-dev-2", "2026-10-05", "task-dev", 2 * hour, "API", 2),
          entry("mon-review", "2026-10-05", "task-review", hour, undefined, 3),
          entry("tue-dev", "2026-10-06", "task-dev", hour, "Login form", 4),
        ],
        updatedAt: 1,
      }),
    );
  });
});

When("I open the submit page from the Week header", async ({ page }) => {
  await page.goto("/time/2026-10-05?view=week");
  await page
    .getByRole("region", { name: "Week" })
    .getByRole("button", { name: "Submit week" })
    .click();
  await expect(page).toHaveURL(/\/time\/2026-10-05\/submit/);
});

When("I open the submit page from the narrow Day header", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 });
  await page.goto("/time/2026-10-05");
  await page.getByRole("button", { name: "Submit week" }).click();
  await expect(page).toHaveURL(/\/time\/2026-10-05\/submit/);
});

When("I open a Week link in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 });
  await page.goto("/time/2026-10-05?view=week");
});

Then("the Day view notes that Week needs a wider window", async ({ page }) => {
  await expect(page.getByRole("status")).toHaveText(
    "Week needs a wider window. Showing Day instead.",
  );
  await expect(page.getByRole("region", { name: "Week" })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /API/ })).toBeVisible();
  // The view menu is not offered, so it cannot offer Week.
  await expect(page.getByRole("button", { name: /^Time view:/ })).toHaveCount(
    0,
  );
});

When("I widen the window to a desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
});

Then("the Week view is visible", async ({ page }) => {
  await expect(page.getByRole("region", { name: "Week" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
});

When(
  `I long press Monday's "API" entry on a narrow touch screen`,
  async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 860 });
    await page.goto("/time/2026-10-05");
    const row = page.getByRole("row", { name: /API/ });
    const box = await row.boundingBox();
    if (!box) throw new Error("The API entry row is not rendered");

    // Playwright has no long press, so the step sends raw touch events.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    const point = { x: box.x + 40, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    // Base UI opens the menu after 500ms of holding still.
    await expect(page.getByRole("menu")).toBeVisible();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  },
);

Then("the entry's action menu is open", async ({ page }) => {
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Edit",
    "Continue",
    "Duplicate",
    "Duplicate to…",
    "Move to…",
    "Delete",
  ]);
  // Releasing the long press does not also open the row.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

When(
  "I choose {string} from the action menu",
  async ({ page }, label: string) => {
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  },
);

Then("the entry editor opens in a full-width dialog", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Edit time entry" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Note")).toHaveValue("API");
  // The dialog keeps an 8px margin on each side of the 420px window. Polling
  // waits for the open animation, which scales the dialog up from 95%.
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(404);
});

Then("the submit page lists the week's entries", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Submit week of Oct 5 to Oct 11" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark 4 entries as submitted" }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Include / })).toHaveCount(
    3,
  );
});

Then("the submit page merges Monday's task entries", async ({ page }) => {
  const monday = page.getByRole("region", { name: "Monday, Oct 5" });
  await expect(monday.getByRole("checkbox", { name: /^Include / })).toHaveCount(
    2,
  );
  await expect(
    monday.getByRole("button", { name: "Copy hours: 3.00" }),
  ).toHaveText("3:00");
});

Then(
  "copying the merged line gives decimal hours and merged comments",
  async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const monday = page.getByRole("region", { name: "Monday, Oct 5" });
    const readClipboard = () =>
      page.evaluate(() => navigator.clipboard.readText());

    await monday.getByRole("button", { name: "Copy hours: 3.00" }).click();
    await expect.poll(readClipboard).toBe("3.00");
    await monday
      .getByRole("button", { name: "Copy comments: API | Login form" })
      .click();
    await expect.poll(readClipboard).toBe("API | Login form");
  },
);

When("I drop Tuesday from the submission", async ({ page }) => {
  await page
    .getByRole("group", { name: "Days to submit" })
    .getByRole("button", { name: "Tuesday, Oct 6" })
    .click();
});

When(
  "I mark the selected entries as submitted under the target",
  async ({ page }) => {
    await page
      .getByRole("button", { name: "Mark 3 entries as submitted" })
      .click();
    await page.getByRole("button", { name: "Submit anyway" }).click();
  },
);

Then("only Monday's entries are submitted", async ({ page }) => {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const state = JSON.parse(
          window.localStorage.getItem("ajour.local-state.v2") ?? "null",
        );
        return state?.timesheetEntries
          .filter((entry: { submittedAt?: number }) => entry.submittedAt)
          .map((entry: { _id: string }) => entry._id)
          .sort();
      }),
    )
    .toEqual(["mon-dev-1", "mon-dev-2", "mon-review"]);
});

Then("the submit page shows the week as partly submitted", async ({ page }) => {
  const result = page.getByRole("status");
  await expect(result).toContainText("Partly submitted on");
  await expect(result).toContainText("3 entries · 4:00");
  // Tuesday stays out of the selection after the others are marked.
  await expect(
    page.getByRole("button", { name: "Mark 0 entries as submitted" }),
  ).toBeDisabled();
});

function narrowPrimaryNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

When("I open today's time workspace in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 844 });
  await page.goto("/time/today");
});

Then("the narrow view shows no sidebars", async ({ page }) => {
  await expect(page.locator(".ajour-app-navigation-sidebar")).toHaveCount(0);
  await expect(page.locator(".ajour-section-sidebar")).toHaveCount(0);
  const timeLink = narrowPrimaryNavigation(page).getByRole("link", {
    name: "Time",
  });
  await expect(timeLink).toHaveAttribute("aria-current", "page");
  await expect(timeLink).toContainText("Time");
});

When("I switch to Backlog from the titlebar", async ({ page }) => {
  await narrowPrimaryNavigation(page)
    .getByRole("link", { name: "Backlog" })
    .click();
});

Then(
  "Backlog is the active section of the titlebar switcher",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/backlog$/);
    const navigation = narrowPrimaryNavigation(page);
    await expect(navigation.getByRole("link", { name: "Backlog" })).toHaveText(
      "Backlog",
    );
    // The inactive section shows only its icon.
    await expect(navigation.getByRole("link", { name: "Time" })).toHaveText("");
  },
);

When("I open Settings from the titlebar cog", async ({ page }) => {
  await page.getByRole("link", { name: "Settings", exact: true }).click();
});

Then("Settings opens on its list of pages", async ({ page }) => {
  await expect(page).toHaveURL(/\/settings$/);
  const settingsList = page.getByRole("navigation", {
    name: "Settings sections",
  });
  for (const label of [
    "General",
    "Plugins",
    "Backlog",
    "Projects",
    "Time entries",
    "Sync review",
  ]) {
    await expect(settingsList.getByRole("link", { name: label })).toBeVisible();
  }
});

When(
  "I open {string} from the Settings list",
  async ({ page }, label: string) => {
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: label })
      .click();
  },
);

When("I go back to {string}", async ({ page }, label: string) => {
  await page.getByRole("link", { name: `Back to ${label}` }).click();
  await expect(page).toHaveURL(
    label === "Settings" ? /\/settings$/ : /\/projects$/,
  );
});

Then("the Projects list fills the page", async ({ page }) => {
  await expect(page).toHaveURL(/\/projects$/);
  const projectsList = page.getByRole("navigation", { name: "Projects" });
  await expect(
    projectsList.getByRole("link", { name: "aaa xyz" }),
  ).toBeVisible();
  await expect(
    projectsList.getByRole("link", { name: "Archived projects" }),
  ).toBeVisible();
  const listBox = await projectsList.boundingBox();
  expect(listBox?.width).toBe(page.viewportSize()?.width);
});

When(
  "I open project {string} from the Projects list",
  async ({ page }, name: string) => {
    await page
      .getByRole("navigation", { name: "Projects" })
      .getByRole("link", { name })
      .click();
    await expect(page).toHaveURL(/\/projects\/project-/);
    await expect(
      page.getByRole("navigation", { name: "Projects" }),
    ).toHaveCount(0);
  },
);

When(
  "I open project import and export from the Projects list",
  async ({ page }) => {
    await page.getByRole("link", { name: "Import and export" }).click();
  },
);

Then(
  "the project import and export page leads back to Projects",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/settings\/projects$/);
    await expect(
      page.getByRole("heading", { name: "Import and export projects" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to Projects" }),
    ).toBeVisible();
  },
);

When("I delete Monday's {string} entry", async ({ page }, note: string) => {
  await page.goto("/time/2026-10-05");
  await page.getByText(note, { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
});

Then("the entry is gone and a toast offers Undo", async ({ page }) => {
  // Delete happens at once, without a confirmation dialog.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    page.locator(".time-entry-row").filter({ hasText: "API" }),
  ).toHaveCount(0);
  const toasts = page.getByRole("region", { name: "Notifications" });
  await expect(toasts).toContainText("Entry deleted");
  await expect(toasts.getByRole("button", { name: "Undo" })).toBeVisible();
});

When("I undo with the toast button", async ({ page }) => {
  await page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Undo" })
    .click();
});

When("I undo with the Cmd+Z shortcut", async ({ page }) => {
  await page.locator("body").press("ControlOrMeta+z");
});

Then(
  "the {string} entry is back exactly as it was",
  async ({ page }, note: string) => {
    await expect(
      page.locator(".time-entry-row").filter({ hasText: note }),
    ).toBeVisible();
    // Same record in the same position: duration, note and order are unchanged.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const state = JSON.parse(
            window.localStorage.getItem("ajour.local-state.v2") ?? "null",
          );
          return state?.timesheetEntries;
        }),
      )
      .toEqual([
        expect.objectContaining({ _id: "mon-dev-1" }),
        expect.objectContaining({
          _id: "mon-dev-2",
          localDate: "2026-10-05",
          taskId: "task-dev",
          note: "API",
          durationMs: 2 * 60 * 60 * 1000,
          committedAt: 2,
        }),
        expect.objectContaining({ _id: "mon-review" }),
        expect.objectContaining({ _id: "tue-dev" }),
      ]);
    await expect(
      page.getByRole("region", { name: "Notifications" }),
    ).not.toContainText("Entry deleted");
  },
);

/** A Week Grid cell, named "<task>, <weekday>, <hours>" for screen readers. */
function weekGridCell(page: Page, task: string, day: string) {
  return page
    .getByRole("region", { name: "Week" })
    .getByRole("button", { name: new RegExp(`^${task}, ${day},`) });
}

When("I open the Week Grid", async ({ page }) => {
  // Grid is the default Week layout.
  await page.goto("/time/2026-10-05?view=week");
});

Then(
  "the {string} cell on {word} shows {string}",
  async ({ page }, task: string, day: string, hours: string) => {
    // "3:00 ×2" renders as the total followed by the count.
    await expect(weekGridCell(page, task, day)).toHaveText(
      hours.replace(" ", ""),
    );
  },
);

When(
  "I type {string} in the {string} cell on {word} and press Tab",
  async ({ page }, hours: string, task: string, day: string) => {
    await weekGridCell(page, task, day).focus();
    // A digit on a focused cell starts editing it in place with that digit.
    await page.keyboard.type(hours);
    await page.keyboard.press("Tab");
  },
);

Then(
  "the {string} cell on {word} is being edited",
  async ({ page }, task: string, day: string) => {
    await expect(
      page.getByLabel(`Hours for ${task} on ${day}`, { exact: true }),
    ).toBeFocused();
  },
);

When(
  "I clear the {string} cell on {word}",
  async ({ page }, task: string, day: string) => {
    await page.keyboard.press("Escape");
    await weekGridCell(page, task, day).dblclick();
    const input = page.getByLabel(`Hours for ${task} on ${day}`, {
      exact: true,
    });
    await input.fill("");
    await input.press("Enter");
  },
);

Then(
  "the {string} cell on {word} is empty and a toast offers Undo",
  async ({ page }, task: string, day: string) => {
    await expect(weekGridCell(page, task, day)).toHaveText("—");
    const toasts = page.getByRole("region", { name: "Notifications" });
    await expect(toasts).toContainText("Entry deleted");
    await expect(toasts.getByRole("button", { name: "Undo" })).toBeVisible();
  },
);
