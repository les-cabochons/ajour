import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

/** A form's submit button: Save on an edit, Create … on a new record. */
const SAVE_OR_CREATE = /^(Save|Create (item|subitem|task|entry))$/;

const { Given, When, Then } = createBdd();
const cors = { "access-control-allow-origin": "*" };

const workdayAgent = {
  id: "workday-agent",
  displayName: "Workday (agent)",
  version: "0.3.0",
  apiVersion: 3,
  iconSvg:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>",
  connectionFields: [],
  capabilities: {
    projectProperties: {
      section: "Workday",
      fields: [
        { id: "name", label: "Workday name", defaultFrom: "fullName" },
        { id: "code", label: "Workday code", defaultFrom: "code" },
      ],
    },
  },
};

const workdayAgentWithTasks = {
  ...workdayAgent,
  version: "0.6.0",
  capabilities: {
    ...workdayAgent.capabilities,
    taskProperties: {
      section: "Workday",
      fields: [{ id: "task", label: "Workday task", defaultFrom: "name" }],
    },
  },
};

function card(page: Page) {
  return page.getByRole("region", { name: "Properties" });
}

/**
 * Answers the plugins overview with one active plugin. Registered after the
 * Given that mocks an empty overview on the same URL, so it wins.
 */
async function mockOverviewWith(page: Page, plugin: typeof workdayAgent) {
  await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: true,
        plugins: [plugin],
        connectionGroups: [{ plugin, enabled: true, connections: [] }],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: cors,
    }),
  );
}

Given(
  "the Workday \\(agent) plugin adds project properties",
  async ({ page }) => {
    await mockOverviewWith(page, workdayAgent);
  },
);

Given("the Workday \\(agent) plugin adds task properties", async ({ page }) => {
  await mockOverviewWith(page, workdayAgentWithTasks);
});

When(
  "I map task {string} to the Workday task {string} and save",
  async ({ page }, task: string, workdayTask: string) => {
    await page.getByText(task, { exact: true }).dblclick();
    const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
    await editor.getByRole("combobox", { name: "Commits as" }).click();
    await page.getByRole("option", { name: "Another task…" }).click();
    await editor.getByRole("combobox", { name: "Workday task" }).click();
    await page.getByRole("option", { name: workdayTask, exact: true }).click();
    await editor.getByRole("button", { name: SAVE_OR_CREATE }).click();
    await expect(editor).toBeHidden();
  },
);

Then(
  "task {string} shows the Workday task {string}",
  async ({ page }, task: string, workdayTask: string) => {
    const row = page.locator("tr.project-task-row", {
      has: page.getByText(task, { exact: true }),
    });
    await expect(row.getByTitle(`Workday task: ${workdayTask}`)).toBeVisible();
  },
);

Then(
  "task {string} is saved with the Workday task {string}",
  async ({ page }, task: string, workdayTask: string) => {
    const saved = await page.evaluate((name) => {
      const state = JSON.parse(
        localStorage.getItem("ajour.local-state.v2")!,
      ) as {
        projects: {
          tasks: { name: string; pluginProperties?: unknown }[];
        }[];
      };
      return state.projects
        .flatMap((project) => project.tasks)
        .find((candidate) => candidate.name === name)?.pluginProperties;
    }, task);
    expect(saved).toEqual({ "workday-agent": { task: workdayTask } });
  },
);

async function mapToNewWorkdayTask(
  page: Page,
  task: string,
  workdayTask: string,
  close: "Save" | "Cancel",
) {
  await page.getByText(task, { exact: true }).dblclick();
  const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
  await editor.getByRole("combobox", { name: "Commits as" }).click();
  await page.getByRole("option", { name: "Another task…" }).click();
  const picker = editor.getByRole("combobox", { name: "Workday task" });
  await picker.click();
  await picker.fill(workdayTask);
  await page.keyboard.press("Enter");
  await expect(picker).toHaveValue(workdayTask);
  await editor.getByRole("button", { name: close, exact: true }).click();
  await expect(editor).toBeHidden();
}

When(
  "I map task {string} to a new Workday task {string} and cancel",
  async ({ page }, task: string, workdayTask: string) => {
    await mapToNewWorkdayTask(page, task, workdayTask, "Cancel");
  },
);

When(
  "I open task {string} in the task editor",
  async ({ page }, task: string) => {
    await page.getByText(task, { exact: true }).first().dblclick();
    await expect(
      page.getByRole("dialog", { name: /^(New|Edit) task$/ }),
    ).toBeVisible();
  },
);

Then(
  "the open task editor has Commits as {string}",
  async ({ page }, choice: string) => {
    const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
    await expect(
      editor.getByRole("combobox", { name: "Commits as" }),
    ).toHaveText(choice);
    await expect(
      editor.getByRole("button", { name: SAVE_OR_CREATE }),
    ).toBeDisabled();
  },
);

Then(
  "task {string} is not in the project's task list",
  async ({ page }, task: string) => {
    await expect(
      page.locator("tr.project-task-row", {
        has: page.getByText(task, { exact: true }),
      }),
    ).toHaveCount(0);
  },
);

