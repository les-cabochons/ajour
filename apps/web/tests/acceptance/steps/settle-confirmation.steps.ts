import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

/** The priority levels' names, as the Settle dialog's select shows them. */
const PRIORITY_NAMES: Record<string, string> = {
  "1": "Urgent",
  "2": "High",
  "3": "Medium",
  "4": "Low",
};

Given("I have a writable synced parent Settle fixture", async ({ page }) => {
  const plugin = {
    id: "example",
    version: "1.0.0",
    apiVersion: 3,
    displayName: "Fixture source",
    iconSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
    entrypoint: "dist/plugin.js",
    capabilities: { connector: { settle: true } },
    connectionFields: [
      { id: "url", label: "URL", type: "url", required: true, secret: false },
    ],
  };
  const headers = { "access-control-allow-origin": "*" };
  await page.route("**/api/connectors", (route) =>
    route.fulfill({
      headers,
      json: {
        pluginsEnabled: true,
        plugins: [plugin],
        connectionGroups: [{ plugin, enabled: true, connections: [] }],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
    }),
  );
  await page.route("**/connections/fixture/settle-states", (route) =>
    route.fulfill({
      headers,
      json: {
        states: [
          { name: "Active", category: "Open", done: false },
          { name: "Closed", category: "Open", done: false },
          { name: "Waiting", category: "Done", done: true },
        ],
      },
    }),
  );
  await page.route("**/connections/fixture/settle", (route) => {
    const request = route.request().postDataJSON();
    return route.fulfill({
      headers,
      json: { state: request.state, priority: request.priority },
    });
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("settle-confirmation-fixture")) return;
    localStorage.clear();
    sessionStorage.setItem("settle-confirmation-fixture", "true");
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        workflowStates: [
          { _id: "doing", name: "Doing", color: "#000000", createdAt: 1 },
          {
            _id: "done",
            name: "Done",
            color: "#000000",
            done: true,
            createdAt: 1,
          },
        ],
        workflowStateMappings: [
          {
            source: "example",
            connectionId: "fixture",
            sourceStatusKey: "active",
            workflowStateId: "doing",
          },
          {
            source: "example",
            connectionId: "fixture",
            sourceStatusKey: "closed",
            workflowStateId: "done",
          },
          {
            source: "example",
            connectionId: "fixture",
            sourceStatusKey: "waiting",
            workflowStateId: "doing",
          },
        ],
        workItems: [
          {
            _id: "settle-parent",
            title: "Settle parent",
            source: "example",
            sourceId: "source-parent",
            sourceConnectionId: "fixture",
            sourceStatusKey: "active",
            sourceStatusLabel: "Active",
            workflowStateId: "doing",
            importedWorkflowStateId: "doing",
            status: "active",
            priority: 2,
            importedPriority: 2,
            createdAt: 1,
          },
          {
            _id: "settle-child",
            title: "Settle child",
            source: "manual",
            parentWorkItemId: "settle-parent",
            workflowStateId: "doing",
            status: "active",
            createdAt: 1,
          },
        ],
      }),
    );
  });
  await page.goto("/backlog/settle-parent");
  await page.evaluate(async () => {
    const { getConnectorsOverview } = await import(
      /* @vite-ignore */ "/src/lib/app-api.ts"
    );
    await getConnectorsOverview();
  });
});
/** The item page's "…" sits in the top bar, beside its breadcrumb. */
async function openSettleParentActions(page: Page) {
  await page
    .locator(".ajour-page-header-slot")
    .getByRole("button", { name: "Actions for Settle parent", exact: true })
    .click();
}
When("I open the parent Settle dialog", async ({ page }) => {
  await openSettleParentActions(page);
  await page.getByRole("menuitem", { name: /^Settle/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Settle", exact: true }),
  ).toBeVisible();
});
async function refreshSettleParent(
  page: Page,
  state: string,
  priority: "urgent" | "high",
) {
  await page.evaluate(
    async ({ state, priority }) => {
      const { localStore } = await import(
        /* @vite-ignore */ "/src/lib/local-store.ts"
      );
      localStore.importConnectorWorkItems([
        {
          id: "refreshed-parent",
          source: "example",
          connectionId: "fixture",
          connectionLabel: "Fixture connection",
          tenantLabel: "Fixture tenant",
          sourceId: "source-parent",
          externalId: "source-parent",
          title: "Settle parent",
          workItemType: "Task",
          state,
          priority,
          depth: "root",
          selectable: true,
          selected: true,
          childCount: 0,
          pushedAt: Date.now(),
        },
      ]);
    },
    { state, priority },
  );
}
When(
  "the source changes the parent's priority to Urgent during Settle",
  async ({ page }) => refreshSettleParent(page, "Active", "urgent"),
);
When("I reopen Settle on an unlisted source state", async ({ page }) => {
  await page
    .getByRole("dialog", { name: "Settle", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await refreshSettleParent(page, "Unlisted", "high");
  await openSettleParentActions(page);
  await page.getByRole("menuitem", { name: /^Settle/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Settle", exact: true })
      .getByLabel("State", { exact: true }),
  ).toBeEnabled();
});
When(
  "the source changes the parent's state to Active during Settle",
  async ({ page }) => {
    await refreshSettleParent(page, "Active", "high");
  },
);
Then("the Settle state draft remains Unlisted", async ({ page }) => {
  const select = page
    .getByRole("dialog", { name: "Settle", exact: true })
    .getByLabel("State", { exact: true });
  await expect(select).toHaveText("Unlisted");
});
Then(
  "Settle requires an available state before submitting",
  async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
    await expect(
      dialog.getByRole("button", { name: "Settle", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByText(
        "This source state is no longer available. Choose another state.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "This connector cannot clear its source priority. Choose a priority.",
        { exact: true },
      ),
    ).toHaveCount(0);
  },
);
Then(
  "Settle submits the unchanged unlisted state locally",
  async ({ page }) => {
    await expect(
      page.getByRole("dialog", { name: "Settle", exact: true }),
    ).toHaveCount(0);
    const parent = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "settle-parent",
      ),
    );
    expect(parent).toMatchObject({
      status: "settled",
      sourceStatusLabel: "Unlisted",
    });
    expect(parent.pendingSourceWrite).toBeUndefined();
  },
);
Then("Settle submits the selected Waiting state", async ({ page }) => {
  await expect(
    page.getByRole("dialog", { name: "Settle", exact: true }),
  ).toHaveCount(0);
  const parent = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
      (item: { _id: string }) => item._id === "settle-parent",
    ),
  );
  expect(parent).toMatchObject({
    sourceStatusLabel: "Waiting",
    status: "settled",
    pendingSourceWrite: { state: "Waiting" },
  });
});
Then("the Settle priority draft remains High", async ({ page }) => {
  await expect(
    page
      .getByRole("dialog", { name: "Settle", exact: true })
      .getByLabel("Priority", { exact: true }),
  ).toHaveText("High");
  const parent = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
      (item: { _id: string }) => item._id === "settle-parent",
    ),
  );
  expect(parent.importedPriority).toBe(1);
});
Then(
  "Settle writes High against the refreshed Urgent priority",
  async ({ page }) => {
    await expect(
      page.getByRole("dialog", { name: "Settle", exact: true }),
    ).toHaveCount(0);
    const parent = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "settle-parent",
      ),
    );
    expect(parent.priority).toBe(2);
    expect(parent.pendingSourceWrite).toMatchObject({
      priority: 2,
      previous: { importedPriority: 1 },
    });
  },
);
When(
  "I choose source state {string} and priority {string} in Settle",
  async ({ page }, state: string, priority: string) => {
    const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
    await dialog.getByLabel("State", { exact: true }).click();
    await page.getByRole("option", { name: state, exact: true }).click();
    const input = dialog.getByLabel("Priority", { exact: true });
    if ((await input.getAttribute("role")) === "combobox") {
      await input.click();
      await page
        .getByRole("option", { name: PRIORITY_NAMES[priority] ?? priority })
        .click();
    } else await input.fill(priority);
  },
);
Then(
  "Settle warns that the mapped state archives the item",
  async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
    await expect(
      dialog.getByText("This state is done, so the item will be archived.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Archive", exact: true }),
    ).toBeEnabled();
  },
);
Then("Settle does not warn of archiving", async ({ page }) => {
  const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
  await expect(
    dialog.getByText("This state is done, so the item will be archived.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Settle", exact: true }),
  ).toBeEnabled();
});
When("I submit the parent Settle draft", async ({ page }) => {
  await page
    .getByRole("dialog", { name: "Settle", exact: true })
    .getByRole("button", { name: /^(Archive|Settle)$/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: /^Also settle/ }),
  ).toBeVisible();
});
When("I cancel the Settle subitem choice", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /^Also settle/ })).toHaveCount(
    0,
  );
});
When("I include the Settle subitems", async ({ page }) => {
  await page
    .getByRole("dialog", { name: /^Also settle/ })
    .getByRole("button", { name: /^Include subitem/ })
    .click();
  await expect(page.getByRole("dialog", { name: /^Also settle/ })).toHaveCount(
    0,
  );
});
When("another subitem arrives during the Settle choice", async ({ page }) => {
  await page.evaluate(async () => {
    const { localStore } = await import(
      /* @vite-ignore */ "/src/lib/local-store.ts"
    );
    localStore.addWorkItem({
      title: "Incoming subitem",
      parentWorkItemId: "settle-parent",
      workflowStateId: "doing",
    });
  });
});
Then(
  "the Settle draft still has source state {string} and priority {string}",
  async ({ page }, state: string, priority: string) => {
    const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("State", { exact: true })).toHaveText(state);
    await expect(dialog.getByLabel("Priority", { exact: true })).toHaveText(
      PRIORITY_NAMES[priority] ?? priority,
    );
    await expect(
      dialog.getByRole("button", { name: "Archive", exact: true }),
    ).toBeEnabled();
    const parent = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "settle-parent",
      ),
    );
    expect(parent.status).toBe("active");
    expect(parent.sourceStatusLabel).toBe("Active");
    expect(parent.priority).toBe(2);
  },
);
Then(
  "the Settle dialog closes and the parent is {string}",
  async ({ page }, status: string) => {
    await expect(
      page.getByRole("dialog", { name: "Settle", exact: true }),
    ).toHaveCount(0);
    const parent = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ajour.local-state.v2")!).workItems.find(
        (item: { _id: string }) => item._id === "settle-parent",
      ),
    );
    expect(parent.status).toBe(status);
    expect(parent.workflowStateId).toBe(
      status === "archived" ? "done" : "doing",
    );
  },
);
When("I reopen Settle after the parent gets a long title", async ({ page }) => {
  await page
    .getByRole("dialog", { name: "Settle", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  // The renamed item's "…" button changes its name, so the dialog opens
  // through the same entry point the action menu uses.
  await page.evaluate(async () => {
    const { localStore } = await import(
      /* @vite-ignore */ "/src/lib/local-store.ts"
    );
    const { requestSettle } = await import(
      /* @vite-ignore */ "/src/features/backlog/settle-dialog.tsx"
    );
    localStore.updateWorkItem("settle-parent", {
      title:
        "Transfer the whole process so the team uses tasks well, and also review how comments get synced back to the source",
    });
    requestSettle("settle-parent");
  });
  await expect(
    page.getByRole("dialog", { name: "Settle", exact: true }),
  ).toBeVisible();
});
Then(
  "the Settle dialog fits its width without a horizontal scroll",
  async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
    await expect(
      dialog.getByRole("button", { name: "Settle", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    const { scrollWidth, clientWidth } = await dialog.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  },
);
