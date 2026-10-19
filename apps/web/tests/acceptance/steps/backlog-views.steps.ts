import { expect, type Locator, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();
/** The peek beside the Backlog list. */
const peekPanel = (page: Page) =>
  page.getByRole("complementary", { name: "Backlog item peek" });
Given("I have a backlog view fixture", async ({ page }) => {
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
    if (sessionStorage.getItem("backlog-fixture")) return;
    localStorage.clear();
    sessionStorage.setItem("backlog-fixture", "true");
    const now = Date.now();
    const base = {
      source: "manual",
      status: "active",
      projectId: "p",
      taskId: "t",
      workflowStateId: "todo",
      createdAt: now,
    };
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        workflowStates: [
          { _id: "todo", name: "To do", color: "#64748b", createdAt: 1 },
          { _id: "doing", name: "In progress", color: "#d97706", createdAt: 1 },
          {
            _id: "done",
            name: "Done",
            color: "#059669",
            done: true,
            createdAt: 1,
          },
        ],
        projects: [
          {
            _id: "p",
            name: "Example project",
            displayName: "Example project",
            status: "active",
            color: "#059669",
            tasks: [
              {
                _id: "t",
                name: "Example task",
                status: "active",
                createdAt: 1,
              },
            ],
          },
        ],
        workItems: [
          {
            ...base,
            _id: "parent",
            title: "Backlog parent",
            priority: 1,
            remainingEstimateHours: 3,
          },
          {
            ...base,
            _id: "child",
            title: "Backlog subitem",
            parentWorkItemId: "parent",
            priority: 2,
          },
          {
            ...base,
            _id: "other",
            title: "Other backlog item",
            workflowStateId: "doing",
            priority: 3,
          },
          {
            ...base,
            _id: "old",
            title: "Old done item",
            status: "archived",
            workflowStateId: "done",
            workflowStateIdBeforeClose: "todo",
            archivedAt: 1,
          },
          {
            ...base,
            _id: "missing",
            title: "Missing sync item",
            status: "archived",
            workflowStateId: "done",
            archivedByMissingSync: true,
            archivedAt: now,
          },
        ],
      }),
    );
  });
});
When("I choose the Backlog board", async ({ page }) => {
  await page.getByRole("button", { name: "Board layout", exact: true }).click();
});
Then(
  "the Backlog has workflow columns and standalone subitems",
  async ({ page }) => {
    await expect(page.locator(".backlog-board")).toBeVisible();
    await expect(page.locator(".backlog-board-column")).toHaveCount(3);
    await expect(page.locator('[data-work-item-id="child"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New item in Done" }),
    ).toHaveCount(0);
  },
);
When("I narrow the Backlog window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});
When("I widen the Backlog window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});
Then("the saved board uses a narrow list", async ({ page }) => {
  await expect(page.locator(".backlog-board")).toHaveCount(0);
  await expect(page.locator('[data-work-item-id="parent"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Board layout", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("ajour.backlog-view")!).layout,
    ),
  ).toBe("board");
});
Then(
  "the narrow Backlog adds items from its group headers only",
  async ({ page }) => {
    // The floating New backlog item button is gone; group headers add instead.
    await expect(
      page.getByRole("button", { name: "New backlog item", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^New item in / }).first(),
    ).toBeVisible();
  },
);
Given("the other Backlog item has 1.5 hours remaining", async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    const other = state.workItems.find(
      (item: { _id: string }) => item._id === "other",
    );
    other.remainingEstimateHours = 1.5;
    localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
  });
  await page.reload();
});
function otherSidebarRow(page: Page) {
  return page
    .getByRole("navigation", { name: "Primary navigation" })
    .locator('[data-backlog-item-id="other"]');
}
Then(
  "the other item's sidebar row shows {string} and {string}",
  async ({ page }, project: string, logged: string) => {
    const row = otherSidebarRow(page);
    await expect(row).toContainText(project);
    await expect(row).toContainText("Other backlog item");
    await expect(row).toContainText(logged);
  },
);
Then(
  "the other item's sidebar row shows its workflow state {string}",
  async ({ page }, state: string) => {
    const row = otherSidebarRow(page);
    const stateLine = row.getByText(state, { exact: true });
    await expect(stateLine).toBeVisible();
    const tertiary = await row.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--text-tertiary")
        .trim(),
    );
    await expect(stateLine).toHaveCSS("color", tertiary);
  },
);
When("I press S on the other item on the Backlog page", async ({ page }) => {
  await page.locator('[data-work-item-id="other"]').focus();
  await page.keyboard.press("s");
});
When(
  "I use the {string} Backlog sidebar",
  async ({ page }, density: string) => {
    await page.evaluate(async (density) => {
      const { updateSidebarLayout } = await import(
        /* @vite-ignore */ "/src/lib/sidebar-layout.ts"
      );
      updateSidebarLayout({ density });
    }, density);
  },
);
When("I press S on the other item in the sidebar", async ({ page }) => {
  await otherSidebarRow(page).focus();
  await page.keyboard.press("s");
});
const runningWorkItemIds = (page: Page) =>
  page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).timers ?? []
    ).map((timer: { workItemId?: string }) => timer.workItemId),
  );
