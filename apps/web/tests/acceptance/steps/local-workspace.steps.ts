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
              projectId: "project-acceptance",
              taskId: "task-second",
              createdAt: startedAt - 2_000,
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
  await expect(
    page.getByRole("button", { name: "Open primary navigation" }),
  ).toContainText("Time");
});

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

  await page.goto("/settings/plugins");

  const installButton = page.getByRole("button", {
    name: "Install connector",
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
  await page.getByRole("link", { name: "Configure Example" }).click();
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
  await expect(page.getByText("No connector plugins installed")).toBeVisible();
});

Then("Outlook Calendar is not offered", async ({ page }) => {
  await expect(page.getByText("Outlook Calendar")).toHaveCount(0);
});

Then("the connector plugin is reported as installed", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
  await expect(page.getByText("Example 1.2.3 installed.")).toBeVisible();
  await expect(page.getByText("Version 1.2.3")).toBeVisible();
});

Then("I can open the connector plugin configuration", async ({ page }) => {
  await page.getByRole("link", { name: "Configure Example" }).click();

  await expect(page).toHaveURL(/\/settings\/plugins\/example$/);
  await expect(page.getByRole("heading", { name: "Example" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add a connection" }),
  ).toBeVisible();
});

When("I open the connector plugin configuration", async ({ page }) => {
  await page.getByRole("link", { name: "Configure Example" }).click();
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
    page.getByRole("link", { name: "Configure Example" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Return to the catalog" }),
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
