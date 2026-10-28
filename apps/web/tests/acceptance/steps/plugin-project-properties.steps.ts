import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

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
    await page.getByText(task, { exact: true }).click();
    const editor = page.getByRole("complementary", { name: "Task editor" });
    await editor.getByRole("combobox", { name: "Workday task" }).click();
    await page.getByRole("option", { name: workdayTask, exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
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
