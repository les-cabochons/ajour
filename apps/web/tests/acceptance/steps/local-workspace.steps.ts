import { expect, type Locator, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { viewSwitcher } from "../../fixtures/sidebar";

const { Given, When, Then } = createBdd();

Given("I have a parent editor close fixture", async ({ page }) => {
  await mockEmptyPluginsOverview(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("editor-close-fixture-ready")) return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("editor-close-fixture-ready", "true");
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        workflowStates: [
          { _id: "doing", name: "In progress", color: "#d97706", createdAt: 1 },
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
            _id: "editor-parent",
            title: "Editor parent",
            source: "manual",
            status: "active",
            workflowStateId: "doing",
            createdAt: 1,
          },
          {
            _id: "editor-child",
            title: "Editor child",
            source: "manual",
            status: "active",
            workflowStateId: "doing",
            parentWorkItemId: "editor-parent",
            createdAt: 1,
          },
        ],
      }),
    );
  });
  // The item page edits in place; the editor panel lives on the Backlog page.
  await page.goto("/backlog?action=edit&target=editor-parent");
  await expect(
    page.getByRole("complementary", { name: "Backlog item editor" }),
  ).toBeVisible();
});
When("I save its editor workflow as Done", async ({ page }) => {
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await editor
    .getByRole("combobox", { name: "Workflow state", exact: true })
    .click();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
});
Given("the parent has a running entry", async ({ page }) => {
  await page.evaluate(async () => {
    const { localStore } = await import("/src/lib/local-store.ts");
    localStore.startTimer({
      workItemId: "editor-parent",
      note: "Done flag fixture",
    });
  });
});
When("I enable Done for In progress in Workflow settings", async ({ page }) => {
  await page.goto("/settings/workflow");
  await page
    .getByRole("checkbox", { name: "Done", exact: true })
    .first()
    .check();
});
Then(
  "its existing items are archived and the running entry is saved",
  async ({ page }) => {
    const readState = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("ajour.local-state.v2")!),
      );
    await expect
      .poll(async () =>
        (await readState()).workItems.map(
          (item: { status: string; workflowStateId: string }) => ({
            status: item.status,
            workflowStateId: item.workflowStateId,
          }),
        ),
      )
      .toEqual([
        { status: "archived", workflowStateId: "doing" },
        { status: "archived", workflowStateId: "doing" },
      ]);
    const saved = await readState();
    expect(saved.timers).toEqual([]);
    expect(saved.timesheetEntries).toEqual([
      expect.objectContaining({
        workItemId: "editor-parent",
        note: "Done flag fixture",
      }),
    ]);
    expect(saved.timesheetEntries[0].durationMs).toBeGreaterThan(0);
    await page.reload();
    expect(
      (await readState()).workItems.every(
        (item: { status: string }) => item.status === "archived",
      ),
    ).toBe(true);
  },
);
Then(
  "the parent editor remains mounted while the subitem choice is pending",
  async ({ page }) => {
    await expect(
      page.getByRole("dialog", {
        name: "Also close its 1 open subitem?",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", {
        name: "Backlog item editor",
        includeHidden: true,
      }),
    ).toHaveCount(1);
  },
);
Then(
  "the confirmed title and description remain saved after undoing the close",
  async ({ page }) => {
    const readParent = () =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("ajour.local-state.v2")!,
        ).workItems.find(
          (item: { _id: string }) => item._id === "editor-parent",
        ),
      );
    expect(await readParent()).toMatchObject({
      title: "Unsaved parent title",
      description: "Unsaved parent description",
      status: "archived",
      workflowStateId: "done",
    });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(readParent).toMatchObject({
      title: "Unsaved parent title",
      description: "Unsaved parent description",
      status: "active",
      workflowStateId: "doing",
    });
  },
);
When("I cancel the parent editor close prompt", async ({ page }) => {
  await page.keyboard.press("Escape");
});
When("I change the parent draft title and description", async ({ page }) => {
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await editor
    .getByPlaceholder("Item name", { exact: true })
    .fill("Unsaved parent title");
  await editor
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Unsaved parent description");
});
When(
  "I interrupt the mixed-field close by {string}",
  async ({ page }, interruption: string) => {
    if (interruption === "dismissing the prompt") {
      await page.keyboard.press("Escape");
    } else {
      await page.evaluate(async () => {
        // Exercise a concurrent local import while the displayed confirmation stays open.
        const { localStore } = await import("/src/lib/local-store.ts");
        localStore.addWorkItem({
          title: "New subitem",
          parentWorkItemId: "editor-parent",
          workflowStateId: "doing",
        });
      });
      await page
        .getByRole("button", { name: "Include subitem", exact: true })
        .click();
    }
  },
);
Then(
  "the parent editor retains every mixed-field draft without saving it",
  async ({ page }) => {
    const editor = page.getByRole("complementary", {
      name: "Backlog item editor",
    });
    await expect(editor).toBeVisible();
    await expect(
      editor.getByPlaceholder("Item name", { exact: true }),
    ).toHaveValue("Unsaved parent title");
    await expect(
      editor.getByRole("textbox", { name: "Description", exact: true }),
    ).toHaveValue("Unsaved parent description");
    await expect(
      editor.getByRole("combobox", { name: "Workflow state", exact: true }),
    ).toHaveValue("Done");
    const parent = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "editor-parent",
      ),
    );
    expect(parent).toMatchObject({
      title: "Editor parent",
      status: "active",
      workflowStateId: "doing",
    });
    expect(parent.description).toBeUndefined();
  },
);
When("I cancel the parent editor draft", async ({ page }) => {
  await page
    .getByRole("complementary", { name: "Backlog item editor" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
});
Then("the parent title and description remain unchanged", async ({ page }) => {
  await expect(
    page.getByRole("complementary", { name: "Backlog item editor" }),
  ).toHaveCount(0);
  const parent = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
      (item: { _id: string }) => item._id === "editor-parent",
    ),
  );
  expect(parent).toMatchObject({
    title: "Editor parent",
    status: "active",
    workflowStateId: "doing",
  });
  expect(parent.description).toBeUndefined();
});
Then(
  "the parent editor retains its Done draft and the item remains active",
  async ({ page }) => {
    const editor = page.getByRole("complementary", {
      name: "Backlog item editor",
    });
    await expect(editor).toBeVisible();
    await expect(
      editor.getByRole("combobox", { name: "Workflow state", exact: true }),
    ).toHaveValue("Done");
    const parent = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "editor-parent",
      ),
    );
    expect(parent).toMatchObject({
      status: "active",
      workflowStateId: "doing",
    });
  },
);
When("I include the child in the editor close", async ({ page }) => {
  await page
    .getByRole("button", { name: "Include subitem", exact: true })
    .click();
});
Then(
  "the editor closes after the parent and child reach Done",
  async ({ page }) => {
    await expect(
      page.getByRole("complementary", { name: "Backlog item editor" }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(
            localStorage.getItem("ajour.local-state.v2")!,
          ).workItems.map(
            (item: { status: string; workflowStateId: string }) => ({
              status: item.status,
              workflowStateId: item.workflowStateId,
            }),
          ),
        ),
      )
      .toEqual([
        { status: "archived", workflowStateId: "done" },
        { status: "archived", workflowStateId: "done" },
      ]);
  },
);

