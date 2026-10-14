import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

Given("I have a parent editor close fixture", async ({ page }) => {
  await mockEmptyConnectorOverview(page);
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
  await page.goto("/backlog/editor-parent");
  await page
    .getByRole("button", { name: "Actions for Editor parent", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
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
  "the confirmed title and note remain saved after undoing the close",
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
      note: "Unsaved parent note",
      status: "archived",
      workflowStateId: "done",
    });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(readParent).toMatchObject({
      title: "Unsaved parent title",
      note: "Unsaved parent note",
      status: "active",
      workflowStateId: "doing",
    });
  },
);
When("I cancel the parent editor close prompt", async ({ page }) => {
  await page.keyboard.press("Escape");
});
When("I change the parent draft title and note", async ({ page }) => {
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await editor
    .getByPlaceholder("Item name", { exact: true })
    .fill("Unsaved parent title");
  await editor
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("Unsaved parent note");
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
      editor.getByRole("textbox", { name: "Note", exact: true }),
    ).toHaveValue("Unsaved parent note");
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
    expect(parent.note).toBeUndefined();
  },
);
When("I cancel the parent editor draft", async ({ page }) => {
  await page
    .getByRole("complementary", { name: "Backlog item editor" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
});
Then("the parent title and note remain unchanged", async ({ page }) => {
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
  expect(parent.note).toBeUndefined();
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

When("I hide the app sidebar with its button", async ({ page }) => {
  await page.getByRole("button", { name: "Hide sidebar" }).click();
});

When("I show the app sidebar from the titlebar", async ({ page }) => {
  await page.getByRole("button", { name: "Show sidebar" }).click();
});

When("I start an empty entry from the titlebar", async ({ page }) => {
  await page
    .locator(".ajour-nav")
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
  await expect(page.locator(".ajour-floating-dock-desktop")).toHaveCount(0);
  await expect(page).toHaveTitle("Ajour");
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
  await expect(
    primaryNavigation.getByRole("link", { name: "Time" }),
  ).toHaveAttribute("aria-current", "page");
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
  const content = await page.locator(".app-content-shell").boundingBox();
  const workspace = await page.locator(".backlog-workspace").boundingBox();
  const header = await page.locator(".backlog-workspace-header").boundingBox();
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
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByText("Time", { exact: true }),
  ).toBeVisible();
});

Then("the app sidebar is hidden", async ({ page }) => {
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show sidebar" }),
  ).toBeVisible();
});

Then("the app sidebar opens over the page", async ({ page }) => {
  const overlay = page.getByRole("dialog", { name: "Navigation" });
  await expect(
    overlay.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  // Opening a page from it closes it.
  await overlay.getByRole("link", { name: "Backlog" }).click();
  await expect(page).toHaveURL(/\/backlog$/);
  await expect(overlay).toHaveCount(0);
  // So does choosing the page already open, which leaves the route alone.
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await overlay.getByRole("link", { name: "Backlog" }).click();
  await expect(overlay).toHaveCount(0);
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

When('I open a new entry from the titlebar "+"', async ({ page }) => {
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
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }),
    ).toHaveCount(0);
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
  await page.getByRole("button", { name: "Show day and week totals" }).click();
  const submitTimesheet = page.getByRole("button", {
    name: "Submit week",
  });

  await expect(submitTimesheet).toBeVisible();
  await expect(submitTimesheet).toBeEnabled();
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

When("I install a packaged connector from settings", async ({ page }) => {
  const plugin = {
    id: "example",
    version: "1.2.3",
    apiVersion: 2,
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

When(
  "I open the submit page from the Week totals dropdown",
  async ({ page }) => {
    await page.goto("/time/2026-10-05?view=week");
    await expect(page.locator(".time-page-stack")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Submit week" })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Show day and week totals" })
      .click();
    await expect(page.getByLabel("Current time totals")).toContainText("5:00");
    await page.getByRole("button", { name: "Submit week" }).click();
    await expect(page).toHaveURL(/\/time\/2026-10-05\/submit/);
  },
);

When(
  "I open the submit page from the narrow totals dropdown",
  async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 860 });
    await page.goto("/time/2026-10-05");
    await expect(page.locator(".time-page-stack")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Submit week" })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Show day and week totals" })
      .click();
    await page.getByRole("button", { name: "Submit week" }).click();
    await expect(page).toHaveURL(/\/time\/2026-10-05\/submit/);
  },
);

When("I open the submit page from Settings totals", async ({ page }) => {
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
  await page.getByRole("button", { name: "Submit week" }).click();
  await expect(page).toHaveURL(/\/time\/2026-10-05\/submit/);
});

When(
  "I request week submission with {string} hours in an open entry",
  async ({ page }, hours: string) => {
    await page.goto("/time/2026-10-05?entry=mon-dev-1");
    await page
      .getByRole("textbox", { name: "Note", exact: true })
      .fill("Unsaved submission note");
    await page.getByRole("textbox", { name: "Hours", exact: true }).fill(hours);
    await page
      .getByRole("button", { name: "Show day and week totals" })
      .click();
    await page.getByRole("button", { name: "Submit week" }).click();
  },
);

Then("the submit page includes the saved entry draft", async ({ page }) => {
  await expect(page).toHaveURL(/\/time\/2026-10-05\/submit/);
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
  "the invalid entry draft stays open instead of submitting",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/time\/2026-10-05\?entry=mon-dev-1$/);
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

Then("the submit page lists the week's entries", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Submit week of Oct 5 to Oct 11" }),
  ).toBeVisible({ timeout: 15_000 });
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
    await expect(page.locator('[data-slot="field"]')).not.toContainText(
      "Settle rules",
    );
  },
);
