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
      "Pick a project",
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