async function mockEmptyPluginsOverview(page: Page) {
  await page.route("http://127.0.0.1:8787/api/plugins", async (route) => {
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
  await mockEmptyPluginsOverview(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

Given(
  "I have no saved Ajour workspace, even after a reload",
  async ({ page }) => {
    await mockEmptyPluginsOverview(page);
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
    await page.route("http://127.0.0.1:8787/api/plugins", async (route) => {
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
  await mockEmptyPluginsOverview(page);
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

When("I narrow the app to the smallest desktop width", async ({ page }) => {
  // DESKTOP_MIN_WIDTH in lib/breakpoints.ts. One pixel less is the narrow view.
  await page.setViewportSize({ width: 768, height: 900 });
});

When("I widen the app back to a desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

When("I hide the app sidebar with its button", async ({ page }) => {
  await page.getByRole("button", { name: "Hide sidebar" }).click();
});

When("I show the app sidebar from the titlebar", async ({ page }) => {
  await page.getByRole("button", { name: "Show sidebar" }).click();
});

When("I start an empty entry from the sidebar", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Start", exact: true })
    .click();
});

Then("the timer dock opens the running entry", async ({ page }) => {
  const dock = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("region", { name: "Running entry" });
  await expect(dock).toContainText("Untitled entry");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

Then("the window title shows the running entry", async ({ page }) => {
  await expect(page).toHaveTitle(/^● 0:00 · Untitled entry — Ajour$/);
});

Then("the running entry floats at the bottom left", async ({ page }) => {
  const dock = page.locator(".ajour-floating-dock-desktop");
  await expect(dock).toContainText("Untitled entry");
  const [box, viewport] = await Promise.all([
    dock.boundingBox(),
    page.evaluate(() => ({ height: window.innerHeight })),
  ]);
  // 16px from the edge, or 8px inside the Settings column.
  expect([8, 16]).toContain(box?.x);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBe(viewport.height - 16);
});

When("I stop the running entry from the floating dock", async ({ page }) => {
  await page
    .locator(".ajour-floating-dock-desktop")
    .getByRole("button", { name: "Stop", exact: true })
    .click();
});

Then("nothing runs and the window title is plain", async ({ page }) => {
  // With the sidebar hidden, the floating dock offers "+" and Start instead.
  const dock = page.locator(".ajour-floating-dock-desktop");
  await expect(
    dock.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await expect(
    dock.getByRole("button", { name: "Create time entry" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Ajour");
});

When("I start an empty entry from the floating dock", async ({ page }) => {
  await page
    .locator(".ajour-floating-dock-desktop")
    .getByRole("button", { name: "Start", exact: true })
    .click();
});

Then("the floating dock opens the running entry", async ({ page }) => {
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
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
  // The keyboard path: Enter opens the view switcher, then chooses Time.
  await viewSwitcher(page).press("Enter");
  await page.getByRole("menuitem", { name: /^Time/ }).press("Enter");
});

When("I open Backlog from the app sidebar", async ({ page }) => {
  await viewSwitcher(page).press("Enter");
  await page.getByRole("menuitem", { name: /^Backlog/ }).press("Enter");
  await expect(page).toHaveURL(/\/backlog$/);
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
  await page.getByRole("link", { name: project, exact: true }).click();
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

function projectProperties(page: Page) {
  return page.getByRole("region", { name: "Properties" });
}

Then("the project page has no actions menu", async ({ page }) => {
  await expect(projectProperties(page)).toBeVisible();
  // Task rows keep their own "…"; the project's menu is gone.
  await expect(
    page.getByRole("button", { name: "Actions for aaa xyz" }),
  ).toHaveCount(0);
});

When(
  "I rename the project to {string} from its title",
  async ({ page }, name: string) => {
    // Enter on the focused title, so the rename works from the keyboard too.
    await page.getByRole("heading", { level: 1 }).getByRole("button").focus();
    await page.keyboard.press("Enter");
    const field = page.getByRole("textbox", { name: "Display name" });
    await field.fill(name);
    await field.press("Enter");
  },
);

When(
  "I set the project code to {string} in its properties",
  async ({ page }, code: string) => {
    await projectProperties(page)
      .getByRole("button", { name: /^Edit code/ })
      .click();
    const field = page.getByRole("textbox", { name: "Code" });
    await field.fill(code);
    await field.press("Enter");
  },
);

Then(
  "project {string} is open with code {string}",
  async ({ page }, name: string, code: string) => {
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
    await expect(
      projectProperties(page).getByRole("button", {
        name: `Edit code, ${code}`,
      }),
    ).toBeVisible();
  },
);

When("I add a task from the New task row", async ({ page }) => {
  await page.getByRole("button", { name: "New task", exact: true }).click();
});

Then("the task editor opens for a new task", async ({ page }) => {
  const editor = page.getByRole("complementary", { name: "Task editor" });
  await expect(editor.getByText("New task", { exact: true })).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Name" })).toBeFocused();
});

When("I archive the project from its properties", async ({ page }) => {
  await projectProperties(page)
    .getByRole("button", { name: "Archive" })
    .click();
});

Then("the project properties offer Restore", async ({ page }) => {
  await expect(
    projectProperties(page).getByRole("button", { name: "Restore" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toHaveCount(0);
});

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

function taskRow(page: Page, task: string) {
  return page.getByRole("row").filter({
    has: page.getByText(task, { exact: true }),
  });
}

async function chooseTaskAction(page: Page, task: string, action: string) {
  await taskRow(page, task)
    .getByText(task, { exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: action }).click();
}

async function readPinnedSlots(page: Page) {
  const state = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("ajour.local-state.v2") ?? "null"),
  );
  return (
    state.projects as {
      name: string;
      tasks: { name: string; pinnedSlot?: string }[];
    }[]
  ).flatMap((project) =>
    project.tasks
      .filter((task) => task.pinnedSlot)
      .map((task) => [project.name, task.name, task.pinnedSlot]),
  );
}

When(
  "I assign key {string} to task {string}",
  async ({ page }, key: string, task: string) => {
    await chooseTaskAction(page, task, "Assign shortcut…");
    const picker = page.getByRole("dialog", { name: "Assign shortcut" });
    await picker
      .getByRole("group", { name: "Number keys" })
      // A taken slot's name reads "3, moves from <task>".
      .getByRole("button", { name: new RegExp(`^${key}(,|$)`) })
      .click();
    await expect(picker).toBeHidden();
    await expect(taskRow(page, task).locator("kbd")).toHaveText(key);
  },
);

When("I clear the key of task {string}", async ({ page }, task: string) => {
  await chooseTaskAction(page, task, "Assign shortcut…");
  await page
    .getByRole("dialog", { name: "Assign shortcut" })
    .getByRole("button", { name: "Clear shortcut" })
    .click();
  await expect(taskRow(page, task).locator("kbd")).toHaveCount(0);
});

Then(
  "key {string} is saved on task {string} only",
  async ({ page }, key: string, task: string) => {
    await expect(taskRow(page, "111 000").locator("kbd")).toHaveCount(0);
    expect(await readPinnedSlots(page)).toEqual([["aaa xyz", task, key]]);
  },
);

When(
  "I set key {string} in the panel of task {string} and save",
  async ({ page }, key: string, task: string) => {
    await page.getByText(task, { exact: true }).click();
    const editor = page.getByRole("complementary", { name: "Task editor" });
    await editor.getByRole("button", { name: /^Shortcut/ }).click();
    await page
      .getByRole("dialog", { name: "Assign shortcut" })
      .getByRole("button", { name: new RegExp(`^${key}(,|$)`) })
      .click();
    // The panel's draft holds the slot until Save.
    expect(await readPinnedSlots(page)).toEqual([]);
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toBeHidden();
  },
);

When(
  "I pick key {string} in the shortcut picker",
  async ({ page }, key: string) => {
    const picker = page.getByRole("dialog", { name: "Assign shortcut" });
    await picker
      .getByRole("button", { name: new RegExp(`^${key}(,|$)`) })
      .click();
    await expect(picker).toBeHidden();
  },
);

Then(
  "only task {string} holds key {string}",
  async ({ page }, task: string, key: string) => {
    await expect
      .poll(async () =>
        (await readPinnedSlots(page)).map(([, name, slot]) => [name, slot]),
      )
      .toEqual([[task, key]]);
  },
);

Then("no task is pinned to key {string}", async ({ page }, key: string) => {
  expect(
    (await readPinnedSlots(page)).filter(([, , slot]) => slot === key),
  ).toEqual([]);
});

Then("a new entry opens for {string}", async ({ page }, label: string) => {
  await expect(
    page
      .getByRole("dialog")
      .filter({ hasText: "New time entry" })
      .getByRole("button", { name: "Project or task" }),
  ).toContainText(label);
});

Then("the new entry form is closed", async ({ page }) => {
  await expect(
    page.getByRole("dialog").filter({ hasText: "New time entry" }),
  ).toHaveCount(0);
});

Then(
  "a running entry counts on task {string} of project {string}",
  async ({ page }, task: string, project: string) => {
    await expect(page.getByText(`AAA · ${task}`)).toBeVisible();
    const state = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("ajour.local-state.v2") ?? "null"),
    );
    const projectRecord = state.projects.find(
      (candidate: { name: string }) => candidate.name === project,
    );
    const taskRecord = projectRecord.tasks.find(
      (candidate: { name: string }) => candidate.name === task,
    );
    expect(state.timers).toEqual([
      expect.objectContaining({
        projectId: projectRecord._id,
        taskId: taskRecord._id,
      }),
    ]);
  },
);

When(
  "I press {string} on the entry editor's Cancel button",
  async ({ page }, key: string) => {
    const cancel = page
      .getByRole("complementary", { name: "Time entry editor" })
      .getByRole("button", { name: "Cancel" });
    await cancel.focus();
    await cancel.press(key);
  },
);

Then("the entry editor has no project or task", async ({ page }) => {
  const editor = page.getByRole("complementary", {
    name: "Time entry editor",
  });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Project or task" }),
  ).not.toContainText("111 000");
  await expect(page).not.toHaveURL(/task=/);
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

/** The quoted ids in a step's list, such as `"entry-first", "entry-second"`. */
function quotedIds(list: string) {
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

Then(
  "the running row shows Stop and no row has an actions button",
  async ({ page }) => {
    const runningRow = page.locator(".time-entry-row[data-running-entry]");
    await runningRow.hover();
    await expect(
      runningRow.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await expect(
      runningRow.getByRole("button", { name: /^Continue/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Entry actions" }),
    ).toHaveCount(0);
  },
);

When("I open this week's Days view", async ({ page }) => {
  await page.goto("/time/today?view=week");
  await page.getByRole("button", { name: "Days", exact: true }).click();
});

Then(
  /^today's Days cards read entries (.+)$/,
  async ({ page }, list: string) => {
    // The running card shows no task, so cards are read by the entry id they
    // carry. A running card carries the id of the entry it continues.
    await expect
      .poll(() =>
        page
          .locator(".weekly-days-column.is-today .weekly-entry-card")
          .evaluateAll((cards) =>
            cards.map((card) => card.getAttribute("data-entry-id")),
          ),
      )
      .toEqual(quotedIds(list));
    await expect(
      page.getByRole("button", { name: "Entry actions" }),
    ).toHaveCount(0);
  },
);

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
  "I open the running entry from the timer dock on the Backlog page",
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
  // The editor closed. The timer dock keeps its own Stop.
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  const backlogRow = page.locator('[data-work-item-id="work-item-acceptance"]');
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
    .locator('[data-work-item-id="work-item-acceptance"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete (and 1 subitem)" }).click();
});

Then("the Backlog item is gone and a toast offers Undo", async ({ page }) => {
  // Delete happens at once, without a confirmation dialog.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(
    page.locator('[data-work-item-id="work-item-acceptance"]'),
  ).toHaveCount(0);
  const toasts = page.getByRole("region", { name: "Notifications" });
  await expect(toasts).toContainText("Backlog item and 1 subitem deleted");
  await expect(toasts.getByRole("button", { name: "Undo" })).toBeVisible();
});

Then("the Backlog item and its subitem are back in place", async ({ page }) => {
  await expect(
    page.locator('[data-work-item-id="work-item-acceptance"]'),
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
  // The view switcher names the open view.
  await expect(
    primaryNavigation.getByRole("button", { name: "Time", exact: true }),
  ).toHaveAttribute("aria-haspopup", "menu");
  // The Time page itself has rendered, so its own shortcuts (such as N opening
  // the side panel instead of the titlebar popover) are registered.
  await expect(page.locator(".time-page-stack")).toBeVisible({
    timeout: 15_000,
  });
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
  const dayViewer = page.locator(".time-page-stack .day-strip");
  const dayViewerStrip = dayViewer;
  const entriesHeader = page.locator(".time-page-stack .time-entries");
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

  // The strip and the entry list run edge to edge.
  expect(dayViewerStripBox?.width).toBe(contentBox?.width);

  await expect(dayViewer).toHaveCSS("border-left-width", "0px");
  await expect(dayViewer).toHaveCSS("border-right-width", "0px");
  await expect(entriesHeader).toHaveCSS("border-left-width", "0px");
  await expect(entriesHeader).toHaveCSS("border-right-width", "0px");
});

Then("the Backlog workspace fills the available page", async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 900 });
  const content = await page.locator(".app-content-shell").boundingBox();
  const workspace = await page.locator(".backlog-workspace").boundingBox();
  const header = await page
    .locator(".backlog-workspace-filterbar")
    .boundingBox();
  expect(workspace).not.toBeNull();
  expect(workspace?.x).toBe(content?.x);
  expect(workspace?.width).toBe(content?.width);
  expect(workspace?.height).toBe(content?.height);
  expect(header?.width).toBe(content?.width);
});

Then("the Backlog list fits a narrow window", async ({ page }) => {
  const row = page.locator('[data-work-item-id="work-item-acceptance"]');
  await expect(row).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Board layout", exact: true }),
  ).toHaveCount(0);
  const bounds = await row.boundingBox();
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await expect(
    row.getByRole("button", { name: "Actions for Backlog switch item" }),
  ).toBeVisible();
});

Then(
  "standalone subitems and cancellable Backlog drag remain usable",
  async ({ page }) => {
    const parent = page.locator('[data-work-item-id="work-item-acceptance"]');
    const child = page.locator(
      '[data-work-item-id="work-item-child-acceptance"]',
    );
    await expect(child).toBeVisible();
    await expect(
      parent.getByRole("button", {
        name: "Show subitems for Backlog switch item",
      }),
    ).toHaveCount(0);
    const title = await parent.locator(".backlog-item-title").boundingBox();
    await page.mouse.move(title!.x + 8, title!.y + 8);
    await page.mouse.down();
    await page.mouse.move(title!.x + 8, title!.y + 24, { steps: 5 });
    await expect(page.locator(".backlog-move-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".backlog-move-preview")).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "Backlog item peek" }),
    ).toHaveCount(0);
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
  // The Comfortable density's default width. See "Width" in agents/ux-spec.md.
  await expectAppSidebarWidth(page, 272);
  await expect(viewSwitcher(page)).toBeVisible();
});

Then("the app sidebar is hidden", async ({ page }) => {
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show sidebar" }),
  ).toBeVisible();
});

Then("the app sidebar is expanded beside the page", async ({ page }) => {
  await expectAppSidebarWidth(page, 272);
  // Beside the page, not over it: the page starts where the sidebar ends.
  const sidebarBox = await page
    .getByRole("navigation", { name: "Primary navigation" })
    .boundingBox();
  const pageBox = await page.getByRole("main").boundingBox();
  expect(pageBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width);
});

Then("the Settings pages replace the app sidebar", async ({ page }) => {
  const settingsNavigation = page.getByRole("navigation", {
    name: "Settings sections",
  });
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toHaveCount(0);
  await expect(settingsNavigation).toBeVisible();
  await expect(
    settingsNavigation.getByRole("link", { name: "General" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    settingsNavigation.getByRole("button", { name: "Back to app" }),
  ).toBeVisible();
  // The narrow view's back arrow does not show in wide windows.
  await expect(
    page.getByRole("button", { name: "Back", exact: true }),
  ).toHaveCount(0);

  const [box, viewport] = await Promise.all([
    settingsNavigation.boundingBox(),
    page.evaluate(() => ({ height: window.innerHeight })),
  ]);
  expect(box?.x).toBe(0);
  expect(box?.y).toBe(0);
  expect(box?.height).toBe(viewport.height);
});

When(
  "I type {string} in the running entry's note",
  async ({ page }, note: string) => {
    await page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Note", exact: true })
      .fill(note);
  },
);

When("I narrow the window to the narrow view", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
});

Then(
  "the running entry's dialog still has {string}",
  async ({ page }, note: string) => {
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await expect(
      dialog.getByRole("textbox", { name: "Note", exact: true }),
    ).toHaveValue(note);
  },
);

Then(
  "the running entry's popover still has {string}",
  async ({ page }, note: string) => {
    const popover = page.locator('[data-slot="popover-content"]');
    await expect(
      popover.getByRole("textbox", { name: "Note", exact: true }),
    ).toHaveValue(note);
  },
);

When('I open a new entry from the timer dock "+"', async ({ page }) => {
  await page.getByRole("button", { name: "Create time entry" }).click();
});

When("I open the running entry from the timer dock", async ({ page }) => {
  await page
    .getByRole("region", { name: "Running entry" })
    .getByRole("button", { name: "Edit the running entry" })
    .click();
});

Then("only the new entry's editor is open", async ({ page }) => {
  const editors = page.locator('[data-slot="popover-content"]');
  await expect(editors).toHaveCount(1);
  await expect(editors).toContainText("New time entry");
});

Then("only the running entry's editor is open", async ({ page }) => {
  const editors = page.locator('[data-slot="popover-content"]');
  await expect(editors).toHaveCount(1);
  await expect(editors).toContainText("Running");
});

When("I open today's time workspace in the Week view", async ({ page }) => {
  await page.goto("/time/today?view=week");
});

Then(
  "the Week view is back and the browser's Back skips Settings",
  async ({ page }) => {
    await expect(page).toHaveURL(/view=week/);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/settings/);
  },
);

When("I go back to the app from Settings", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Back to app" })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
});

Then("the Projects list opens beside primary navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "aaa xyz", exact: true }),
  ).toBeVisible();
  // No project column of its own: the list is the page.
  await expect(page.getByRole("navigation", { name: "Projects" })).toHaveCount(
    0,
  );
});

Then(
  "the Projects list still opens beside the sidebar in a small window",
  async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "aaa xyz", exact: true }),
    ).toBeVisible();
  },
);

Then("the week can be committed", async ({ page }) => {
  await page.getByRole("button", { name: "Show day and week totals" }).click();
  const commitWeek = page
    .getByLabel("Current time totals")
    .getByRole("button", { name: "Commit week" });

  await expect(commitWeek).toBeVisible();
  await expect(commitWeek).toBeEnabled();
  await page.keyboard.press("Escape");
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

When("I install a packaged plugin from settings", async ({ page }) => {
  const plugin = {
    id: "example",
    version: "1.2.3",
    apiVersion: 3,
    displayName: "Example",
    description: "Example connector used by the acceptance test.",
    iconSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
    entrypoint: "dist/plugin.js",
    capabilities: { connector: {} },
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
  await page.route("http://127.0.0.1:8787/api/plugins", async (route) => {
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
        installPlugin: () => Promise<typeof response>;
        uninstallPlugin: () => Promise<{
          pluginId: string;
          overview: typeof response.overview;
        }>;
      };
    };
    desktopWindow.ajourDesktop = {
      bootstrapLocalState: null,
      runtime: { developmentBuild: false },
      installPlugin: () => desktopWindow.acceptanceInstallPlugin(),
      uninstallPlugin: () => desktopWindow.acceptanceUninstallPlugin(),
    };
  }, installResponse);

  await page.route(
    "http://127.0.0.1:8787/api/plugins/example/activation",
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

When("I deactivate the plugin with the keyboard", async ({ page }) => {
  const deactivateSwitch = page.getByRole("switch", {
    name: "Deactivate Example",
  });
  await deactivateSwitch.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("switch", { name: "Activate Example" }),
  ).toHaveAttribute("aria-checked", "false");
});

Then("the inactive plugin remains configurable", async ({ page }) => {
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

Then("the plugin is reported as installed", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeVisible();
  await expect(page.getByText("Example 1.2.3 installed.")).toBeVisible();
  // The row shows the plugin's capabilities, then its version.
  await expect(
    page.getByText("Backlog · v1.2.3", { exact: true }),
  ).toBeVisible();
});

Then("I can open the plugin configuration", async ({ page }) => {
  await page.getByRole("link", { name: "View Example" }).click();

  await expect(page).toHaveURL(/\/settings\/plugins\/example$/);
  await expect(page.getByRole("heading", { name: "Example" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add a connection" }),
  ).toBeVisible();
});

When("I open the plugin configuration", async ({ page }) => {
  await page.getByRole("link", { name: "View Example" }).click();
  await expect(page).toHaveURL(/\/settings\/plugins\/example$/);
});

When("I uninstall the plugin", async ({ page }) => {
  await page.getByRole("button", { name: "Uninstall", exact: true }).click();
  await page.getByRole("button", { name: "Uninstall plugin" }).click();
});

Then("the plugin is reported as uninstalled", async ({ page }) => {
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
      directories: ["/workspace/plugins/example"],
    };
    const selectedSettings = {
      available: true,
      directories: ["/workspace/plugins/selected"],
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
  await expect(page.getByText("/workspace/plugins/example")).toBeVisible();

  await page.getByRole("button", { name: "Choose directory" }).click();
  await expect(page.getByText("/workspace/plugins/selected")).toBeVisible();
});

Given("I have a saved entry with an unrounded duration", async ({ page }) => {
  await mockEmptyPluginsOverview(page);
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
        .dblclick();
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
  await mockEmptyPluginsOverview(page);
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

When(
  "I open the Commit page from the Week totals dropdown",
  async ({ page }) => {
    await page.goto("/time/2026-10-05?view=week");
    await expect(page.locator(".time-page-stack")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Commit week" })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Show day and week totals" })
      .click();
    await expect(page.getByLabel("Current time totals")).toContainText("5:00");
    await page
      .getByLabel("Current time totals")
      .getByRole("button", { name: "Commit week" })
      .click();
    await expect(page).toHaveURL(/\/time\/2026-10-05\/commit/);
  },
);

When(
  "I open the Commit page from the narrow totals dropdown",
  async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 860 });
    await page.goto("/time/2026-10-05");
    await expect(page.locator(".time-page-stack")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Commit week" })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Show day and week totals" })
      .click();
    await page.getByRole("button", { name: "Commit week" }).click();
    await expect(page).toHaveURL(/\/time\/2026-10-05\/commit/);
  },
);

When("I open the Commit page from Settings totals", async ({ page }) => {
  await page.goto("/time/2026-10-05");
  await expect(page.locator(".time-page-stack")).toBeVisible({
    timeout: 15_000,
  });
  // The development router launcher covers the sidebar footer's pointer target.
  await page.getByRole("link", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/general$/);
  await page.getByRole("button", { name: "Show day and week totals" }).click();
  await expect(page.getByLabel("Current time totals")).toContainText("5:00");
  await page.getByRole("button", { name: "Commit week" }).click();
  await expect(page).toHaveURL(/\/time\/2026-10-05\/commit/);
});

When(
  "I open the Commit page with {string} hours in an open entry",
  async ({ page }, hours: string) => {
    await page.goto("/time/2026-10-05?entry=mon-dev-1");
    await page
      .getByRole("textbox", { name: "Note", exact: true })
      .fill("Unsaved submission note");
    await page.getByRole("textbox", { name: "Hours", exact: true }).fill(hours);
    await page
      .getByRole("button", { name: "Show day and week totals" })
      .click();
    await page
      .getByLabel("Current time totals")
      .getByRole("button", { name: "Commit week" })
      .click();
  },
);

Then("the Commit page includes the saved entry draft", async ({ page }) => {
  await expect(page).toHaveURL(/\/time\/2026-10-05\/commit/);
  const savedEntry = await page.evaluate(() => {
    const state = JSON.parse(
      localStorage.getItem("ajour.local-state.v2") ?? "null",
    );
    return state.timesheetEntries.find(
      (entry: { _id: string }) => entry._id === "mon-dev-1",
    );
  });
  expect(savedEntry.note).toBe("Unsaved submission note");
  expect(savedEntry.durationMs).toBe(2 * 60 * 60 * 1000);
});

Then(
  "the invalid entry draft stays open instead of opening the Commit page",
  async ({ page }) => {
    // Still the day with the entry open, not the submit page.
    await expect(page).toHaveURL(/\/time\/2026-10-05\?[^/]*entry=mon-dev-1/);
    await expect(
      page.getByRole("textbox", { name: "Hours", exact: true }),
    ).toHaveValue("invalid");
    await expect(
      page.getByText("Enter a valid duration", { exact: true }),
    ).toBeVisible();
  },
);

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
  // Each item ends with its key, which differs between macOS and other platforms.
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Edit(↩|Enter)$/,
    /^ContinueC$/,
    /^Duplicate(⌘D|Ctrl\+D)$/,
    /^Duplicate to…$/,
    /^Move to…M$/,
    /^Delete(⌫|Backspace)$/,
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

Then("the Commit page lists the week's entries", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Commit week of Oct 5 to Oct 11" }),
  ).toBeVisible({ timeout: 15_000 });
  // None of the fixture's entries was ever committed.
  await expect(
    page
      .getByRole("list", { name: "Changes" })
      .getByRole("img", { name: "Added" }),
  ).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Mark as committed" }),
  ).toBeEnabled();
});

Then("the Commit page merges Monday's task entries", async ({ page }) => {
  const monday = page.getByRole("region", { name: "Monday, Oct 5" });
  await expect(monday.getByRole("listitem")).toHaveCount(2);
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
      .getByRole("button", { name: "Copy comments: Login form | API" })
      .click();
    await expect.poll(readClipboard).toBe("Login form | API");
  },
);

function narrowTotalsPill(page: Page) {
  return page.getByRole("button", { name: "Show day and week totals" });
}

When("I press Start in the narrow titlebar", async ({ page }) => {
  await page
    .locator(".ajour-nav")
    .getByRole("button", { name: "Start", exact: true })
    .click();
});

When("I press Stop in the narrow titlebar", async ({ page }) => {
  await page
    .locator(".ajour-nav")
    .getByRole("button", { name: "Stop", exact: true })
    .click();
});

Then("the running entry's dialog is open", async ({ page }) => {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(
    dialog.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
});

When("I click outside the running entry's dialog", async ({ page }) => {
  // The backdrop covers the page around the dialog, which spans the width.
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width / 2, viewport.height - 4);
});

When("I close the running entry's dialog with Escape", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

Then("no entry dialog is open", async ({ page }) => {
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

Then(
  "the totals pill shows the running time instead of Today",
  async ({ page }) => {
    const pill = narrowTotalsPill(page);
    await expect(pill).not.toContainText("Today");
    await expect(pill).toContainText(/\d+:\d{2}:\d{2}/);
  },
);

When("I open the current timer from the totals popover", async ({ page }) => {
  await narrowTotalsPill(page).click();
  await page.getByRole("button", { name: "Edit the current timer" }).click();
});

Then("the totals pill shows Today again", async ({ page }) => {
  await expect(narrowTotalsPill(page)).toContainText("Today");
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

Then(
  "the titlebar holds the entry buttons and the navigation toggle floats at the bottom left",
  async ({ page }) => {
    const titlebar = page.locator(".ajour-nav");
    await expect(
      titlebar.getByRole("button", { name: "Create time entry" }),
    ).toBeVisible();
    await expect(
      titlebar.getByRole("button", { name: "Start", exact: true }),
    ).toBeVisible();

    // The entry buttons come before the totals pill.
    const [startBox, totalsBox] = await Promise.all([
      titlebar
        .getByRole("button", { name: "Start", exact: true })
        .boundingBox(),
      narrowTotalsPill(page).boundingBox(),
    ]);
    expect(startBox!.x).toBeLessThan(totalsBox!.x);

    const navigation = narrowPrimaryNavigation(page);
    await expect(
      navigation.getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();
    // It floats over the page: no bar spans the window under it.
    await expect(navigation).toHaveCSS("position", "fixed");
    const box = (await navigation.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeLessThan(viewport.width / 4);
    expect(box.y + box.height).toBeGreaterThan(viewport.height - 40);
    expect(box.width).toBeLessThan(viewport.width / 2);
  },
);

When("I switch to Backlog from the navigation toggle", async ({ page }) => {
  await narrowPrimaryNavigation(page)
    .getByRole("link", { name: "Backlog" })
    .click();
});

Then(
  "Backlog is the active section of the navigation toggle",
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

When("I open Settings from the navigation toggle", async ({ page }) => {
  await narrowPrimaryNavigation(page)
    .getByRole("link", { name: "Settings", exact: true })
    .click();
});

Then(
  "Settings is the active section of the navigation toggle",
  async ({ page }) => {
    const navigation = narrowPrimaryNavigation(page);
    await expect(
      navigation.getByRole("link", { name: "Settings", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      navigation.getByRole("link", { name: "Settings", exact: true }),
    ).toHaveText("Settings");
  },
);

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
  await expect(
    page.getByRole("link", { name: "aaa xyz", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Archived", exact: true }),
  ).toBeVisible();
  const listBox = await page.locator(".project-list").boundingBox();
  expect(listBox?.width).toBe(page.viewportSize()?.width);
});

When(
  "I open project {string} from the Projects list",
  async ({ page }, name: string) => {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/project-/);
    await expect(page.locator(".project-list")).toHaveCount(0);
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

When("I focus the top entry of Monday's Day list", async ({ page }) => {
  await page.goto("/time/2026-10-05");
  // Focus only: the rest of the scenario uses the keyboard.
  await page.locator(".time-entry-row").first().focus();
});

Then(
  "the side panel edits the {string} entry",
  async ({ page }, note: string) => {
    await expect(
      page
        .getByRole("complementary", { name: "Time entry editor" })
        .getByLabel("Note"),
    ).toHaveValue(note);
  },
);

Then(
  "Monday's {string} entry has keyboard focus",
  async ({ page }, note: string) => {
    await expect(
      page.locator(".time-entry-row").filter({ hasText: note }),
    ).toBeFocused();
  },
);

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

/** A Days column, named like "Monday, October 5". */
function daysColumn(page: Page, day: string) {
  return page.getByRole("region", { name: new RegExp(`^${day},`) });
}

/** A Days card, found by its task or note. */
function daysCard(page: Page, day: string, text: string) {
  return daysColumn(page, day).locator(".weekly-entry-card", { hasText: text });
}

/** Presses a card and moves the pointer in steps, past the drag threshold. */
async function dragCardTo(
  page: Page,
  card: Locator,
  target: { x: number; y: number },
) {
  const box = await card.boundingBox();
  if (!box) throw new Error("The dragged card is not rendered");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
}

When("I open the Week Days view", async ({ page }) => {
  await page.goto("/time/2026-10-05?view=week");
  await page.getByRole("button", { name: "Days", exact: true }).click();
  await expect(daysColumn(page, "Monday")).toBeVisible();
});

When(
  "I drag {word}'s {string} card above its {string} card",
  async ({ page }, day: string, dragged: string, target: string) => {
    const targetBox = await daysCard(page, day, target).boundingBox();
    if (!targetBox) throw new Error(`The ${target} card is not rendered`);
    // Above the target card's middle drops the card in front of it.
    await dragCardTo(page, daysCard(page, day, dragged), {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + 4,
    });
  },
);

When(
  "I drag {word}'s {string} card onto {word}",
  async ({ page }, day: string, dragged: string, targetDay: string) => {
    const columnBox = await daysColumn(page, targetDay).boundingBox();
    if (!columnBox) throw new Error(`The ${targetDay} column is not rendered`);
    await dragCardTo(page, daysCard(page, day, dragged), {
      x: columnBox.x + columnBox.width / 2,
      y: columnBox.y + 120,
    });
  },
);

Then(
  /^(\w+)'s cards read (.+)$/,
  async ({ page }, day: string, list: string) => {
    const expected = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const cards = daysColumn(page, day).locator(".weekly-entry-card");
    // Each card names its task and note; match each card to one expected text.
    await expect
      .poll(async () =>
        (await cards.allInnerTexts()).map(
          (text) => expected.find((label) => text.includes(label)) ?? text,
        ),
      )
      .toEqual(expected);
  },
);

Then(
  "{word}'s column reaches the bottom of the page",
  async ({ page }, day: string) => {
    const columnBox = await daysColumn(page, day).boundingBox();
    const viewport = page.viewportSize();
    if (!columnBox || !viewport) throw new Error(`${day} is not rendered`);
    expect(columnBox.y + columnBox.height).toBeGreaterThan(viewport.height - 4);
  },
);

When(
  "I double-click the empty space at the bottom of {word}'s column",
  async ({ page }, day: string) => {
    const columnBox = await daysColumn(page, day).boundingBox();
    if (!columnBox) throw new Error(`${day} is not rendered`);
    await page.mouse.dblclick(
      columnBox.x + columnBox.width / 2,
      columnBox.y + columnBox.height - 40,
    );
  },
);

When("I double-click {word}'s header", async ({ page }, day: string) => {
  await daysColumn(page, day).locator(".weekly-days-column-header").dblclick();
});

When(
  "I save the new entry with note {string} and hours {string}",
  async ({ page }, note: string, hours: string) => {
    const editor = page.getByRole("complementary", {
      name: "Time entry editor",
    });
    await expect(editor).toContainText("New time entry");
    await editor.getByRole("textbox", { name: "Note", exact: true }).fill(note);
    await editor
      .getByRole("textbox", { name: "Hours", exact: true })
      .fill(hours);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
  },
);

Then(
  "the side panel opens a new entry on {string}",
  async ({ page }, localDate: string) => {
    const editor = page.getByRole("complementary", {
      name: "Time entry editor",
    });
    await expect(editor).toContainText("New time entry");
    await expect(page).toHaveURL(
      new RegExp(`/time/${localDate}\\?.*entry=new`),
    );
  },
);

Then("the Week Days view is visible", async ({ page }) => {
  await expect(page.getByRole("region", { name: "Week" })).toBeVisible();
  await expect(daysColumn(page, "Monday")).toBeVisible();
});

When("I switch the Time page to Day", async ({ page }) => {
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.getByRole("region", { name: "Week" })).toHaveCount(0);
});

When("I open Monday in the Day view", async ({ page }) => {
  await page.goto("/time/2026-10-05");
  await expect(page.locator(".day-strip")).toBeVisible();
});

When("I switch the Time page to Week", async ({ page }) => {
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("region", { name: "Week" })).toBeVisible();
});

When("I go back in the browser", async ({ page }) => {
  await page.goBack();
});

When(
  "I double-click the text of {word}'s capacity card",
  async ({ page }, day: string) => {
    await daysColumn(page, day).locator(".weekly-capacity-trigger").hover();
    const card = page.locator('[data-slot="hover-card-content"]');
    await expect(card).toBeVisible();
    await card.locator("span").first().dblclick();
  },
);

Then("no entry editor is open", async ({ page }) => {
  await expect(
    page.getByRole("complementary", { name: "Time entry editor" }),
  ).toHaveCount(0);
  await expect(page).not.toHaveURL(/entry=new/);
});

When("the window is {int} pixels wide", async ({ page }, width: number) => {
  await page.setViewportSize({ width, height: 800 });
});

Then(
  "opening {word}'s {string} card floats the entry panel over the Week",
  async ({ page }, day: string, text: string) => {
    const week = page.getByRole("region", { name: "Week" });
    const before = await week.boundingBox();
    await daysCard(page, day, text).dblclick();
    const panel = page.getByRole("complementary", {
      name: "Time entry editor",
    });
    await expect(panel).toBeVisible();
    const after = await week.boundingBox();
    const panelBox = await panel.boundingBox();
    if (!before || !after || !panelBox) throw new Error("Not rendered");
    // The Week keeps its width and the panel covers its right side.
    expect(after.width).toBe(before.width);
    expect(panelBox.x).toBeLessThan(after.x + after.width);
  },
);

Then(
  "the entry panel sits beside the Week and narrows it",
  async ({ page }) => {
    const week = page.getByRole("region", { name: "Week" });
    const panel = page.getByRole("complementary", {
      name: "Time entry editor",
    });
    await expect
      .poll(async () => {
        const weekBox = await week.boundingBox();
        const panelBox = await panel.boundingBox();
        return weekBox && panelBox
          ? panelBox.x - (weekBox.x + weekBox.width)
          : null;
      })
      .toBeGreaterThanOrEqual(0);
  },
);

Then("the Day view is visible", async ({ page }) => {
  await expect(page.locator(".day-strip")).toBeVisible();
  await expect(page.getByRole("region", { name: "Week" })).toHaveCount(0);
});

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

/** A Week Grid row, found by its task name. */
function weekGridRow(page: Page, task: string) {
  return page
    .getByRole("region", { name: "Week" })
    .getByRole("row")
    .filter({ has: page.getByText(task, { exact: true }) });
}

When(
  "I press Shift+Backspace on the {string} cell on {word}",
  async ({ page }, task: string, day: string) => {
    await weekGridCell(page, task, day).focus();
    await page.keyboard.press("Shift+Backspace");
  },
);

Then(
  "a dialog warns that deleting the {string} row deletes its entries",
  async ({ page }, task: string) => {
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Delete this row?");
    await expect(dialog).toContainText(`${task} also deletes its`);
  },
);

When("I confirm deleting the row", async ({ page }) => {
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete row" })
    .click();
});

Then("the Week Grid has no {string} row", async ({ page }, task: string) => {
  await expect(weekGridRow(page, task)).toHaveCount(0);
});

When("I add a Week Grid row without a task", async ({ page }) => {
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  await page
    .getByRole("button", { name: "Project or task for the new row" })
    .click();
  await page.getByRole("option", { name: /^Client Atlas/ }).click();
  await page
    .getByRole("option", { name: "Use project without a task", exact: true })
    .click();
  await expect(weekGridCell(page, "No task", "Monday")).toBeVisible();
});

When(
  "I delete the {string} row from its name menu",
  async ({ page }, task: string) => {
    await weekGridRow(page, task)
      .locator(".weekly-grid-task-cell")
      .click({ button: "right" });
    const action = page.getByRole("menuitem", {
      name: "Delete row",
      exact: true,
    });
    // The name cannot receive keyboard focus, so it must not advertise cell keys.
    await expect(action).not.toHaveAttribute("aria-keyshortcuts");
    await action.click();
  },
);

When(
  "I draft {string} hours in the {string} cell on {word}",
  async ({ page }, hours: string, task: string, day: string) => {
    await weekGridCell(page, task, day).click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Add entry", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Hours", exact: true }).fill(hours);
  },
);

Then(
  "the row deletion dialog counts {string}",
  async ({ page }, count: string) => {
    await expect(page.getByRole("alertdialog")).toContainText(count);
    await expect(
      page.getByRole("textbox", { name: "Hours", exact: true }),
    ).toHaveCount(0);
  },
);

Then("no row deletion dialog is open", async ({ page }) => {
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

Then(
  "the {string} cell on {word} has keyboard focus",
  async ({ page }, task: string, day: string) => {
    await expect(weekGridCell(page, task, day)).toBeFocused();
  },
);

Then("the Week Grid entry draft still has invalid hours", async ({ page }) => {
  await expect(
    page.getByRole("textbox", { name: "Hours", exact: true }),
  ).toHaveValue("invalid");
  await expect(
    page.getByText("Enter a valid duration", { exact: true }),
  ).toBeVisible();
});

When("I open the Backlog settings", async ({ page }) => {
  await page.goto("/settings/backlog");
});

Then(
  "the Backlog settings contain one settle rules section",
  async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Subitems", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Settle rules", exact: true }),
    ).toHaveCount(1);
    const preference = page.getByRole("group", {
      name: "When closing a parent with open subitems",
      exact: true,
    });
    await expect(
      preference.getByRole("button", { name: "Ask", exact: true }),
    ).toBeVisible();
    // Settle rules render once, in their own section, not under Subitems.
    const subitems = page.locator("section", {
      has: page.getByRole("heading", { name: "Subitems", exact: true }),
    });
    await expect(subitems).toHaveCount(1);
    await expect(subitems).not.toContainText("Settle rules");
  },
);