When(
  "I map task {string} to a new Workday task {string} and save",
  async ({ page }, task: string, workdayTask: string) => {
    await page.getByText(task, { exact: true }).dblclick();
    const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
    await editor.getByRole("combobox", { name: "Commits as" }).click();
    await page.getByRole("option", { name: "Another task…" }).click();
    const picker = editor.getByRole("combobox", { name: "Workday task" });
    await picker.click();
    await picker.fill(workdayTask);
    await expect(
      page.getByRole("option", { name: `Create task "${workdayTask}"` }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(picker).toHaveValue(workdayTask);
    await editor.getByRole("button", { name: SAVE_OR_CREATE }).click();
    await expect(editor).toBeHidden();
  },
);

Then(
  "task {string} is in the project's task list",
  async ({ page }, task: string) => {
    await expect(
      page.locator("tr.project-task-row", {
        has: page.getByText(task, { exact: true }),
      }),
    ).toBeVisible();
  },
);

When(
  "I set task {string} to commit as {string} and save",
  async ({ page }, task: string, choice: string) => {
    await page.getByText(task, { exact: true }).dblclick();
    const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
    await editor.getByRole("combobox", { name: "Commits as" }).click();
    await page.getByRole("option", { name: choice, exact: true }).click();
    await editor.getByRole("button", { name: SAVE_OR_CREATE }).click();
    await expect(editor).toBeHidden();
  },
);

When(
  "I choose Another task… for task {string} without picking one",
  async ({ page }, task: string) => {
    await page.getByText(task, { exact: true }).dblclick();
    const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
    await editor.getByRole("combobox", { name: "Commits as" }).click();
    await page.getByRole("option", { name: "Another task…" }).click();
  },
);

Then("Save is disabled and says {string}", async ({ page }, error: string) => {
  const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
  await expect(
    editor.getByRole("button", { name: SAVE_OR_CREATE }),
  ).toBeDisabled();
  await expect(editor.getByText(error)).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
});

Then(
  "task {string} still shows the chip {string}",
  async ({ page }, task: string, chip: string) => {
    const row = page.locator("tr.project-task-row", {
      has: page.getByText(task, { exact: true }),
    });
    await expect(row.getByText(chip, { exact: true })).toBeVisible();
  },
);

Then(
  "task {string} shows the chip {string}",
  async ({ page }, task: string, chip: string) => {
    const row = page.locator("tr.project-task-row", {
      has: page.getByText(task, { exact: true }),
    });
    await expect(row.getByText(chip, { exact: true })).toBeVisible();
  },
);

Then(
  "task {string} has no Workday task any more",
  async ({ page }, task: string) => {
    const row = page.locator("tr.project-task-row", {
      has: page.getByText(task, { exact: true }),
    });
    await expect(row.locator(".project-task-mapping")).toHaveCount(0);
  },
);

When(
  "I set the project's {string} row to {string}",
  async ({ page }, row: string, value: string) => {
    await card(page)
      .getByRole("combobox", { name: `${row}: commits or local only` })
      .click();
    await page.getByRole("option", { name: value, exact: true }).click();
  },
);

Then(
  "task {string} says its project is local only",
  async ({ page }, task: string) => {
    await page.getByText(task, { exact: true }).dblclick();
    const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
    await expect(
      editor.getByText(
        "The project is local only, so this task is never committed.",
      ),
    ).toBeVisible();
    await expect(
      editor.getByRole("combobox", { name: "Commits as" }),
    ).toHaveCount(0);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  },
);

Then("task {string} offers Commits as", async ({ page }, task: string) => {
  await page.getByText(task, { exact: true }).dblclick();
  const editor = page.getByRole("dialog", { name: /^(New|Edit) task$/ });
  await expect(
    editor.getByRole("combobox", { name: "Commits as" }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
});

Then("the {string} section is collapsed", async ({ page }, section: string) => {
  await expect(
    card(page).getByRole("button", { name: section }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(card(page).getByText("Workday name")).toHaveCount(0);
});

When("I open the {string} section", async ({ page }, section: string) => {
  await card(page).getByRole("button", { name: section }).click();
});

Then(
  "{string} shows the default {string}",
  async ({ page }, label: string, value: string) => {
    await expect(
      card(page).getByRole("button", {
        name: `Edit ${label.toLowerCase()}, default ${value}`,
      }),
    ).toBeVisible();
  },
);

Then(
  "{string} shows {string}",
  async ({ page }, label: string, value: string) => {
    await expect(
      card(page).getByRole("button", {
        name: `Edit ${label.toLowerCase()}, ${value}`,
        exact: true,
      }),
    ).toBeVisible();
  },
);

When(
  "I set {string} to {string}",
  async ({ page }, label: string, value: string) => {
    await card(page)
      .getByRole("button", { name: new RegExp(`^Edit ${label.toLowerCase()}`) })
      .click();
    const field = page.getByRole("textbox", { name: label });
    await field.fill(value);
    await field.press("Enter");
  },
);

When("I press Undo on the toast", async ({ page }) => {
  await page.getByRole("button", { name: "Undo", exact: true }).click();
});
