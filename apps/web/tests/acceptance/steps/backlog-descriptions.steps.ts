import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { BacklogDescriptionCapability } from "@ajour/shared";
import {
  descriptionOverview,
  syncWithParentDescription,
} from "../../fixtures/backlog-descriptions";

const { Given, When, Then } = createBdd();

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

async function seedParentDescription(
  page: Page,
  description: string,
  descriptionSync: Record<string, unknown>,
) {
  await page.evaluate(
    ({ description, descriptionSync }) => {
      const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
      const parent = state.workItems.find(
        (item: { _id: string }) => item._id === "parent",
      );
      Object.assign(parent, {
        description,
        descriptionSync,
        sourceUrl: "https://example.test/items/42",
      });
      localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
    },
    { description, descriptionSync },
  );
}

Given(
  "its description was edited here to {string} since its last sync of {string}",
  async ({ page }, local: string, synced: string) => {
    await seedParentDescription(page, local, {
      baseline: synced,
      remote: synced,
    });
  },
);

Given(
  "its plugin, which writes descriptions, sends the description {string} on its next sync",
  async ({ page }, text: string) => {
    await syncParentDescription(page, { write: true }, { text });
  },
);

Given(
  "its description is in conflict between {string} here and {string} in the source",
  async ({ page }, local: string, remote: string) => {
    await seedParentDescription(page, local, {
      baseline: "Original",
      remote,
      conflict: { detectedAt: 1, localText: local, remoteText: remote },
    });
  },
);

When("I choose Resolve in the toast", async ({ page }) => {
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
});

const conflictSection = (page: Page) =>
  page.getByRole("region", { name: "Description conflict on Backlog parent" });

Then(
  "Sync review shows the parent's conflict highlighted, with {string} here and {string} in the source",
  async ({ page }, local: string, remote: string) => {
    await expect(page).toHaveURL(/\/settings\/sync-review\?item=parent/);
    const section = conflictSection(page);
    await expect(section).toHaveAttribute("data-highlighted", "");
    await expect(section.getByText(local, { exact: true })).toBeVisible();
    await expect(section.getByText(remote, { exact: true })).toBeVisible();
  },
);

When("I take the source's description", async ({ page }) => {
  await conflictSection(page)
    .getByRole("button", { name: "Take source", exact: true })
    .click();
});

Then(
  "the parent's description is {string} and its conflict is gone",
  async ({ page }, text: string) => {
    await expect(conflictSection(page)).toHaveCount(0);
    const description = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("ajour.local-state.v2")!,
        ).workItems.find((item: { _id: string }) => item._id === "parent")
          .description,
    );
    expect(description).toBe(text);
    await expect(
      page.getByRole("button", {
        name: "Resolve the sync conflict on Backlog parent",
      }),
    ).toHaveCount(0);
  },
);

const conflictMark = (scope: ReturnType<Page["locator"]>) =>
  scope.getByRole("button", {
    name: "Resolve the sync conflict on Backlog parent",
  });

When(
  "I follow the conflict mark on the parent's sidebar row",
  async ({ page }) => {
    await conflictMark(
      page
        .getByRole("navigation", { name: "Primary navigation" })
        .locator('[data-backlog-item-id="parent"]'),
    ).click();
  },
);

When(
  "I follow the conflict mark on the parent's backlog row",
  async ({ page }) => {
    await page.goto("/backlog");
    await conflictMark(
      page.locator(".backlog-list-row", { hasText: "Backlog parent" }).first(),
    ).click();
  },
);

When(
  "I follow the conflict mark beside the parent's description",
  async ({ page }) => {
    await page.goto("/backlog/parent");
    await expect(page.getByText("Conflict", { exact: true })).toBeVisible();
    await conflictMark(page.locator("main")).click();
  },
);

Then("Sync review opens on the parent's conflict", async ({ page }) => {
  await expect(page).toHaveURL(/\/settings\/sync-review\?item=parent/);
  await expect(conflictSection(page)).toHaveAttribute("data-highlighted", "");
});
