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

function card(page: Page) {
  return page.getByRole("region", { name: "Properties" });
}

// Registered after the Given that mocks an empty overview on the same URL, so it wins.
Given(
  "the Workday \\(agent) plugin adds project properties",
  async ({ page }) => {
    await page.route("http://127.0.0.1:8787/api/connectors", (route) =>
      route.fulfill({
        json: {
          pluginsEnabled: true,
          plugins: [workdayAgent],
          connectionGroups: [
            { plugin: workdayAgent, enabled: true, connections: [] },
          ],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
        headers: cors,
      }),
    );
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
