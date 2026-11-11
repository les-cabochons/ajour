import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

const palette = (page: Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const backlogRows = (page: Page) =>
  page.locator(".backlog-workspace [data-work-item-id] .backlog-item-title");
const filterMenu = (page: Page) =>
  page.getByRole("dialog", { name: "Add backlog filter" });

/**
 * Two synced items whose plugin gave no external id, as items synced before
 * Ajour kept it: the rows read 48190 from the link and HRB-412 from the Jira
 * source id. A manual item has neither.
 */
Given("I have backlog items synced with their numbers", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: false,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.addInitScript(() => {
    if (sessionStorage.getItem("finding-fixture")) return;
    localStorage.clear();
    sessionStorage.setItem("finding-fixture", "true");
    const project = (_id: string, name: string, code: string) => ({
      _id,
      name,
      displayName: name,
      code,
      color: "#2563eb",
      icon: { kind: "preset", name: "dot" },
      status: "active",
      tasks: [
        {
          _id: `${_id}-dev`,
          name: "Development",
          status: "active",
          createdAt: 1,
        },
      ],
    });
    const item = (
      _id: string,
      title: string,
      projectId: string,
      extra: Record<string, unknown> = {},
    ) => ({
      _id,
      title,
      status: "active",
      source: "manual",
      projectId,
      taskId: `${projectId}-dev`,
      workflowStateId: "todo",
      createdAt: 1,
      ...extra,
    });
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        workflowStates: [
          { _id: "todo", name: "To do", color: "#64748b", createdAt: 1 },
          {
            _id: "done",
            name: "Done",
            color: "#059669",
            done: true,
            createdAt: 2,
          },
        ],
        projects: [
          project("atlas", "Atlas platform", "ATL"),
          project("harbor", "Harbor mobile", "HRB"),
        ],
        workItems: [
          item("w2", "Week grid: keyboard editing of cells", "atlas", {
            priority: 2,
            source: "azure_devops",
            sourceId: "48190",
            sourceConnectionId: "ado",
            sourceUrl:
              "https://dev.azure.com/contoso/atlas/_workitems/edit/48190",
          }),
          item("w4", "Harbor: offline sync conflict dialog", "harbor", {
            priority: 3,
            source: "jira",
            sourceId: "HRB-412",
            sourceConnectionId: "jira",
            sourceUrl: "https://contoso.atlassian.net/browse/HRB-412",
          }),
          item("w6", "Update expense policy doc", "atlas", { priority: 4 }),
        ],
        timesheetEntries: [],
        timers: [],
      }),
    );
  });
});

When(
  "I search the Backlog page for {string}",
  async ({ page }, query: string) => {
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("searchbox", { name: "Search the backlog" })
      .fill(query);
  },
);

Then(
  "the Backlog page shows only {string}",
  async ({ page }, title: string) => {
    await expect(backlogRows(page)).toHaveText([title]);
  },
);

Then("the Backlog page shows {string}", async ({ page }, title: string) => {
  await expect(
    backlogRows(page).filter({ hasText: new RegExp(`^${title}$`) }),
  ).toHaveCount(1);
});

When("I type {string} in Filter by", async ({ page }, text: string) => {
  await filterMenu(page).getByPlaceholder("Filter by...").fill(text);
});

When("I choose Search for {string}", async ({ page }, text: string) => {
  await filterMenu(page)
    .getByRole("option", { name: `Search for “${text}”` })
    .click();
});

Then(
  "the Backlog search box holds {string}",
  async ({ page }, text: string) => {
    const box = page.getByRole("searchbox", { name: "Search the backlog" });
    await expect(box).toHaveValue(text);
    await expect(filterMenu(page)).toHaveCount(0);
  },
);

When("I press Enter in the command palette", async ({ page }) => {
  // The best match is highlighted first.
  await expect(palette(page).getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
});

When("I press Cmd+K", async ({ page }) => {
  const isMac = await page.evaluate(() =>
    /Mac|iPhone|iPad/.test(navigator.userAgent),
  );
  await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
});

Then("the command palette is closed", async ({ page }) => {
  await expect(palette(page)).toHaveCount(0);
});

When("I open the item page of {string}", async ({ page }, title: string) => {
  await backlogRows(page)
    .filter({ hasText: new RegExp(`^${title}$`) })
    .dblclick();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});

Then("the item page of {string} is open", async ({ page }, title: string) => {
  await expect(page).toHaveURL(/\/backlog\/w\d$/);
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});

Then(
  "the command palette's first section is {string}",
  async ({ page }, heading: string) => {
    await expect(
      palette(page).locator("[cmdk-group-heading]").first(),
    ).toHaveText(heading);
    await expect(
      palette(page).getByRole("option", { name: /^Start entry/ }),
    ).toBeVisible();
  },
);

Then("the new backlog item form is open", async ({ page }) => {
  await expect(
    page.getByRole("textbox", { name: "Item", exact: true }).first(),
  ).toBeFocused();
});

When(
  "I make the backlog item {string} from the page",
  async ({ page }, title: string) => {
    // The filter menu stays open while values are picked.
    await page.keyboard.press("Escape");
    await expect(filterMenu(page)).toHaveCount(0);
    await page
      .getByRole("button", { name: "New backlog item", exact: true })
      .first()
      .click();
    const titleBox = page
      .getByRole("textbox", { name: "Item", exact: true })
      .first();
    await expect(titleBox).toBeFocused();
    await titleBox.fill(title);
    await titleBox.press("Enter");
  },
);

Then(
  "{string} is in project {string}",
  async ({ page }, title: string, projectName: string) => {
    await expect
      .poll(() =>
        page.evaluate(
          ({ title, projectName }) => {
            const state = JSON.parse(
              localStorage.getItem("ajour.local-state.v2") ?? "{}",
            );
            const item = state.workItems?.find(
              (candidate: { title: string }) => candidate.title === title,
            );
            const project = state.projects?.find(
              (candidate: { _id: string }) => candidate._id === item?.projectId,
            );
            return project?.name === projectName;
          },
          { title, projectName },
        ),
      )
      .toBe(true);
  },
);

When("I press Show in the toast", async ({ page }) => {
  await page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Show", exact: true })
    .click();
});

Then("the Backlog has no filters", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: /^Remove .* filter$/ }),
  ).toHaveCount(0);
});