Then("an entry runs on {string}", async ({ page }, workItemId: string) => {
  await expect.poll(() => runningWorkItemIds(page)).toEqual([workItemId]);
});
Then("no entry runs", async ({ page }) => {
  await expect.poll(() => runningWorkItemIds(page)).toEqual([]);
});
When("I hover the other item in the sidebar", async ({ page }) => {
  const row = otherSidebarRow(page);
  const title = row.locator("[data-row-title]");
  const before = await title.boundingBox();
  await row.hover();
  expect(await title.boundingBox()).toEqual(before);
});
Then(
  'its sidebar row offers Start entry, Snooze and Settle without a "…" button',
  async ({ page }) => {
    const row = otherSidebarRow(page);
    for (const name of ["Start entry", "Snooze…", "Settle"]) {
      await expect(
        row.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      row.getByRole("button", { name: "Actions for Other backlog item" }),
    ).toHaveCount(0);
  },
);
function subitemSidebarRow(page: Page) {
  return page
    .getByRole("navigation", { name: "Primary navigation" })
    .locator('[data-backlog-item-id="child"]');
}
Then(
  "the subitem's sidebar row does not show its parent's title",
  async ({ page }) => {
    const row = subitemSidebarRow(page);
    await expect(row).toContainText("Backlog subitem");
    await expect(row).not.toContainText("Backlog parent");
  },
);
When("I open the parent from the subitem's sidebar arrow", async ({ page }) => {
  const row = subitemSidebarRow(page);
  await row.hover();
  const arrow = row.getByRole("button", {
    name: "Open parent: Backlog parent",
    exact: true,
  });
  await arrow.hover();
  await expect(
    page.locator('[data-slot="tooltip-content"][data-open]'),
  ).toHaveText("Backlog parent");
  await arrow.click();
});
Then("the Backlog parent page is open", async ({ page }) => {
  await expect(page).toHaveURL(/\/backlog\/parent$/);
});
When(
  "I {string} the other Backlog item from its sidebar menu",
  async ({ page }, action: string) => {
    await otherSidebarRow(page).click({ button: "right" });
    await page.getByRole("menuitem", { name: action, exact: true }).click();
  },
);
Then("the other item is pinned at the top of the sidebar", async ({ page }) => {
  const rows = page
    .getByRole("navigation", { name: "Primary navigation" })
    .locator("[data-backlog-item-id]");
  await expect(rows.first()).toHaveAttribute("data-backlog-item-id", "other");
  // Wait for the menu to restore focus, then move it outside the row so
  // its markers show instead of the hover and focus actions.
  await expect(page.getByRole("menu")).toHaveCount(0);
  const search = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Search", exact: true });
  await search.focus();
  await expect(search).toBeFocused();
  await page.getByRole("main").hover();
  await expect(
    otherSidebarRow(page).getByRole("img", { name: "Pinned" }),
  ).toBeVisible();
});
Then("the other item is not pinned", async ({ page }) => {
  await expect(
    otherSidebarRow(page).getByRole("img", { name: "Pinned" }),
  ).toHaveCount(0);
});
/**
 * Toggles one value in the open Filter popover, which stays open. A previous
 * pick leaves the popover on its field's values, so this goes back first.
 */
async function pickBacklogFilter(page: Page, field: string, value: string) {
  const filters = page.getByRole("dialog", { name: "Add backlog filter" });
  const back = filters.getByRole("button");
  if (await back.isVisible()) await back.click();
  await filters.getByRole("option", { name: field, exact: true }).click();
  await filters.getByRole("option", { name: value, exact: true }).click();
}
When("I filter the Backlog to Urgent", async ({ page }) => {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await pickBacklogFilter(page, "Priority", "Urgent");
  await page.keyboard.press("Escape");
});
Then("only urgent items appear on the Backlog page", async ({ page }) => {
  await expect(
    page.locator(".backlog-workspace [data-work-item-id]"),
  ).toHaveCount(1);
  await expect(page.locator('[data-work-item-id="parent"]')).toBeVisible();
});
Then("the sidebar still contains the other Backlog items", async ({ page }) => {
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toContainText("Other backlog item");
});
When(
  "I filter the Backlog by {string} {string}",
  async ({ page }, field: string, value: string) => {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await pickBacklogFilter(page, field, value);
    await page.keyboard.press("Escape");
  },
);
Then("the filter row has one chip per field", async ({ page }) => {
  await page.keyboard.press("Escape");
  const state = page.getByRole("button", { name: "Edit State filter" });
  await expect(state).toHaveCount(1);
  await expect(state).toHaveText("StateTo do, No state");
  await expect(
    page.getByRole("button", { name: "Edit Project filter" }),
  ).toHaveCount(1);
});
When("I open the Backlog filters", async ({ page }) => {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
});
When(
  "I pick the {string} filter {string}",
  async ({ page }, field: string, value: string) => {
    await pickBacklogFilter(page, field, value);
  },
);
Then(
  "only the Backlog parent and its subitem appear on the Backlog page",
  async ({ page }) => {
    const rows = page.locator(".backlog-workspace [data-work-item-id]");
    await expect(rows).toHaveCount(2);
    await expect(page.locator('[data-work-item-id="parent"]')).toBeVisible();
    await expect(page.locator('[data-work-item-id="child"]')).toBeVisible();
  },
);
When("I remove the Urgent filter", async ({ page }) => {
  await page.getByRole("button", { name: "Remove Priority filter" }).click();
});
Then("all open Backlog items return", async ({ page }) => {
  await expect(
    page.locator(".backlog-workspace [data-work-item-id]"),
  ).toHaveCount(3);
});
When("I peek at the Backlog parent", async ({ page }) => {
  await page
    .locator('[data-work-item-id="parent"] .backlog-item-title')
    .click();
});
When(
  "I reselect the current peek project with {string}",
  async ({ page }, control: string) => {
    const project = peekPanel(page).getByRole("combobox", { name: "Project" });
    await expect(project).toHaveValue("Example project");
    await project.click();
    if (control === "Enter") {
      await project.press("Enter");
    } else {
      await page
        .getByRole("option", { name: "Example project", exact: true })
        .click();
    }
    await expect(page.getByRole("listbox")).toHaveCount(0);
  },
);
Then("the peek retains the parent's project and task", async ({ page }) => {
  await expect(
    peekPanel(page).getByRole("combobox", { name: "Project" }),
  ).toHaveValue("Example project");
  await expect(
    peekPanel(page).getByRole("combobox", { name: "Task" }),
  ).toHaveValue("Example task");
  const parent = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
      (item: { _id: string }) => item._id === "parent",
    ),
  );
  expect(parent).toMatchObject({ projectId: "p", taskId: "t" });
});
When("I clear the peek project", async ({ page }) => {
  await peekPanel(page).getByRole("combobox", { name: "Project" }).click();
  await page.getByRole("option", { name: "No project", exact: true }).click();
});
Then("the peek has no project or task", async ({ page }) => {
  await expect(
    peekPanel(page).getByRole("combobox", { name: "Project" }),
  ).toHaveValue("");
  const task = peekPanel(page).getByRole("combobox", { name: "Task" });
  await expect(task).toHaveValue("");
  await expect(task).toBeDisabled();
  const parent = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
      (item: { _id: string }) => item._id === "parent",
    ),
  );
  expect(parent.projectId).toBeUndefined();
  expect(parent.taskId).toBeUndefined();
});
When("I start an entry from the Backlog peek", async ({ page }) => {
  const start = page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Start entry", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  // Stop takes Start entry's place while the item's entry runs.
  await expect(
    page
      .getByRole("complementary", { name: "Backlog item peek" })
      .getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    sessionStorage.setItem(
      "peek-running-entry",
      JSON.stringify({
        _id: state.timers[0]._id,
        startedAt: state.timers[0].startedAt,
      }),
    );
  });
});
Then("the parent peek cannot restart its running entry", async ({ page }) => {
  const peek = page.getByRole("complementary", { name: "Backlog item peek" });
  // The running item offers Stop where Start entry was, never a restart.
  await expect(
    peek.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(
    peek.getByRole("button", { name: "Start entry", exact: true }),
  ).toHaveCount(0);
  // The row's actions take pointer events only once the row is hovered.
  const parentRow = page.locator('[data-work-item-id="parent"]');
  await parentRow.hover();
  await parentRow
    .getByRole("button", { name: "Actions for Backlog parent", exact: true })
    .click();
  await expect(page.getByRole("menuitem", { name: /^Stop/ })).toBeEnabled();
  await expect(
    page.getByRole("menuitem", { name: /^Start entry/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(peek).toBeVisible();
  const snapshot = await page.evaluate(() => ({
    state: JSON.parse(localStorage.getItem("ajour.local-state.v2")!),
    baseline: JSON.parse(sessionStorage.getItem("peek-running-entry")!),
  }));
  expect(snapshot.state.timers).toEqual([
    expect.objectContaining({ ...snapshot.baseline, workItemId: "parent" }),
  ]);
  expect(snapshot.state.timesheetEntries).toEqual([]);
});

When("I peek at the other Backlog item", async ({ page }) => {
  await page.locator('[data-work-item-id="other"] .backlog-item-title').click();
});
Then("the other peek can start an entry", async ({ page }) => {
  await expect(
    page
      .getByRole("complementary", { name: "Backlog item peek" })
      .getByRole("button", { name: "Start entry", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("complementary", { name: "Backlog item peek" })
      .getByRole("button", { name: "Start entry", exact: true }),
  ).toHaveAccessibleDescription("");
});
When(
  "I stop the Backlog running entry from the timer dock",
  async ({ page }) => {
    await page
      .getByRole("button", { name: "Edit the running entry", exact: true })
      .click();
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole("button", { name: "Stop", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit the running entry", exact: true }),
    ).toHaveCount(0);
  },
);
Then("the parent peek can start a new entry after Stop", async ({ page }) => {
  const start = page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Start entry", exact: true });
  await expect(start).toBeEnabled();
  await expect(start).toHaveAccessibleDescription("");
  await start.hover();
  await expect(
    page.locator('[data-slot="tooltip-content"][data-open]'),
  ).toHaveText("Start entry");
  await start.click();
  const peek = page.getByRole("complementary", { name: "Backlog item peek" });
  await expect(
    peek.getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
  await expect(start).toHaveCount(0);
  const snapshot = await page.evaluate(() => ({
    state: JSON.parse(localStorage.getItem("ajour.local-state.v2")!),
    baseline: JSON.parse(sessionStorage.getItem("peek-running-entry")!),
  }));
  expect(snapshot.state.timesheetEntries).toEqual([
    expect.objectContaining({ workItemId: "parent" }),
  ]);
  expect(snapshot.state.timers).toHaveLength(1);
  expect(snapshot.state.timers[0].workItemId).toBe("parent");
  expect(snapshot.state.timers[0]._id).not.toBe(snapshot.baseline._id);
});
function parentSidebarRow(page: Page) {
  return page
    .getByRole("navigation", { name: "Primary navigation" })
    .locator('[data-backlog-item-id="parent"]');
}
Then(
  "the parent's sidebar row offers Stop instead of Start entry",
  async ({ page }) => {
    const row = parentSidebarRow(page);
    await row.hover();
    await expect(
      row.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Start entry", exact: true }),
    ).toHaveCount(0);
  },
);
When("I stop the parent's entry from its sidebar row", async ({ page }) => {
  const row = parentSidebarRow(page);
  await row.hover();
  await row.getByRole("button", { name: "Stop", exact: true }).click();
});
Then(
  "the sidebar Start icon enables the parent without a disabled reason",
  async ({ page }) => {
    const row = page
      .getByRole("navigation", { name: "Primary navigation" })
      .locator('[data-backlog-item-id="parent"]');
    await row.hover();
    const start = row.getByRole("button", { name: "Start entry", exact: true });
    await expect(start).toBeEnabled();
    await expect(start).toHaveAccessibleDescription("");
    await start.hover();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toHaveCount(0);
  },
);
When("I use the Backlog {string} layout", async ({ page }, layout: string) => {
  await page
    .getByRole("button", { name: `${layout} layout`, exact: true })
    .click();
});
Then("the parent row offers Stop for its running entry", async ({ page }) => {
  const row = page.locator('[data-work-item-id="parent"]');
  await row.hover();
  await expect(
    row.getByRole("button", { name: "Stop Backlog parent", exact: true }),
  ).toBeEnabled();
  await expect(
    row.getByRole("button", { name: "Start Backlog parent", exact: true }),
  ).toHaveCount(0);
  const other = page.locator('[data-work-item-id="other"]');
  await other.hover();
  await expect(
    other.getByRole("button", {
      name: "Switch to Other backlog item",
      exact: true,
    }),
  ).toBeEnabled();
});
Then(
  "the parent Start icon is enabled without a disabled reason",
  async ({ page }) => {
    const row = page.locator('[data-work-item-id="parent"]');
    await row.hover();
    const start = row.getByRole("button", {
      name: "Start Backlog parent",
      exact: true,
    });
    await expect(start).toBeEnabled();
    await expect(start).toHaveAccessibleDescription("");
    await start.hover();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toHaveText("Start Backlog parent");
  },
);
/** Labels of the Display popover's choices, by the value the steps name. */
const DISPLAY_OPTION_LABELS: Record<string, string> = {
  state: "Workflow state",
  priority: "Priority",
  project: "Project",
  none: "None",
  custom: "Custom",
  priority_asc: "Priority",
  created: "Created",
  remaining: "Remaining estimate",
  title: "Title",
  week: "Past week",
  all: "All",
};

/**
 * Picks an option in one of the shadcn selects: opens the combobox named
 * `label`, then clicks the option. `choice` is a value from the maps above or
 * the option's own label.
 */
async function chooseSelectOption(page: Page, label: string, choice: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("option", {
      name: DISPLAY_OPTION_LABELS[choice] ?? choice,
      exact: true,
    })
    .click();
}

async function inspectBacklogStart(
  page: Page,
  control: string,
  running: boolean,
) {
  let action: Locator;
  if (control === "command palette") {
    const isMac = await page.evaluate(() =>
      /Mac|iPhone|iPad/.test(navigator.userAgent),
    );
    await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette
      .getByRole("combobox", { name: "Search commands" })
      .fill("Backlog parent");
    await palette
      .getByRole("option")
      .filter({ hasText: "Backlog parent" })
      .first()
      .click();
    action = palette.getByRole("option", {
      name: running ? /^Stop/ : /^Start entry/,
    });
  } else {
    if (control === "item page") {
      if (!new URL(page.url()).pathname.endsWith("/backlog/parent")) {
        await page
          .getByRole("complementary", { name: "Backlog item peek" })
          .getByRole("button", { name: "Open page", exact: true })
          .click();
      }
      // The item page's actions sit in the top bar, beside its breadcrumb.
      // It has no "…" menu, so its Start entry or Stop button is the check.
      await expect(
        page.locator(".ajour-page-header-slot").getByRole("button", {
          name: running ? "Stop" : "Start entry",
          exact: true,
        }),
      ).toBeEnabled();
      return;
    } else if (control === "editor") {
      const editor = page.getByRole("complementary", {
        name: "Backlog item editor",
      });
      if ((await editor.count()) === 0) {
        await page
          .getByRole("complementary", { name: "Backlog item peek" })
          .getByRole("button", { name: "Edit", exact: true })
          .click();
      }
      await editor
        .getByRole("button", {
          name: "Actions for Backlog parent",
          exact: true,
        })
        .click();
    } else if (control === "sidebar") {
      const row = page
        .getByRole("navigation", { name: "Primary navigation" })
        .locator('[data-backlog-item-id="parent"]');
      // Rows show Start entry, or Stop on the running item, on hover.
      await row.hover();
      const button = row.getByRole("button", {
        name: running ? "Stop" : "Start entry",
        exact: true,
      });
      await expect(button).toBeEnabled();
      await row.click({ button: "right" });
    } else {
      throw new Error(`Unknown Backlog control: ${control}`);
    }
    action = page.getByRole("menuitem", {
      name: running ? /^Stop/ : /^Start entry/,
    });
  }
  // Stop takes Start entry's slot while the item's entry runs.
  await expect(action).toBeEnabled();
  await page.keyboard.press("Escape");
  if (control === "command palette") {
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toHaveCount(0);
  } else {
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
}
Then(
  "Stop replaces Start entry for the running item in the {string}",
  async ({ page }, control: string) => {
    await inspectBacklogStart(page, control, true);
  },
);
Then(
  "Start entry is enabled after Stop in the {string}",
  async ({ page }, control: string) => {
    await inspectBacklogStart(page, control, false);
  },
);
Then("the running entry has not restarted", async ({ page }) => {
  const snapshot = await page.evaluate(() => ({
    state: JSON.parse(localStorage.getItem("ajour.local-state.v2")!),
    baseline: JSON.parse(sessionStorage.getItem("peek-running-entry")!),
  }));
  expect(snapshot.state.timers).toEqual([
    expect.objectContaining({ ...snapshot.baseline, workItemId: "parent" }),
  ]);
  expect(snapshot.state.timesheetEntries).toEqual([]);
});
Then("the peek shows the parent and its subitem", async ({ page }) => {
  const peek = page.getByRole("complementary", { name: "Backlog item peek" });
  await expect(peek).toContainText("Backlog parent");
  await expect(peek).toContainText("Backlog subitem");
  await expect(
    peek.getByRole("button", { name: "Start entry", exact: true }),
  ).toBeVisible();
});
When("I edit the parent from the peek", async ({ page }) => {
  await page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
});
When("I save the parent title as {string}", async ({ page }, title: string) => {
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await editor.getByRole("textbox", { name: "Item", exact: true }).fill(title);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
});
Then("the peek shows {string}", async ({ page }, title: string) => {
  await expect(
    page
      .getByRole("complementary", { name: "Backlog item peek" })
      .getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
});
When("I close the Backlog peek with Escape", async ({ page }) => {
  await page.keyboard.press("Escape");
});
Then("the Backlog peek is closed", async ({ page }) => {
  await expect(
    page.getByRole("complementary", { name: "Backlog item peek" }),
  ).toHaveCount(0);
});
Given(
  "the Backlog parent has returned through {string}",
  async ({ page }, reason: string) => {
    await page.evaluate((reason) => {
      const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
      const parent = state.workItems.find(
        (item: { _id: string }) => item._id === "parent",
      );
      if (reason === "sync") parent.returnedAt = Date.now() - 1000;
      else if (reason === "expired snooze")
        parent.snoozedUntil = Date.now() - 1000;
      else throw new Error(`Unknown return reason: ${reason}`);
      localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
    }, reason);
    await page.reload();
  },
);
Then("the parent has a Returned mark in the sidebar", async ({ page }) => {
  await expect(
    page.getByRole("button", {
      name: "Clear the returned mark on Backlog parent",
      exact: true,
    }),
  ).toBeVisible();
});
When(
  "I open the parent peek with {string}",
  async ({ page }, control: string) => {
    const row = page.locator('[data-work-item-id="parent"]');
    if (control === "click") await row.locator(".backlog-item-title").click();
    else if (control === "Space") {
      await row.focus();
      await page.keyboard.press("Space");
    } else throw new Error(`Unknown peek control: ${control}`);
  },
);
Then("the peek clears the parent's Returned mark", async ({ page }) => {
  await expect(
    page.getByRole("complementary", { name: "Backlog item peek" }),
  ).toContainText("Backlog parent");
  await expect(
    page.getByRole("button", {
      name: "Clear the returned mark on Backlog parent",
      exact: true,
    }),
  ).toHaveCount(0);
  const parent = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
      (item: { _id: string }) => item._id === "parent",
    ),
  );
  expect(parent.returnedAt).toBeUndefined();
  expect(parent.snoozedUntil).toBeUndefined();
});
Then("the parent's Returned mark remains cleared", async ({ page }) => {
  await expect(page.locator('[data-work-item-id="parent"]')).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Clear the returned mark on Backlog parent",
      exact: true,
    }),
  ).toHaveCount(0);
});
Given("an archived project still has a Backlog item", async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    state.projects.push({
      _id: "archived-project",
      name: "Archived project",
      displayName: "Archived project",
      status: "archived",
      color: "#64748b",
      tasks: [],
    });
    state.workItems.push({
      _id: "archived-assigned",
      title: "Historical assignment",
      projectId: "archived-project",
      workflowStateId: "todo",
      source: "manual",
      status: "active",
      createdAt: 1,
    });
    localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
  });
  await page.reload();
});
When(
  "I show Backlog projects as {string}",
  async ({ page }, presentation: string) => {
    await page.getByRole("button", { name: "Display", exact: true }).click();
    await chooseSelectOption(
      page,
      "Grouping",
      presentation === "groups" ? "project" : "state",
    );
    if (presentation === "swimlanes")
      await chooseSelectOption(page, "Swimlanes", "project");
    await page.keyboard.press("Escape");
  },
);
Then(
  "the archived project shows its item without creation controls",
  async ({ page }) => {
    const group = page.getByRole("region", {
      name: "Archived project",
      exact: true,
    });
    await expect(
      group.locator('[data-work-item-id="archived-assigned"]'),
    ).toBeVisible();
    await expect(group.getByText("Archived", { exact: true })).toBeVisible();
    await expect(
      group.getByRole("button", { name: /^New item in / }),
    ).toHaveCount(0);
  },
);
When(
  "I try to drag the other card into the archived project",
  async ({ page }) => {
    await page.evaluate(() =>
      sessionStorage.setItem(
        "before-archived-project-drop",
        JSON.stringify(
          JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems,
        ),
      ),
    );
    const from = await page
      .locator('[data-work-item-id="other"] .backlog-item-title')
      .boundingBox();
    const to = await page
      .locator('[data-work-item-id="archived-assigned"]')
      .boundingBox();
    await page.mouse.move(from!.x + 20, from!.y + 8);
    await page.mouse.down();
    await page.mouse.move(to!.x + 40, to!.y + to!.height - 6, { steps: 10 });
    await expect(
      page
        .getByRole("region", { name: "Archived project", exact: true })
        .locator(".is-drop-target"),
    ).toHaveCount(0);
    await page.mouse.up();
  },
);
Then(
  "the other card's assignment and custom order have not changed",
  async ({ page }) => {
    const snapshot = await page.evaluate(() => ({
      current: JSON.parse(localStorage.getItem("ajour.local-state.v2")!)
        .workItems,
      before: JSON.parse(
        sessionStorage.getItem("before-archived-project-drop")!,
      ),
    }));
    expect(snapshot.current).toEqual(snapshot.before);
    await expect(
      page
        .getByRole("region", { name: "Example project", exact: true })
        .locator('[data-work-item-id="other"]'),
    ).toBeVisible();
  },
);
When(
  "I create a Backlog item in the active project group",
  async ({ page }) => {
    await page
      .getByRole("region", { name: "Example project", exact: true })
      .getByRole("button", { name: /^New item in / })
      .first()
      .click();
  },
);
Then("the new editor uses the active project", async ({ page }) => {
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("combobox", { name: "Project", exact: true }),
  ).toHaveValue("Example project");
});
Given("the archived project has enough cards to scroll", async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    const original = state.workItems.find(
      (item: { _id: string }) => item._id === "archived-assigned",
    );
    state.workItems.push(
      ...Array.from({ length: 20 }, (_, index) => ({
        ...original,
        _id: `archived-scroll-${index}`,
        title: `Archived project item ${index}`,
      })),
    );
    localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
  });
  await page.reload();
});
Then("the archived swimlane allows native touch handling", async ({ page }) => {
  const archived = page
    .getByRole("region", { name: "Archived project", exact: true })
    .locator("[data-work-item-id]");
  expect(
    await archived.evaluateAll((cards) =>
      cards.map((card) => getComputedStyle(card).touchAction),
    ),
  ).toEqual(Array(await archived.count()).fill("auto"));
  expect(
    await page
      .locator('[data-work-item-id="other"]')
      .evaluate((card) => getComputedStyle(card).touchAction),
  ).toBe("none");
});
async function swipeBacklogItem(page: Page, itemId: string) {
  const card = page.locator(`[data-work-item-id="${itemId}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.evaluate((card) => {
    let container = card.parentElement;
    while (
      container &&
      !(
        container.scrollHeight > container.clientHeight &&
        /auto|scroll/.test(getComputedStyle(container).overflowY)
      )
    )
      container = container.parentElement;
    if (!container) throw new Error("No scrollable Backlog container");
    container.setAttribute("data-acceptance-backlog-scroll", "true");
    sessionStorage.setItem(
      "backlog-swipe-scroll-top",
      String(container.scrollTop),
    );
  });
  const bounds = await card.boundingBox();
  const x = bounds!.x + 40;
  const y = bounds!.y + Math.min(60, bounds!.height - 8);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 10; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - step * 15 }],
      });
      await expect(page.locator("body")).not.toHaveClass(/backlog-drag-active/);
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}
async function expectNativeBacklogScroll(page: Page) {
  const baseline = await page.evaluate(() =>
    Number(sessionStorage.getItem("backlog-swipe-scroll-top")),
  );
  await expect
    .poll(() =>
      page
        .locator('[data-acceptance-backlog-scroll="true"]')
        .evaluate((container) => container.scrollTop),
    )
    .toBeGreaterThan(baseline);
  await expect(page.locator("body")).not.toHaveClass(/backlog-drag-active/);
  await expect(page.locator(".is-drop-target")).toHaveCount(0);
}
When("I swipe upward from an archived project card", async ({ page }) => {
  await swipeBacklogItem(page, "archived-assigned");
});
Then("the board scrolls without starting a drag", async ({ page }) => {
  await expectNativeBacklogScroll(page);
});
Given("the Backlog has enough items to scroll", async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    const parent = state.workItems.find(
      (item: { _id: string }) => item._id === "parent",
    );
    state.workItems.push(
      ...Array.from({ length: 20 }, (_, index) => ({
        ...parent,
        _id: `scroll-${index}`,
        title: `Scrolling item ${index}`,
      })),
    );
    localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
  });
  await page.reload();
});
When("I use an ungrouped Backlog list ordered by Title", async ({ page }) => {
  await page.getByRole("button", { name: "List layout", exact: true }).click();
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await chooseSelectOption(page, "Grouping", "none");
  await chooseSelectOption(page, "Ordering", "title");
  await page.keyboard.press("Escape");
});
When("I order the Backlog by {string}", async ({ page }, order: string) => {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await chooseSelectOption(page, "Ordering", order);
  await page.keyboard.press("Escape");
});
When("I swipe upward from a sorted Backlog row", async ({ page }) => {
  await swipeBacklogItem(page, "parent");
});
Then("the list scrolls without starting a drag", async ({ page }) => {
  await expectNativeBacklogScroll(page);
});
Then("the ungrouped custom list remains draggable", async ({ page }) => {
  const items = page.locator(
    '[data-work-item-id]:not([data-work-item-id="child"])',
  );
  expect(
    await items.evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).touchAction),
    ),
  ).toEqual(Array(await items.count()).fill("none"));
  await expect(page.locator('[data-work-item-id="child"]')).not.toHaveCSS(
    "touch-action",
    "none",
  );
});
When("I record the Backlog custom order", async ({ page }) => {
  await page.evaluate(() =>
    sessionStorage.setItem(
      "subitem-order",
      JSON.stringify(
        JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.map(
          (item: { _id: string }) => item._id,
        ),
      ),
    ),
  );
});
async function expectSubitemOrderUnchanged(page: Page) {
  const snapshot = await page.evaluate(() => ({
    order: JSON.parse(
      localStorage.getItem("ajour.local-state.v2")!,
    ).workItems.map((item: { _id: string }) => item._id),
    before: JSON.parse(sessionStorage.getItem("subitem-order")!),
  }));
  expect(snapshot.order).toEqual(snapshot.before);
}
When(
  "I try to reorder the subitem with keys, requests and a pointer",
  async ({ page }) => {
    const child = page.locator('[data-work-item-id="child"]');
    await expect(child).not.toHaveCSS("touch-action", "none");
    for (const key of ["Alt+ArrowUp", "Alt+ArrowDown"]) {
      await child.focus();
      await child.press(key);
      await expectSubitemOrderUnchanged(page);
    }
    for (const action of ["move-up", "move-down"]) {
      await page.goto(`/backlog?action=${action}&target=child`);
      await page.waitForURL((url) => !url.searchParams.has("action"));
      await expectSubitemOrderUnchanged(page);
    }
    const from = await child.locator(".backlog-item-title").boundingBox();
    const to = await page.locator('[data-work-item-id="other"]').boundingBox();
    await page.mouse.move(from!.x + 20, from!.y + 8);
    await page.mouse.down();
    await page.mouse.move(to!.x + 40, to!.y + to!.height - 3, { steps: 10 });
    await expect(page.locator(".backlog-drag-overlay")).toHaveCount(0);
    await page.mouse.up();
    await expectSubitemOrderUnchanged(page);
  },
);
Then("the Backlog custom order remains unchanged", async ({ page }) => {
  await expectSubitemOrderUnchanged(page);
});
When("I group the Backlog by {string}", async ({ page }, grouping: string) => {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await chooseSelectOption(page, "Grouping", grouping);
  await page.keyboard.press("Escape");
});
When(
  "I drag the subitem to the {string} group",
  async ({ page }, label: string) => {
    const from = await page
      .locator('[data-work-item-id="child"] .backlog-item-title')
      .boundingBox();
    const target = await page
      .getByRole("region", { name: label, exact: true })
      .boundingBox();
    await page.mouse.move(from!.x + 20, from!.y + 8);
    await page.mouse.down();
    await page.mouse.move(target!.x + 40, target!.y + 80, { steps: 10 });
    await page.mouse.up();
  },
);
Then(
  "the subitem's {string} is {string}",
  async ({ page }, grouping: string, value: string) => {
    await expect
      .poll(() =>
        page.evaluate((grouping) => {
          const child = JSON.parse(
            localStorage.getItem("ajour.local-state.v2")!,
          ).workItems.find((item: { _id: string }) => item._id === "child");
          const field =
            grouping === "state"
              ? "workflowStateId"
              : grouping === "priority"
                ? "priority"
                : "projectId";
          return String(child[field] ?? "");
        }, grouping),
      )
      .toBe(value);
  },
);
When("I move the parent down with Alt and ArrowDown", async ({ page }) => {
  const parent = page.locator('[data-work-item-id="parent"]');
  await parent.focus();
  await parent.press("Alt+ArrowDown");
});
Then(
  "only the root items exchanged their custom order slots",
  async ({ page }) => {
    const order = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.map(
        (item: { _id: string }) => item._id,
      ),
    );
    expect(order.slice(0, 3)).toEqual(["other", "child", "parent"]);
  },
);
When(
  "I reorder the ungrouped parent below the other item",
  async ({ page }) => {
    await page.locator('[data-work-item-id="parent"]').scrollIntoViewIfNeeded();
    const from = await page
      .locator('[data-work-item-id="parent"] .backlog-item-title')
      .boundingBox();
    const to = await page.locator('[data-work-item-id="other"]').boundingBox();
    await page.mouse.move(from!.x + 20, from!.y + 8);
    await page.mouse.down();
    await page.mouse.move(to!.x + 40, to!.y + to!.height - 3, { steps: 10 });
    await page.mouse.up();
  },
);
Then(
  "the ungrouped parent has moved below the other item",
  async ({ page }) => {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const order = JSON.parse(
            localStorage.getItem("ajour.local-state.v2")!,
          ).workItems.map((item: { _id: string }) => item._id);
          return order.indexOf("parent") > order.indexOf("other");
        }),
      )
      .toBe(true);
  },
);
Then("the ungrouped parent's original order is restored", async ({ page }) => {
  const order = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.map(
      (item: { _id: string }) => item._id,
    ),
  );
  expect(order.slice(0, 3)).toEqual(["parent", "child", "other"]);
});
When("I drag the subitem to In progress", async ({ page }) => {
  const from = await page
    .locator('[data-work-item-id="child"] .backlog-item-title')
    .boundingBox();
  const to = await page
    .locator(
      '.backlog-board-column[aria-label="In progress"] .backlog-group-header',
    )
    .boundingBox();
  await page.mouse.move(from!.x + 20, from!.y + 8);
  await page.mouse.down();
  await page.mouse.move(to!.x + 40, to!.y + 18, { steps: 10 });
  await page.mouse.up();
});

Given(
  "the Backlog root card has a source that rejects moves",
  async ({ page }) => {
    const plugin = {
      id: "azure_devops",
      version: "1.0.0",
      apiVersion: 3,
      displayName: "Fixture source",
      description: "Acceptance fixture. All source requests are intercepted.",
      iconSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
      entrypoint: "dist/plugin.js",
      capabilities: { connector: { settle: true } },
      connectionFields: [
        { id: "url", label: "URL", type: "url", required: true, secret: false },
      ],
    };
    await page.route("http://127.0.0.1:8787/api/plugins", (route) =>
      route.fulfill({
        json: {
          pluginsEnabled: true,
          plugins: [plugin],
          connectionGroups: [{ plugin, enabled: true, connections: [] }],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    await page.route("**/connections/connection-1/settle-states", (route) =>
      route.fulfill({
        json: {
          states: [
            { name: "New", category: "Open", done: false },
            { name: "Active", category: "Open", done: false },
          ],
        },
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    await page.route("**/connections/connection-1/settle", (route) =>
      route.fulfill({
        status: 500,
        json: { error: "Fixture source write failure" },
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
      Object.assign(
        state.workItems.find((item: { _id: string }) => item._id === "child"),
        {
          title: "Synced root card",
          parentWorkItemId: undefined,
          parentSourceId: undefined,
          hierarchyLevel: 0,
          inheritsParentMapping: false,
          source: "azure_devops",
          sourceId: "source-child",
          sourceConnectionId: "connection-1",
          sourceStatusKey: "new",
          sourceStatusLabel: "New",
          importedWorkflowStateId: "todo",
        },
      );
      state.backlogSortMode = "custom";
      state.workflowStateMappings = [
        {
          source: "azure_devops",
          connectionId: "connection-1",
          sourceStatusKey: "new",
          sourceStatusLabel: "New",
          workflowStateId: "todo",
        },
        {
          source: "azure_devops",
          connectionId: "connection-1",
          sourceStatusKey: "active",
          sourceStatusLabel: "Active",
          workflowStateId: "doing",
        },
      ];
      sessionStorage.setItem(
        "source-drag-order",
        JSON.stringify(
          state.workItems.map((item: { _id: string }) => item._id),
        ),
      );
      localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
    });
    await page.reload();
    await page.evaluate(async () => {
      const { getPluginsOverview } = await import(
        /* @vite-ignore */ "/src/lib/app-api.ts"
      );
      await getPluginsOverview();
    });
  },
);
When(
  "I drag the source card below the other card in In progress",
  async ({ page }) => {
    const from = await page
      .locator('[data-work-item-id="child"] .backlog-item-title')
      .boundingBox();
    const to = await page.locator('[data-work-item-id="other"]').boundingBox();
    await page.mouse.move(from!.x + 20, from!.y + 8);
    await page.mouse.down();
    await page.mouse.move(to!.x + 40, to!.y + to!.height - 6, { steps: 10 });
    await page.mouse.up();
  },
);
Then("the source card has moved below the other card", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
        const order = state.workItems.map((item: { _id: string }) => item._id);
        const child = state.workItems.find(
          (item: { _id: string }) => item._id === "child",
        );
        return (
          child.workflowStateId === "doing" &&
          Boolean(child.pendingSourceWrite) &&
          order.indexOf("child") > order.indexOf("other")
        );
      }),
    )
    .toBe(true);
});
Then(
  "the failed source move restores the root card's workflow and custom order",
  async ({ page }) => {
    await expect(
      page.locator('h2[data-type="error"]').filter({
        hasText: 'Couldn\'t update "Synced root card" in its source',
      }),
    ).toBeVisible({ timeout: 15000 });
    const snapshot = await page.evaluate(() => ({
      state: JSON.parse(localStorage.getItem("ajour.local-state.v2")!),
      order: JSON.parse(sessionStorage.getItem("source-drag-order")!),
    }));
    expect(
      snapshot.state.workItems.map((item: { _id: string }) => item._id),
    ).toEqual(snapshot.order);
    expect(
      snapshot.state.workItems.find(
        (item: { _id: string }) => item._id === "child",
      ),
    ).toMatchObject({
      status: "active",
      workflowStateId: "todo",
      sourceStatusKey: "new",
    });
    expect(
      snapshot.state.workItems.find(
        (item: { _id: string }) => item._id === "child",
      ).parentWorkItemId,
    ).toBeUndefined();
    await expect(
      page
        .getByRole("region", { name: "To do", exact: true })
        .locator('[data-work-item-id="child"]'),
    ).toBeVisible();
  },
);

When("I touch-drag the subitem to In progress", async ({ page }) => {
  const source = page.locator(
    '[data-work-item-id="child"] .backlog-item-title',
  );
  const target = page.locator(
    '.backlog-board-column[aria-label="In progress"] .backlog-group-header',
  );
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 1,
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from!.x + 20, y: from!.y + 8 }],
    });
    for (let step = 1; step <= 10; step++) {
      const fraction = step / 10;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from!.x + 20 + (to!.x + 40 - from!.x - 20) * fraction,
            y: from!.y + 8 + (to!.y + 18 - from!.y - 8) * fraction,
          },
        ],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
});

Then("the Backlog items allow native touch scrolling", async ({ page }) => {
  const items = page.locator("[data-work-item-id]");
  await expect(items.first()).toBeVisible();
  expect(
    await items.evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).touchAction),
    ),
  ).toEqual(Array(await items.count()).fill("auto"));
});

When("I edit the subitem from its peek", async ({ page }) => {
  await page.locator('[data-work-item-id="child"] .backlog-item-title').click();
  await page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
});
When(
  "I rename the open editor draft to {string}",
  async ({ page }, title: string) => {
    await page
      .getByRole("complementary", { name: "Backlog item editor" })
      .getByRole("textbox", { name: /^(Item|Subitem)$/ })
      .fill(title);
  },
);
When("I save the open Backlog editor", async ({ page }) => {
  await page
    .getByRole("complementary", { name: "Backlog item editor" })
    .getByRole("button", { name: "Save", exact: true })
    .click();
});
Then("the Backlog editor is closed", async ({ page }) => {
  await expect(
    page.getByRole("complementary", { name: "Backlog item editor" }),
  ).toHaveCount(0);
});
Then("the saved subitem title is {string}", async ({ page }, title: string) => {
  await expect(
    page.locator('[data-work-item-id="child"] .backlog-item-title'),
  ).toHaveText(title);
});
When(
  "I press {string} on the other Backlog row",
  async ({ page }, key: string) => {
    await page.locator('[data-work-item-id="other"]').focus();
    await page.keyboard.press(key);
  },
);
Then(
  "the other item retains its draft in {string} with status {string}",
  async ({ page }, workflowStateId: string, status: string) => {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const item = JSON.parse(
            localStorage.getItem("ajour.local-state.v2")!,
          ).workItems.find((item: { _id: string }) => item._id === "other");
          return {
            title: item.title,
            workflowStateId: item.workflowStateId,
            status: item.status,
          };
        }),
      )
      .toEqual({ title: "Saved arrow draft", workflowStateId, status });
  },
);
Then("the subitem is in In progress", async ({ page }) => {
  await expect(
    page.locator(
      '.backlog-board-column[aria-label="In progress"] [data-work-item-id="child"]',
    ),
  ).toBeVisible();
});
When("I undo the last Backlog move", async ({ page }) => {
  await page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
});
Then("the subitem is back in To do", async ({ page }) => {
  await expect(
    page.locator(
      '.backlog-board-column[aria-label="To do"] [data-work-item-id="child"]',
    ),
  ).toBeVisible();
});
When("I move the parent to Done and include its subitems", async ({ page }) => {
  // Cards mount their real pickers on hover, so hover before the click.
  const card = page.locator('[data-work-item-id="parent"]');
  await card.hover();
  await card
    .locator("[data-state-picker]")
    .and(page.getByRole("button", { name: "Change state of Backlog parent" }))
    .click();
  await page.getByRole("menuitem", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Include subitem", exact: true })
    .click();
});
Then("the parent and its subitem are archived in Done", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("ajour.local-state.v2")!)
          .workItems.filter((i: { _id: string }) =>
            ["parent", "child"].includes(i._id),
          )
          .map((i: { status: string }) => i.status),
      ),
    )
    .toEqual(["archived", "archived"]);
});
Then("the parent and its subitem are active again", async ({ page }) => {
  await expect(
    page.locator(
      '.backlog-board-column[aria-label="To do"] [data-work-item-id]',
    ),
  ).toHaveCount(2);
});
When("I add a Backlog item in In progress", async ({ page }) => {
  await page.getByRole("button", { name: "New item in In progress" }).click();
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await editor
    .getByRole("textbox", { name: "Item", exact: true })
    .fill("New grouped item");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
});
Then("the new Backlog item is in In progress", async ({ page }) => {
  await expect(
    page.locator('.backlog-board-column[aria-label="In progress"]'),
  ).toContainText("New grouped item");
});
When("I add a Backlog item from the end of the list", async ({ page }) => {
  await expect(page.getByRole("button", { name: /^New item in / })).toHaveCount(
    0,
  );
  await page
    .locator(".backlog-workspace-scroll")
    .getByRole("button", { name: "New backlog item", exact: true })
    .click();
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await editor
    .getByRole("textbox", { name: "Item", exact: true })
    .fill("New ungrouped item");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
});
Then("the new Backlog item is in the list", async ({ page }) => {
  await expect(
    page.getByRole("region", { name: "All items", exact: true }),
  ).toContainText("New ungrouped item");
});
When("I enable project swimlanes", async ({ page }) => {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await chooseSelectOption(page, "Swimlanes", "project");
  await page.keyboard.press("Escape");
});
Then(
  "the Backlog has a collapsible Example project swimlane",
  async ({ page }) => {
    const button = page.getByRole("button", {
      name: "Example project 3",
      exact: true,
    });
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await button.click();
    await expect(page.locator('[data-work-item-id="parent"]')).toHaveCount(0);
    await button.click();
    await expect(page.locator('[data-work-item-id="parent"]')).toBeVisible();
  },
);
Then(
  "the Backlog shows the old done and missing sync items",
  async ({ page }) => {
    await expect(page.locator('[data-work-item-id="old"]')).toBeVisible();
    await expect(page.locator('[data-work-item-id="missing"]')).toBeVisible();
  },
);
When("I restore the old done item", async ({ page }) => {
  const oldRow = page.locator('[data-work-item-id="old"]');
  await oldRow.hover();
  await oldRow
    .getByRole("button", { name: "Actions for Old done item" })
    .click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
});
Then("the old done item is active in To do", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("ajour.local-state.v2")!,
          ).workItems.find((i: { _id: string }) => i._id === "old").status,
      ),
    )
    .toBe("active");
  await page.getByRole("button", { name: "Remove State filter" }).click();
  await expect(
    page
      .getByRole("region", { name: "To do", exact: true })
      .locator('[data-work-item-id="old"]'),
  ).toBeVisible();
});
When("I hide the Backlog priority property", async ({ page }) => {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByRole("checkbox", { name: "Priority", exact: true }).click();
  await page.keyboard.press("Escape");
});
When("I set the parent priority to Low with its key", async ({ page }) => {
  await page.locator('[data-work-item-id="parent"]').focus();
  await page.keyboard.press("p");
  await page.getByRole("menuitem", { name: "Low", exact: true }).click();
});
Then("the parent priority is Low", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("ajour.local-state.v2")!,
          ).workItems.find((i: { _id: string }) => i._id === "parent").priority,
      ),
    )
    .toBe(4);
});

Given(
  "the other Backlog item uses {string}",
  async ({ page }, source: string) => {
    await page.evaluate((source) => {
      const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
      state.workItems.find(
        (item: { _id: string }) => item._id === "other",
      ).source = source;
      localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
    }, source);
    await page.reload();
  },
);
When("I edit the other item from the Backlog peek", async ({ page }) => {
  await page.locator('[data-work-item-id="other"] .backlog-item-title').click();
  await page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
});
Given("the Backlog has an unmapped source state", async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    Object.assign(
      state.workItems.find((item: { _id: string }) => item._id === "other"),
      {
        source: "azure_devops",
        sourceId: "unmapped-item",
        sourceConnectionId: "unmapped-connection",
        sourceStatusKey: "review",
        sourceStatusLabel: "Review",
      },
    );
    localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
  });
  await page.reload();
  await expect(
    page.getByRole("link", { name: "1 unmapped source state", exact: true }),
  ).toBeVisible();
});
When(
  "I follow the unmapped-state settings link with {string}",
  async ({ page }, activation: string) => {
    const link = page.getByRole("link", {
      name: "1 unmapped source state",
      exact: true,
    });
    if (activation === "Enter") {
      await link.focus();
      await link.press("Enter");
    } else await link.click();
  },
);
Then(
  "workflow settings opens with the other item's draft saved",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/settings\/workflow$/);
    const title = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("ajour.local-state.v2")!,
        ).workItems.find((item: { _id: string }) => item._id === "other").title,
    );
    expect(title).toBe("Saved settings draft");
  },
);
When(
  "I open the unmapped-state settings link with {string} held",
  async ({ page }, modifier: "Control" | "Shift") => {
    const link = page.getByRole("link", {
      name: "1 unmapped source state",
      exact: true,
    });
    const [settings] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 5000 }),
      // macOS turns Ctrl-click into a right-click, so press Cmd there.
      link.click({
        modifiers: [modifier === "Control" ? "ControlOrMeta" : modifier],
      }),
    ]);
    await expect(settings).toHaveURL(/\/settings\/workflow$/);
    await settings.close();
  },
);
Then(
  "Backlog keeps its unsaved draft in the original page",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/backlog$/);
    const editor = page.getByRole("complementary", {
      name: "Backlog item editor",
    });
    await expect(
      editor.getByRole("textbox", { name: "Item", exact: true }),
    ).toHaveValue("Separate settings draft");
    const title = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("ajour.local-state.v2")!,
        ).workItems.find((item: { _id: string }) => item._id === "other").title,
    );
    expect(title).toBe("Other backlog item");
  },
);
Then(
  "Backlog keeps the invalid draft and its validation error",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/backlog$/);
    const editor = page.getByRole("complementary", {
      name: "Backlog item editor",
    });
    await expect(
      editor.getByRole("textbox", { name: "Item", exact: true }),
    ).toHaveValue("");
    await expect(
      editor.getByText("Enter an item name", { exact: true }),
    ).toBeVisible();
    const title = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem("ajour.local-state.v2")!,
        ).workItems.find((item: { _id: string }) => item._id === "other").title,
    );
    expect(title).toBe("Other backlog item");
  },
);
Then("Backlog keeps the pending settings draft", async ({ page }) => {
  await expect(page).toHaveURL(/\/backlog$/);
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await expect(
    editor.getByRole("textbox", { name: "Item", exact: true }),
  ).toHaveValue("Pending settings draft");
  const title = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "parent",
      ).title,
  );
  expect(title).toBe("Backlog parent");
});
When(
  "I choose {string} in the Backlog editor actions",
  async ({ page }, action: string) => {
    await page
      .getByRole("complementary", { name: "Backlog item editor" })
      .getByRole("button", { name: /Actions/ })
      .click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
  },
);
Then(
  "the Backlog editor is closed and the other item is archived",
  async ({ page }) => {
    await expect(
      page.getByRole("complementary", { name: "Backlog item editor" }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("ajour.local-state.v2")!,
            ).workItems.find((item: { _id: string }) => item._id === "other")
              .status,
        ),
      )
      .toBe("archived");
    await expect(
      page
        .getByRole("complementary", { name: "Backlog item peek" })
        .getByRole("button", { name: "Edit", exact: true }),
    ).toBeDisabled();
  },
);
When("I save the other item in To do", async ({ page }) => {
  const editor = page.getByRole("complementary", {
    name: "Backlog item editor",
  });
  await editor
    .getByRole("combobox", { name: "Workflow state", exact: true })
    .click();
  await page.getByRole("option", { name: "To do", exact: true }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
});

When(
  "I change the editor workflow draft to {string}",
  async ({ page }, name: string) => {
    await page
      .getByRole("complementary", { name: "Backlog item editor" })
      .getByRole("combobox", { name: "Workflow state", exact: true })
      .click();
    await page.getByRole("option", { name, exact: true }).click();
  },
);
When("I edit the parent item from the Backlog peek", async ({ page }) => {
  await page
    .locator('[data-work-item-id="parent"] .backlog-item-title')
    .click();
  await page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
});
When("I cancel the subitem close prompt", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Include subitem", exact: true }),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
});
Then(
  "the parent remains active and its editor stays open",
  async ({ page }) => {
    await expect(
      page.getByRole("complementary", { name: "Backlog item editor" }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", {
        name: "Also close its 1 open subitem?",
        exact: true,
      }),
    ).toHaveCount(0);
    const item = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "parent",
      ),
    );
    expect(item).toMatchObject({ status: "active", workflowStateId: "todo" });
  },
);
Given("an earlier project has asymmetric board columns", async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    state.projects.unshift({
      ...state.projects[0],
      _id: "q",
      name: "Earlier project",
      displayName: "Earlier project",
    });
    const base = state.workItems.find(
      (item: { _id: string }) => item._id === "other",
    );
    state.workItems.push(
      ...["todo", "doing", "doing", "doing"].map((workflowStateId, index) => ({
        ...base,
        _id: `earlier-${index}`,
        title: `Earlier item ${index}`,
        projectId: "q",
        workflowStateId,
      })),
    );
    localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
  });
  await page.reload();
});
When("I move focus right from the parent card", async ({ page }) => {
  await page.locator('[data-work-item-id="parent"]').focus();
  await page.keyboard.press("ArrowRight");
});
When("I press {word} on the other card", async ({ page }, key: string) => {
  await page.locator('[data-work-item-id="other"]').press(key);
});
Then("the other card has focus", async ({ page }) => {
  await expect(page.locator('[data-work-item-id="other"]')).toBeFocused();
});
Then("the parent card has focus", async ({ page }) => {
  await expect(page.locator('[data-work-item-id="parent"]')).toBeFocused();
});
Then("the other item is in To do and Undo is offered", async ({ page }) => {
  await expect(
    page
      .getByRole("region", { name: "To do", exact: true })
      .locator('[data-work-item-id="other"]'),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
});
Then("the other item is back in In progress", async ({ page }) => {
  await expect(
    page
      .getByRole("region", { name: "In progress", exact: true })
      .locator('[data-work-item-id="other"]'),
  ).toBeVisible();
});

/** The saved local state, read from the browser. */
function readBacklogState(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!),
  );
}
When("I open the Backlog parent page", async ({ page }) => {
  await page.goto("/backlog/parent");
  await expect(
    page.getByRole("heading", { name: "Backlog parent", level: 1 }),
  ).toBeVisible();
});
When(
  "I rename the item on its page to {string}",
  async ({ page }, title: string) => {
    await page
      .getByRole("heading", { name: "Backlog parent", level: 1 })
      .click();
    const input = page.getByRole("textbox", { name: "Title", exact: true });
    await input.fill(title);
    await input.press("Enter");
    await expect(
      page.getByRole("heading", { name: title, level: 1 }),
    ).toBeVisible();
  },
);
When(
  "I set its remaining estimate on its page to {string}",
  async ({ page }, hours: string) => {
    await page
      .getByRole("button", { name: /^Edit remaining estimate/ })
      .click();
    const input = page.getByRole("textbox", {
      name: "Remaining estimate in hours",
    });
    await input.fill(hours);
    await input.press("Enter");
  },
);
When(
  "I write {string} as its description on its page",
  async ({ page }, note: string) => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const textarea = page.getByRole("textbox", {
      name: "Description",
      exact: true,
    });
    await textarea.fill(note);
    // Leaving the field saves it; the rendered markdown comes back.
    await textarea.blur();
    await expect(page.locator("strong", { hasText: "Bold" })).toBeVisible();
  },
);
When(
  "I add the subitem {string} on its page",
  async ({ page }, title: string) => {
    await page
      .getByRole("button", { name: "Add subitem", exact: true })
      .click();
    const input = page.getByRole("textbox", { name: "New subitem name" });
    await input.fill(title);
    await input.press("Enter");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  },
);
Then("the Backlog parent keeps the inline edits", async ({ page }) => {
  await expect
    .poll(async () => {
      const { workItems } = await readBacklogState(page);
      const parent = workItems.find(
        (item: { _id: string }) => item._id === "parent",
      );
      const added = workItems.find(
        (item: { title: string }) => item.title === "Inline subitem",
      );
      return {
        title: parent.title,
        description: parent.description,
        remainingEstimateHours: parent.remainingEstimateHours,
        added: added && {
          parentWorkItemId: added.parentWorkItemId,
          projectId: added.projectId,
          taskId: added.taskId,
        },
      };
    })
    .toEqual({
      title: "Renamed parent",
      description: "**Bold** description",
      remainingEstimateHours: 5,
      added: { parentWorkItemId: "parent", projectId: "p", taskId: "t" },
    });
});
Then(
  "the item page has no actions menu and no editor panel",
  async ({ page }) => {
    // Sidebar rows keep their own "…"; only the page's is gone.
    await expect(
      page
        .locator(".ajour-page-header-slot, .backlog-item-page")
        .getByRole("button", { name: /^Actions for / }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "Backlog item editor" }),
    ).toHaveCount(0);
  },
);
When(
  "I write {string} as its description and press Mod+Enter",
  async ({ page }, description: string) => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill(description);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(
      page.getByRole("textbox", { name: "Description", exact: true }),
    ).toHaveCount(0);
  },
);
Then(
  "the Backlog parent's description is {string}",
  async ({ page }, description: string) => {
    await expect
      .poll(async () => {
        const { workItems } = await readBacklogState(page);
        return workItems.find((item: { _id: string }) => item._id === "parent")
          ?.description;
      })
      .toBe(description);
  },
);
Then(
  "the item page shows one description, for {string}",
  async ({ page }, title: string) => {
    await expect(
      page.getByRole("heading", { name: title, level: 1 }),
    ).toBeVisible();
    // A page left behind by an earlier item would add its own Description.
    await expect(
      page.getByRole("heading", { name: "Description", level: 2 }),
    ).toHaveCount(1);
  },
);
Then(
  "its description shows {string}",
  async ({ page }, description: string) => {
    await expect(page.getByText(description, { exact: true })).toBeVisible();
  },
);
When(
  "I type in the title, the remaining estimate and the description and press Escape each time",
  async ({ page }) => {
    await page
      .getByRole("heading", { name: "Backlog parent", level: 1 })
      .click();
    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Cancelled title");
    await page.keyboard.press("Escape");

    await page
      .getByRole("button", { name: /^Edit remaining estimate/ })
      .click();
    await page
      .getByRole("textbox", { name: "Remaining estimate in hours" })
      .fill("9");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Cancelled description");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Backlog parent", level: 1 }),
    ).toBeVisible();
  },
);
Then(
  "the Backlog parent keeps its saved title, estimate and description",
  async ({ page }) => {
    const { workItems } = await readBacklogState(page);
    const parent = workItems.find(
      (item: { _id: string }) => item._id === "parent",
    );
    expect(parent).toMatchObject({
      title: "Backlog parent",
      remainingEstimateHours: 3,
    });
    expect(parent.description).toBeUndefined();
  },
);
Given("the Backlog parent is synced", async ({ page }) => {
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
    const parent = state.workItems.find(
      (item: { _id: string }) => item._id === "parent",
    );
    Object.assign(parent, {
      source: "example",
      sourceId: "source-parent",
      sourceConnectionId: "fixture",
      sourceStatusLabel: "Active",
    });
    localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
  });
});
When("I archive it from its properties card", async ({ page }) => {
  await page
    .locator(".backlog-item-properties-card")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
});
Then(
  "the Backlog parent is archived and its page offers Restore",
  async ({ page }) => {
    await expect(
      page
        .locator(".ajour-page-header-slot")
        .getByRole("button", { name: "Restore", exact: true }),
    ).toBeVisible();
    const { workItems } = await readBacklogState(page);
    expect(
      workItems.find((item: { _id: string }) => item._id === "parent").status,
    ).toBe("archived");
  },
);

/** A folding card on the item page and the title button that folds it. */
function sideCard(page: Page, name: "Subitems" | "Time entries") {
  const card = page.getByRole("region", { name, exact: true });
  return {
    card,
    toggle: card.getByRole("button", { name: new RegExp(`^${name}`) }),
  };
}
Then(
  "the Subitems and Time entries cards are closed on their summary",
  async ({ page }) => {
    const subitems = sideCard(page, "Subitems");
    await expect(subitems.toggle).toHaveAttribute("aria-expanded", "false");
    await expect(subitems.toggle).toContainText("0 of 1 done");
    await expect(
      subitems.card.getByRole("link", { name: "Backlog subitem" }),
    ).toHaveCount(0);
    const timeEntries = sideCard(page, "Time entries");
    await expect(timeEntries.toggle).toHaveAttribute("aria-expanded", "false");
    await expect(timeEntries.card).toContainText("No time logged yet.");
  },
);
When("I press Escape in the subitem name field", async ({ page }) => {
  await page.getByRole("textbox", { name: "New subitem name" }).press("Escape");
});
Then(
  "the Subitems card is closed on {string} and the page has the focus",
  async ({ page }, progress: string) => {
    const subitems = sideCard(page, "Subitems");
    await expect(subitems.toggle).toHaveAttribute("aria-expanded", "false");
    await expect(subitems.toggle).toContainText(progress);
    await expect(page.locator(".backlog-item-page")).toBeFocused();
    // Adding opened the card for the name field only; nothing was saved.
    expect(
      await page.evaluate(() =>
        localStorage.getItem("ajour.backlog-item-cards"),
      ),
    ).toBeNull();
  },
);
When("I press Add subitem and then the Subitems title", async ({ page }) => {
  await page.getByRole("button", { name: "Add subitem", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "New subitem name" }),
  ).toBeFocused();
  // The press blurs the empty name field, which closes it first.
  await sideCard(page, "Subitems").toggle.click();
});
Then(
  "the Subitems card stays closed, even after a reload",
  async ({ page }) => {
    const { toggle } = sideCard(page, "Subitems");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(sideCard(page, "Subitems").toggle).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  },
);
When("I open the Subitems card", async ({ page }) => {
  await sideCard(page, "Subitems").toggle.click();
});
When("I reload the item page", async ({ page }) => {
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
Then(
  "the Subitems card is still open and Time entries is still closed",
  async ({ page }) => {
    const subitems = sideCard(page, "Subitems");
    await expect(subitems.toggle).toHaveAttribute("aria-expanded", "true");
    await expect(
      subitems.card.getByRole("link", { name: "Folded subitem" }),
    ).toBeVisible();
    await expect(sideCard(page, "Time entries").toggle).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  },
);
When("I set When missing to Keep on its properties card", async ({ page }) => {
  await page
    .locator(".backlog-item-properties-card")
    .getByRole("button", { name: "When missing from sync: Archive" })
    .click();
  await page.getByRole("menuitemradio", { name: "Keep" }).click();
});
/** The parent's saved choice, false when it was never set. */
async function readKeepWhenMissing(page: Page) {
  const { workItems } = await readBacklogState(page);
  return (
    workItems.find((item: { _id: string }) => item._id === "parent")
      .keepWhenMissingFromSync ?? false
  );
}
Then("the Backlog parent is kept when missing from sync", async ({ page }) => {
  await expect.poll(() => readKeepWhenMissing(page)).toBe(true);
  await expect(
    page.getByRole("button", { name: "When missing from sync: Keep" }),
  ).toBeVisible();
});
When("I undo the When missing change", async ({ page }) => {
  await page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
});
Then(
  "the Backlog parent is archived when missing from sync",
  async ({ page }) => {
    await expect.poll(() => readKeepWhenMissing(page)).toBe(false);
    await expect(
      page.getByRole("button", { name: "When missing from sync: Archive" }),
    ).toBeVisible();
  },
);
