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

Given("I have no saved TimeTracker workspace", async ({ page }) => {
  await mockEmptyConnectorOverview(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

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
        "timetracker.local-state.v2",
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
              title: "Backlog switch task",
              status: "active",
              source: "manual",
              priority: 1,
              projectId: "project-acceptance",
              taskId: "task-second",
              createdAt: startedAt - 2_000,
            },
            {
              _id: "work-item-child-acceptance",
              title: "Backlog child task",
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
      "timetracker.local-state.v2",
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

When("I resize the app to a compact desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
});

When("I open the legacy Rules route", async ({ page }) => {
  await page.goto("/rules");
});

When("I open Settings from the desktop sidebar", async ({ page }) => {
  const settingsLink = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" });
  await settingsLink.focus();
  await settingsLink.press("Enter");
});

When("I leave Settings from the sidebar", async ({ page }) => {
  const backButton = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Back" });
  await backButton.focus();
  await backButton.press("Enter");
});

When("I open Plugins from the Settings navigation", async ({ page }) => {
  const pluginsLink = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Plugins" });
  await pluginsLink.click();
  await expect(page).toHaveURL(/\/settings\/plugins$/);
  await expect(pluginsLink).toHaveAttribute("aria-current", "page");
});

When("I go back in the browser history", async ({ page }) => {
  await page.goBack();
});

When("I open the Projects workspace", async ({ page }) => {
  await page.goto("/projects");
});

When("I start the timer on the second entry", async ({ page }) => {
  const secondEntryRow = page
    .getByRole("row")
    .filter({ hasText: "Second task" });
  await secondEntryRow.hover();
  await secondEntryRow
    .getByRole("button", { name: "Switch timer to this entry" })
    .click();
});

When("I start a fresh timer from the Time page", async ({ page }) => {
  await page.goto("/time/today?entry=new");
  const switchTimer = page.getByRole("button", {
    name: "Switch timer",
    exact: true,
  });
  await expect(switchTimer).toBeEnabled();
  await switchTimer.click();
});

When("I start the timer on the Backlog task", async ({ page }) => {
  await page.goto("/backlog");
  const backlogRow = page
    .getByRole("row")
    .filter({ hasText: "Backlog switch task" });
  await backlogRow.hover();
  const switchTimer = backlogRow.getByRole("button", {
    name: "Switch timer to Backlog switch task",
  });
  await expect(switchTimer).toBeEnabled();
  await switchTimer.click();
});

When("I start the timer on the Backlog task from mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/backlog");
  const switchTimer = page.getByRole("button", {
    name: "Switch timer to Backlog switch task",
  });
  await expect(switchTimer).toBeEnabled();
  await expect(switchTimer).toContainText("Switch Timer");
  await switchTimer.click();
});

When("I open the new time-entry project and task picker", async ({ page }) => {
  await page.getByRole("button", { name: "Create time entry" }).click();
  await page.getByRole("button", { name: "Project or task" }).click();
});

Then(
  "the picker initially lists projects without expanding their tasks",
  async ({ page }) => {
    await expect(page.getByText("[AAA] aaa xyz", { exact: true })).toBeVisible();
    await expect(page.getByText("[BBB] bbb zyx", { exact: true })).toBeVisible();
    await expect(page.getByText("111 000", { exact: true })).toHaveCount(0);
    await expect(page.getByText("222 000", { exact: true })).toHaveCount(0);
  },
);

When("I browse the tasks in project {string}", async ({ page }, project: string) => {
  await page.getByText(`[AAA] ${project}`, { exact: true }).click();
});

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

When("I search for project and task {string}", async ({ page }, query: string) => {
  await page.getByPlaceholder("Search projects and tasks...").fill(query);
});

