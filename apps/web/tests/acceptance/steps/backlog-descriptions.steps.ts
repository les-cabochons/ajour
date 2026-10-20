import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { BacklogDescriptionCapability } from "@ajour/shared";
import {
  descriptionOverview,
  syncWithParentDescription,
} from "../../fixtures/backlog-descriptions";

const { Given, Then } = createBdd();

const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };

async function syncParentDescription(
  page: Page,
  capability: BacklogDescriptionCapability,
  description: { text: string; cut?: boolean },
) {
  await page.route(`${apiUrl}/api/plugins`, (route) =>
    route.fulfill({ json: descriptionOverview(capability), headers: cors }),
  );
  await page.route(
    `${apiUrl}/api/plugins/example/connections/fixture/sync`,
    (route) =>
      route.fulfill({
        json: syncWithParentDescription(description),
        headers: cors,
      }),
  );
}

Given(
  "its plugin, which does not write descriptions, sends the description {string} on its next sync",
  async ({ page }, text: string) => {
    await syncParentDescription(page, {}, { text });
  },
);

Given(
  "its plugin, which writes descriptions, sends a description cut to {string} on its next sync",
  async ({ page }, text: string) => {
    await syncParentDescription(page, { write: true }, { text, cut: true });
  },
);

Then("its description reads {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then(
  "the description is read-only because the source keeps it, with Edit in source",
  async ({ page }) => {
    await expect(
      page.getByText("Synced from the source, which keeps this description."),
    ).toBeVisible();
    await expectReadOnlyWithEditInSource(page);
  },
);

Then(
  "the description is read-only because it is cut, with Edit in source",
  async ({ page }) => {
    await expect(
      page.getByText("Longer than Ajour keeps, so it shows cut off."),
    ).toBeVisible();
    await expectReadOnlyWithEditInSource(page);
  },
);

async function expectReadOnlyWithEditInSource(page: Page) {
  const editInSource = page.getByRole("link", { name: "Edit in source" });
  await expect(editInSource).toHaveAttribute(
    "href",
    "https://example.test/items/42",
  );
  // No Edit button beside the Description heading.
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
}
