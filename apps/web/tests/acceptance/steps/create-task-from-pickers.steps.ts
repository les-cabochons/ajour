import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

const ITEM_ID = "create-task-item";

function properties(page: Page) {
  return page.getByRole("region", { name: "Properties" });
}

function taskField(page: Page) {
  return properties(page).getByRole("combobox", { name: "Task", exact: true });
}

Given(
  "a backlog item is on a project without the task {string}",
  async ({ page }, _task: string) => {
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
    await page.addInitScript((itemId) => {
      // Seed once, so a reload keeps what the scenario changed.
      if (sessionStorage.getItem("create-task-fixture")) return;
      localStorage.clear();
      sessionStorage.setItem("create-task-fixture", "true");
      localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({
          projects: [
            {
              _id: "project-acme",
              name: "Acme website",
              displayName: "Acme website",
              code: "ACME",
              color: "#1f7667",
              icon: { kind: "preset", name: "dot" },
              status: "active",
              tasks: [
                {
                  _id: "task-build",
                  name: "05 Build",
                  status: "active",
                  createdAt: 1,
                },
                {
                  _id: "task-old",
                  name: "08 Old",
                  status: "archived",
                  createdAt: 1,
                  archivedAt: 2,
                },
              ],
            },
          ],
          workItems: [
            {
              _id: itemId,
              title: "Fix login redirect",
              status: "active",
              source: "manual",
              projectId: "project-acme",
              createdAt: Date.now(),
            },
          ],
        }),
      );
    }, ITEM_ID);
  },
);

When("I open that item's page", async ({ page }) => {
  await page.goto(`/backlog/${ITEM_ID}`);
  await expect(properties(page)).toBeVisible();
});

When(
  "I type {string} in the item's Task property",
  async ({ page }, text: string) => {
    await taskField(page).click();
    await taskField(page).fill(text);
  },
);

Then("the Task list offers {string}", async ({ page }, label: string) => {
  await expect(page.getByRole("option", { name: label })).toBeVisible();
});

When("I press Enter", async ({ page }) => {
  await page.keyboard.press("Enter");
});

Then("the item's Task shows {string}", async ({ page }, text: string) => {
  if (text === "No task") {
    await expect(taskField(page)).toHaveValue("");
    await expect(taskField(page)).toHaveAttribute("placeholder", "No task");
    return;
  }
  await expect(taskField(page)).toHaveValue(text);
});

Then("the project has no task {string}", async ({ page }, task: string) => {
  const names = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!) as {
      projects: { tasks: { name: string }[] }[];
    };
    return state.projects.flatMap((project) =>
      project.tasks.map((item) => item.name),
    );
  });
  expect(names).not.toContain(task);
});

When("I type {string} in the task menu", async ({ page }, text: string) => {
  await page.getByPlaceholder(/^Search .*\.\.\.$/).fill(text);
});

Then(
  "the Create task dialog asks for a project for {string}",
  async ({ page }, name: string) => {
    const dialog = page.getByRole("dialog", { name: "Create task" });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(
      name,
    );
    await expect(dialog.getByRole("combobox", { name: "Project" })).toHaveText(
      "Project",
    );
    await expect(
      dialog.getByRole("button", { name: "Create task" }),
    ).toBeDisabled();
  },
);

When(
  "I pick the project {string} in the dialog",
  async ({ page }, project: string) => {
    const dialog = page.getByRole("dialog", { name: "Create task" });
    await dialog.getByRole("combobox", { name: "Project" }).click();
    await page.getByRole("option", { name: project, exact: true }).click();
  },
);

Given(
  "project {string} has a Not known yet task {string}",
  async ({ page }, project: string, task: string) => {
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
    await page.addInitScript(
      ({ project, task }) => {
        if (sessionStorage.getItem("waiting-task-fixture")) return;
        localStorage.clear();
        sessionStorage.setItem("waiting-task-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            projects: [
              {
                _id: "project-acme",
                name: project,
                displayName: project,
                color: "#1f7667",
                icon: { kind: "preset", name: "dot" },
                status: "active",
                tasks: [
                  {
                    _id: "task-temp",
                    name: task,
                    status: "active",
                    createdAt: 1,
                    commitAs: "waiting",
                  },
                ],
              },
            ],
          }),
        );
      },
      { project, task },
    );
  },
);

When("I import the task file with two new tasks", async ({ page }) => {
  // Column C holds "07 Run" and "08 Migration". Made with exceljs, which
  // Playwright's loader can't import.
  await page
    .locator('input[type="file"][accept=".xlsx,.xls,.xlsm"]')
    .setInputFiles(
      fileURLToPath(
        new URL("../fixtures/plan-with-two-new-tasks.xlsx", import.meta.url),
      ),
    );
});

Then(
  "Ajour asks which task {string} was waiting for, suggesting {string}",
  async ({ page }, task: string, suggestion: string) => {
    const dialog = page.getByRole("dialog", {
      name: "1 task is waiting for its timesheet task",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: `${task} was waiting for` }),
    ).toHaveText(suggestion);
  },
);

Then(
  "the project lists {string} once and {string}",
  async ({ page }, renamed: string, added: string) => {
    const names = await page.evaluate(() => {
      const state = JSON.parse(
        localStorage.getItem("ajour.local-state.v2")!,
      ) as { projects: { tasks: { _id: string; name: string }[] }[] };
      return state.projects[0]!.tasks.map((task) => [task._id, task.name]);
    });
    expect(names).toEqual([
      ["task-temp", renamed],
      [expect.any(String), added],
    ]);
  },
);

Then("the import says {string}", async ({ page }, message: string) => {
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});
