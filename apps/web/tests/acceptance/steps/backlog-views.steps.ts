import { expect, type Locator, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
const { Given, When, Then } = createBdd();
Given("I have a backlog view fixture", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/api/connectors", (route) =>
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
        priorityFormat: "levels",
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
When("I filter the Backlog to Urgent", async ({ page }) => {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter property").selectOption("priority");
  await page.getByRole("combobox", { name: "Filter value" }).click();
  await page.getByRole("option", { name: "Urgent", exact: true }).click();
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
When("I remove the Urgent filter", async ({ page }) => {
  await page
    .getByRole("button", { name: "Remove filter Priority: Urgent" })
    .click();
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
When("I start an entry from the Backlog peek", async ({ page }) => {
  const start = page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Start entry", exact: true });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(start).toBeDisabled();
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
  const start = peek.getByRole("button", { name: "Start entry", exact: true });
  await expect(start).toBeDisabled();
  await expect(start).toHaveAccessibleDescription("Already running");
  await peek.getByRole("button", { name: "Open page", exact: true }).hover();
  await start.hover();
  await expect(
    page.locator('[data-slot="tooltip-content"][data-open]'),
  ).toHaveText("Start entry. Already running");
  await start.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(start).toBeFocused();
  await expect(
    page.locator('[data-slot="tooltip-content"][data-open]'),
  ).toHaveText("Start entry. Already running");
  await start.click({ force: true });
  await start.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await peek
    .getByRole("button", { name: "Actions for Backlog parent", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: /^Start entry/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: /^Start entry/ }),
  ).toContainText("Already running");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page
    .locator('[data-work-item-id="parent"]')
    .getByRole("button", { name: "Actions for Backlog parent", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: /^Start entry/ }),
  ).toBeDisabled();
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
  await page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", {
      name: "Actions for Other backlog item",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Start entry", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});
When("I stop the Backlog running entry from the titlebar", async ({ page }) => {
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
});
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
  await page
    .getByRole("complementary", { name: "Backlog item peek" })
    .getByRole("button", { name: "Actions for Backlog parent", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Start entry", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await start.click();
  await expect(start).toBeDisabled();
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
When("I use the compact Backlog sidebar", async ({ page }) => {
  await page.evaluate(async () => {
    const { updateSidebarLayout } = await import(
      /* @vite-ignore */ "/src/lib/sidebar-layout.ts"
    );
    updateSidebarLayout({ density: "compact" });
  });
});
Then(
  "the sidebar Start icon explains that the parent is already running",
  async ({ page }) => {
    const row = page
      .getByRole("navigation", { name: "Primary navigation" })
      .locator('[data-backlog-item-id="parent"]');
    await row.hover();
    const start = row.getByRole("button", { name: "Start entry", exact: true });
    await expect(start).toBeDisabled();
    await expect(start).toHaveAccessibleDescription("Already running");
    await start.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(start).toBeFocused();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toContainText("Already running");
    await start.hover();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toContainText("Start entry. Already running");
    await start.click({ force: true });
    await start.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await page.getByRole("main").hover();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toHaveCount(0);
  },
);
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
    ).toHaveText("Start entry");
  },
);
When("I use the Backlog {string} layout", async ({ page }, layout: string) => {
  await page
    .getByRole("button", { name: `${layout} layout`, exact: true })
    .click();
});
Then(
  "the parent Start icon explains that it is already running",
  async ({ page }) => {
    const row = page.locator('[data-work-item-id="parent"]');
    await row.hover();
    const start = row.getByRole("button", {
      name: "Start Backlog parent",
      exact: true,
    });
    await expect(start).toBeDisabled();
    await expect(start).toHaveAccessibleDescription("Already running");
    await start.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(start).toBeFocused();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toContainText("Already running");
    await start.hover();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toHaveText("Start Backlog parent. Already running");
    await start.click({ force: true });
    await start.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(start).toBeFocused();
    await page.keyboard.press("Escape");
    const other = page.locator('[data-work-item-id="other"]');
    await other.hover();
    await expect(
      other.getByRole("button", {
        name: "Switch to Other backlog item",
        exact: true,
      }),
    ).toBeEnabled();
    await page.getByRole("main").hover();
    await expect(
      page.locator('[data-slot="tooltip-content"][data-open]'),
    ).toHaveCount(0);
  },
);
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
    action = palette.getByRole("option", { name: /^Start entry/ });
  } else {
    if (control === "item page") {
      if (!new URL(page.url()).pathname.endsWith("/backlog/parent")) {
        await page
          .getByRole("complementary", { name: "Backlog item peek" })
          .getByRole("button", { name: "Open page", exact: true })
          .click();
      }
      const start = page
        .getByRole("main")
        .getByRole("button", { name: "Start entry", exact: true });
      if (running) await expect(start).toBeDisabled();
      else await expect(start).toBeEnabled();
      await page
        .getByRole("main")
        .getByRole("button", {
          name: "Actions for Backlog parent",
          exact: true,
        })
        .click();
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
      const start = row.getByRole("button", { name: "Start", exact: true });
      if (running) await expect(start).toBeDisabled();
      else await expect(start).toBeEnabled();
      await row.click({ button: "right" });
    } else {
      throw new Error(`Unknown Backlog control: ${control}`);
    }
    action = page.getByRole("menuitem", { name: /^Start entry/ });
  }
  if (running) {
    await expect(action).toBeDisabled();
    await expect(action).toContainText("Already running");
  } else {
    await expect(action).toBeEnabled();
  }
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
  "Start entry is disabled for the running item in the {string}",
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
    await page
      .getByLabel("Grouping", { exact: true })
      .selectOption(presentation === "groups" ? "project" : "state");
    if (presentation === "swimlanes")
      await page
        .getByLabel("Swimlanes", { exact: true })
        .selectOption("project");
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
  await page.getByLabel("Grouping", { exact: true }).selectOption("none");
  await page.getByLabel("Ordering", { exact: true }).selectOption("title");
  await page.keyboard.press("Escape");
});
When("I order the Backlog by {string}", async ({ page }, order: string) => {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page
    .getByLabel("Ordering", { exact: true })
    .selectOption({ label: order });
  await page.keyboard.press("Escape");
});
When("I swipe upward from a sorted Backlog row", async ({ page }) => {
  await swipeBacklogItem(page, "parent");
});
Then("the list scrolls without starting a drag", async ({ page }) => {
  await expectNativeBacklogScroll(page);
});
Then("the ungrouped custom list remains draggable", async ({ page }) => {
  const items = page.locator("[data-work-item-id]");
  expect(
    await items.evaluateAll((items) =>
      items.map((item) => getComputedStyle(item).touchAction),
    ),
  ).toEqual(Array(await items.count()).fill("none"));
});
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
  "the Backlog subitem has a source that rejects moves",
  async ({ page }) => {
    const plugin = {
      id: "azure_devops",
      version: "1.0.0",
      apiVersion: 2,
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
    await page.route("http://127.0.0.1:8787/api/connectors", (route) =>
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
      const { getConnectorsOverview } = await import(
        /* @vite-ignore */ "/src/lib/app-api.ts"
      );
      await getConnectorsOverview();
    });
  },
);
When(
  "I drag the subitem below the other card in In progress",
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
Then("the subitem has moved below the other card", async ({ page }) => {
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
  "the failed source move restores the subitem's workflow and custom order",
  async ({ page }) => {
    await expect(
      page.locator('h2[data-type="error"]').filter({
        hasText: 'Couldn\'t update "Backlog subitem" in its source',
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
  await page
    .locator('[data-work-item-id="parent"]')
    .getByRole("button", { name: "Change state of Backlog parent" })
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
When("I enable project swimlanes", async ({ page }) => {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByLabel("Swimlanes", { exact: true }).selectOption("project");
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
When("I open the Backlog Archive", async ({ page }) => {
  await page
    .getByRole("button", { name: "Backlog options", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
});
Then(
  "Archive contains the old done and missing sync items",
  async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Archive", exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-work-item-id="old"]')).toBeVisible();
    await expect(page.locator('[data-work-item-id="missing"]')).toBeVisible();
  },
);
When("I restore the old done item", async ({ page }) => {
  await page
    .locator('[data-work-item-id="old"]')
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
  await page.getByRole("button", { name: "Back to backlog" }).click();
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
