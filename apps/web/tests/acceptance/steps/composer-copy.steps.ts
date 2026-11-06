import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { timeEntryEditor } from "../../fixtures/time-entry-editor";

const { Given, When, Then } = createBdd();

Given(
  "I have a synced backlog item {string} from Azure DevOps ticket {int}",
  async ({ page }, title: string, ticket: number) => {
    await page.route("**/api/plugins", (route) =>
      route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: {
          pluginsEnabled: true,
          plugins: [],
          connectionGroups: [],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
      }),
    );
    await page.addInitScript(
      ({ title, ticket }) => {
        if (sessionStorage.getItem("composer-copy-fixture")) return;
        sessionStorage.setItem("composer-copy-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            workflowStates: [
              { _id: "doing", name: "Doing", color: "#000000", createdAt: 1 },
            ],
            workItems: [
              {
                _id: "synced-item",
                title,
                source: "azure_devops",
                sourceId: String(ticket),
                sourceConnectionId: "ado-work",
                sourceConnectionLabel: "Contoso",
                sourceProjectName: "Atlas",
                sourceWorkItemType: "Bug",
                sourceStatusKey: "active",
                sourceStatusLabel: "Active",
                sourceUrl: `https://dev.azure.com/contoso/atlas/_workitems/edit/${ticket}`,
                workflowStateId: "doing",
                status: "active",
                priority: 2,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
        );
      },
      { title, ticket },
    );
  },
);

When("I edit {string} from the Backlog", async ({ page }, title: string) => {
  await page.goto("/backlog");
  await page
    .getByRole("main")
    .getByText(title, { exact: true })
    .first()
    .click();
  await page.keyboard.press("Space");
  await page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Edit backlog item" }),
  ).toBeVisible();
});

When("I select its ticket line in the editor and copy it", async ({ page }) => {
  const line = page
    .getByRole("dialog", { name: "Edit backlog item" })
    .getByText(/^#\d+ · /);
  const box = (await line.boundingBox())!;
  // A drag from the line's first letter to past its end, as a user selects.
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await page.keyboard.press("ControlOrMeta+c");
});

Then(
  "the editor's ticket line still offers Open in source",
  async ({ page }) => {
    await expect(
      page
        .getByRole("dialog", { name: "Edit backlog item" })
        .getByRole("link", { name: "Open in source" }),
    ).toHaveAttribute(
      "href",
      "https://dev.azure.com/contoso/atlas/_workitems/edit/48213",
    );
  },
);

When(
  "I press Copy with focus on the entry editor's project chip",
  async ({ page }) => {
    await timeEntryEditor(page)
      .getByRole("button", { name: /Project or task|Atlas|Client/ })
      .first()
      .focus();
    await page.keyboard.press("ControlOrMeta+c");
  },
);