When("I select the matching project and task", async ({ page }) => {
  await expect(page.getByText("222 000", { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
});

Then("the combined project and task are selected", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Project or task" })).toContainText(
    "[AAA] aaa xyz · 222 000",
  );
});

When("I save one hour to the selected project and task", async ({ page }) => {
  await page.getByRole("textbox", { name: "Hours" }).fill("01:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
});

Then(
  "the time entry uses project {string} and task {string}",
  async ({ page }, project: string, task: string) => {
    await expect(page.getByText(project, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(task, { exact: true }).first()).toBeVisible();
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
});

Then("the desktop sidebar owns the full left edge", async ({ page }) => {
  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const workspaceTitlebar = page.locator(".harday-nav");

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

  const workspace = page.locator(".harday-app-workspace");
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

  const stripLeftInset =
    (dayViewerStripBox?.x ?? 0) - (contentBox?.x ?? 0);
  const stripRightInset =
    (contentBox?.x ?? 0) + (contentBox?.width ?? 0) -
    ((dayViewerStripBox?.x ?? 0) + (dayViewerStripBox?.width ?? 0));
  expect(dayViewerStripBox?.width).toBe(1440);
  expect(Math.abs(stripLeftInset - stripRightInset)).toBeLessThanOrEqual(1);

  const projectHeadingPadding = await entriesHeader
    .locator(".entry-project-heading")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft));
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

Then(
  "hidden Backlog columns do not reserve mobile width",
  async ({ page }) => {
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
  },
);

Then(
  "expanded and dragged Backlog rows keep their centered columns",
  async ({ page }) => {
    const rootRow = page.locator(
      'tr[data-backlog-root-id="work-item-acceptance"]:not(.entry-edit-row):not(.backlog-row-child)',
    );
    const rootTaskCell = rootRow.locator(".backlog-task-cell");
    const rootTaskCellBefore = await rootTaskCell.boundingBox();
    expect(rootTaskCellBefore).not.toBeNull();

    const rootTitle = rootRow.getByText("Backlog switch task", { exact: true });
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
      .getByText("Backlog switch task", { exact: true })
      .boundingBox();
    expect(dragPreviewTaskCell).not.toBeNull();
    expect(dragPreviewTitle).not.toBeNull();
    expect(
      Math.abs(
        (dragPreviewTaskCell?.x ?? 0) - (rootTaskCellBefore?.x ?? 0),
      ),
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs((dragPreviewTitle?.x ?? 0) - (rootTitleBox?.x ?? 0)),
    ).toBeLessThanOrEqual(1.5);
    await page.mouse.up();

    await page.waitForTimeout(100);
    await rootRow
      .getByRole("button", { name: "Show subtasks for Backlog switch task" })
      .click();

    const childRow = page
      .locator("tr.backlog-row-child")
      .filter({ hasText: "Backlog child task" });
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

Then("the Settings sections replace the primary navigation", async ({ page }) => {
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toHaveCount(0);
  const settingsNavigation = page.getByRole("navigation", {
    name: "Settings sections",
  });
  await expect(settingsNavigation).toBeVisible();
  await expect(
    settingsNavigation.getByRole("link", { name: "General" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    settingsNavigation.getByRole("button", { name: "Back" }),
  ).toBeVisible();
});

Then(
  "the Settings navigation remains available as a compact rail",
  async ({ page }) => {
    const settingsNavigation = page.getByRole("navigation", {
      name: "Settings sections",
    });
    const navigationBox = await settingsNavigation.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect(navigationBox?.width).toBe(48);
    await expect(
      settingsNavigation.getByRole("link", { name: "Projects" }),
    ).toBeVisible();
    await expect(
      settingsNavigation.getByRole("button", { name: "Back" }),
    ).toBeVisible();
  },
);

Then("the Time new-entry workspace sidebar is restored", async ({ page }) => {
  await expect(page).toHaveURL(/\/time\/today\?entry=new$/);
  await expect(page.locator(".harday-app-navigation-sidebar")).toBeVisible();
  await expect(
    page.getByText("New time entry", { exact: true }),
  ).toBeVisible();
});

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
    const primaryNavigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    const projectsNavigation = page.getByRole("navigation", {
      name: "Projects",
    });
    await expect(primaryNavigation).toBeVisible();
    await expect(projectsNavigation).toBeVisible();
    const [primaryNavigationBox, projectsNavigationBox] = await Promise.all([
      primaryNavigation.boundingBox(),
      projectsNavigation.boundingBox(),
    ]);
    expect(primaryNavigationBox?.width).toBe(48);
    expect(projectsNavigationBox?.width).toBe(48);
    await expect(
      projectsNavigation.getByRole("link", { name: "aaa xyz" }),
    ).toBeVisible();
    await expect(
      projectsNavigation.getByRole("button", { name: "Project actions" }),
    ).toBeVisible();
  },
);

Then("the timesheet can be submitted", async ({ page }) => {
  const submitTimesheet = page.getByRole("button", {
    name: "Submit timesheet",
  });

  await expect(submitTimesheet).toBeVisible();
  await expect(submitTimesheet).toBeEnabled();
});

Then(
  "the first timer is saved and the second timer is running",
  async ({ page }) => {
    const state = await page.evaluate(() =>
      JSON.parse(
        window.localStorage.getItem("timetracker.local-state.v2") ?? "null",
      ),
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
      JSON.parse(
        window.localStorage.getItem("timetracker.local-state.v2") ?? "null",
      ),
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
      JSON.parse(
        window.localStorage.getItem("timetracker.local-state.v2") ?? "null",
      ),
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
  await page.addInitScript((response) => {
    const desktopWindow = window as typeof window & {
      timetrackerDesktop: {
        bootstrapLocalState: null;
        runtime: { developmentBuild: false };
        installConnectorPlugin: () => Promise<typeof response>;
        uninstallConnectorPlugin: () => Promise<{
          pluginId: string;
          overview: {
            pluginsEnabled: boolean;
            plugins: never[];
            connectionGroups: never[];
            totalPendingImportCount: number;
            totalSelectedImportCount: number;
          };
        }>;
      };
    };
    desktopWindow.timetrackerDesktop = {
      bootstrapLocalState: null,
      runtime: { developmentBuild: false },
      installConnectorPlugin: async () => response,
      uninstallConnectorPlugin: async () => ({
        pluginId: response.plugin.id,
        overview: {
          pluginsEnabled: true,
          plugins: [],
          connectionGroups: [],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
      }),
    };
  }, installResponse);

  await page.route(
    "http://127.0.0.1:8787/api/connectors/example/activation",
    async (route) => {
      const payload = route.request().postDataJSON() as { enabled: boolean };
      await route.fulfill({
        json: {
          ...installResponse.overview,
          connectionGroups: installResponse.overview.connectionGroups.map(
            (group) => ({ ...group, enabled: payload.enabled }),
          ),
        },
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

When("I deactivate the connector plugin with the keyboard", async ({ page }) => {
  const deactivateSwitch = page.getByRole("switch", {
    name: "Deactivate Example",
  });
  await deactivateSwitch.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("switch", { name: "Activate Example" }),
  ).toHaveAttribute("aria-checked", "false");
});

Then("the inactive connector plugin remains configurable", async ({ page }) => {
  await page.getByRole("link", { name: "View Example" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/example$/);
  await expect(page.getByText("This plugin is inactive.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add a connection" }),
  ).toBeVisible();
});

When("I open the former connectors settings route", async ({ page }) => {
  await page.goto("/settings/connectors");
});

When("I open the plugins catalog", async ({ page }) => {
  await page.goto("/settings/plugins");
});

Then("I arrive at the plugins catalog", async ({ page }) => {
  await expect(page).toHaveURL(/\/settings\/plugins$/);
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
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
    page.getByText("Example uninstalled. Imported backlog items were preserved."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View Example" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "All plugins" }),
  ).toBeVisible();
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
      timetrackerDesktop: {
        bootstrapLocalState: null;
        runtime: { developmentBuild: true };
        getDevelopmentPluginSettings: () => Promise<typeof initialSettings>;
        selectDevelopmentPluginDirectory: () => Promise<typeof selectedSettings>;
        clearDevelopmentPluginDirectories: () => Promise<typeof initialSettings>;
      };
    };
    desktopWindow.timetrackerDesktop = {
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
