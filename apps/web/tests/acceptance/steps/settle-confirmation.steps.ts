import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();

Given("I have a writable synced parent Settle fixture", async ({ page }) => {
  const plugin = {
    id: "example",
    version: "1.0.0",
    apiVersion: 2,
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
        priorityFormat: "levels",
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
When("I open the parent Settle dialog", async ({ page }) => {
  await page
    .getByRole("main")
    .getByRole("button", { name: "Actions for Settle parent", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^Settle/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Settle", exact: true }),
  ).toBeVisible();
});
When(
  "I choose source state {string} and priority {string} in Settle",
  async ({ page }, state: string, priority: string) => {
    const dialog = page.getByRole("dialog", { name: "Settle", exact: true });
    await dialog.getByLabel("State", { exact: true }).selectOption(state);
    const input = dialog.getByLabel("Priority", { exact: true });
    if ((await input.evaluate((element) => element.tagName)) === "SELECT")
      await input.selectOption(priority);
    else await input.fill(priority);
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
    await expect(dialog.getByLabel("State", { exact: true })).toHaveValue(
      state,
    );
    await expect(dialog.getByLabel("Priority", { exact: true })).toHaveValue(
      priority,
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
