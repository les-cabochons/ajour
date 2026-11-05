import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  exampleProjectSourceManifest,
  fixtureSnapshot,
} from "../../../../../packages/example/index.ts";

/*
 * Managed projects (#505, #509): the example project source's fixture,
 * served through a mocked local API, synced from Settings.
 */

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const CONNECTION = "planner";

/** The snapshot each page's mocked route serves; a step may change it. */
const snapshots = new WeakMap<Page, typeof fixtureSnapshot>();

const plugin = {
  ...exampleProjectSourceManifest,
  connectionFields: exampleProjectSourceManifest.connectionFields.map(
    (field) => ({ secret: false, ...field }),
  ),
};

/** The connection, last synced just now. */
function connection() {
  return {
    id: CONNECTION,
    pluginId: plugin.id,
    label: "Planner",
    tenantLabel: "Example",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    lastSyncAt: Date.now(),
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: {
      label: "Planner",
      tenantLabel: "Example",
      serviceUrl: "https://planner.example",
    },
  };
}

function overview() {
  return {
    vault: { state: "available" },
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [{ plugin, enabled: true, connections: [connection()] }],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

Given(
  "I have a local project {string} with the code {string}",
  async ({ page }, name: string, code: string) => {
    await page.addInitScript(
      ({ name, code }) => {
        if (sessionStorage.getItem("managed-projects-fixture")) return;
        localStorage.clear();
        sessionStorage.setItem("managed-projects-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            projects: [
              {
                _id: "mine",
                name,
                code,
                color: "#123456",
                icon: { kind: "preset", name: "dot" },
                status: "active",
                tasks: [],
              },
            ],
          }),
        );
      },
      { name, code },
    );
  },
);

Given("the example project source is connected", async ({ page }) => {
  snapshots.set(page, structuredClone(fixtureSnapshot));
  // Synced a moment ago with nothing to bring, so the scheduler, which goes
  // by the web's own last sync, leaves it to Sync now.
  await page.addInitScript(
    ({ connectionId, pluginId }) => {
      if (sessionStorage.getItem("managed-projects-source")) return;
      sessionStorage.setItem("managed-projects-source", "true");
      const state = JSON.parse(
        localStorage.getItem("ajour.local-state.v2") ?? "{}",
      );
      state.projectSources = {
        [connectionId]: {
          pluginId,
          label: "Example planner",
          asOf: "2026-10-01T00:00:00.000Z",
          syncedAt: Date.now(),
          held: [],
        },
      };
      localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
    },
    { connectionId: CONNECTION, pluginId: plugin.id },
  );
  await page.route(`${apiUrl}/api/plugins`, (route) =>
    route.fulfill({ json: overview(), headers: cors }),
  );
  await page.route(
    `${apiUrl}/api/plugins/${plugin.id}/connections/${CONNECTION}/sync-projects`,
    (route) =>
      route.fulfill({
        json: { connection: connection(), snapshot: snapshots.get(page) },
        headers: cors,
      }),
  );
});

When("I sync the example project source now", async ({ page }) => {
  if (!new URL(page.url()).pathname.startsWith("/settings/plugins/")) {
    await page.goto(`/settings/plugins/${plugin.id}`);
  }
  await page.getByRole("button", { name: "More actions for Planner" }).click();
  await page.getByRole("menuitem", { name: "Sync now", exact: true }).click();
  await expect(page.getByText(/^Planner · /)).toBeVisible();
});

Then("Settings says {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then(
  "the project I had is now {string}, from the source project {string}",
  async ({ page }, name: string, remoteId: string) => {
    const project = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("ajour.local-state.v2")!);
      return state.projects.find(
        (candidate: { _id: string }) => candidate._id === "mine",
      );
    });
    // Its ID is the one it had, so its time entries stay on it.
    expect(project).toMatchObject({
      name,
      code: "ACME-SUP",
      source: { pluginId: plugin.id, connectionId: CONNECTION, remoteId },
    });
  },
);

When(
  "the source renames {string} to {string}",
  async ({ page }, remoteId: string, name: string) => {
    const snapshot = snapshots.get(page)!;
    snapshot.projects.find((project) => project.remoteId === remoteId)!.name =
      name;
    // A fresh page: Sync now reads the new name.
    await page.reload();
    await expect(
      page.getByRole("button", { name: "More actions for Planner" }),
    ).toBeVisible();
  },
);

Then("the Projects list shows {string}", async ({ page }, name: string) => {
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
});

Then(
  "the Projects list doesn't show {string}",
  async ({ page }, name: string) => {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  },
);

Then("the title says {string}", async ({ page }, mark: string) => {
  await expect(
    page.locator(".project-detail-header").getByText(mark, { exact: true }),
  ).toBeVisible();
});

Then(
  "the Full name, Code and Client rows are locked by {string}",
  async ({ page }, label: string) => {
    const card = page.getByRole("region", { name: "Properties" });
    for (const row of ["Full name", "Code", "Client"]) {
      const value = card.locator("dt", { hasText: row }).locator("+ dd");
      await expect(value.getByText(`Locked. ${label} sets it.`)).toBeAttached();
      await expect(value.getByRole("button")).toHaveCount(0);
    }
    await expect(
      card.getByRole("button", { name: /^Project color/ }),
    ).toBeVisible();
  },
);

Then(
  "the link {string} opens {string}",
  async ({ page }, name: string, url: string) => {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", url);
    await expect(link).toHaveAttribute("target", "_blank");
  },
);

Then(
  "the Projects list marks {string} as from {string}",
  async ({ page }, name: string, label: string) => {
    const row = page.locator("tr", {
      has: page.getByRole("link", { name, exact: true }),
    });
    await expect(row.getByRole("img", { name: `From ${label}` })).toBeVisible();
  },
);

Then(
  "only {string} says {string} in the task menu",
  async ({ page }, task: string, hint: string) => {
    const rows = page.locator("[cmdk-item][data-task-id]");
    await expect(rows.filter({ hasText: hint })).toHaveCount(1);
    await expect(rows.filter({ hasText: hint })).toContainText(task);
  },
);

Then(
  "at 390px the title is whole and the {string} mark is cut first",
  async ({ page }, mark: string) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const header = page.locator(".project-detail-header");
    const title = header.locator(".project-detail-title button");
    const metrics = await title.evaluate((element) => ({
      cut: element.scrollWidth - element.clientWidth > 1,
    }));
    expect(metrics.cut).toBe(false);
    const group = header.getByRole("group", { name: mark });
    const box = await group.boundingBox();
    const headerBox = await header.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      headerBox!.x + headerBox!.width + 1,
    );
  },
);

/*
 * Merge into… (#507): a local task of the linked project, its entries, and
 * the task picker or a suggestion that moves them to a source task.
 */

Given(
  "its task {string} has an entry {string}",
  async ({ page }, name: string, note: string) => {
    await page.addInitScript(
      ({ name, note }) => {
        if (sessionStorage.getItem("managed-projects-task")) return;
        sessionStorage.setItem("managed-projects-task", "true");

Given(
  "I logged {int} hours on its task {string} on {word}",
  async ({ page }, hours: number, task: string, localDate: string) => {
    await page.addInitScript(
      ({ hours, task, localDate }) => {
        if (sessionStorage.getItem("managed-projects-entry")) return;
        sessionStorage.setItem("managed-projects-entry", "true");
        const state = JSON.parse(
          localStorage.getItem("ajour.local-state.v2") ?? "{}",
        );
        state.projects[0].tasks.push({
          _id: "local-task",
          name,

          _id: "login",
          name: task,
          status: "active",
          createdAt: 1,
        });
        state.timesheetEntries = [
          {
            _id: "local-entry",
            localDate: "2026-10-28",
            projectId: state.projects[0]._id,
            taskId: "local-task",
            label: name,
            note,
            durationMs: 3_600_000,

            _id: "entry-login",
            localDate,
            projectId: state.projects[0]._id,
            taskId: "login",
            label: "",
            durationMs: hours * 3_600_000,
            sourceBlockIds: [],
            committedAt: 1,
          },
        ];
        localStorage.setItem("ajour.local-state.v2", JSON.stringify(state));
      },
      { name, note },

      { hours, task, localDate },
    );
  },
);

When("I open the project {string}", async ({ page }, name: string) => {
  await page.goto("/projects");
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});

When(
  "I merge the task {string} into {string}",
  async ({ page }, from: string, into: string) => {
    const row = page.getByRole("row").filter({ hasText: from });
    // The "…" button shows on hover, as on every task row.
    await row.hover();
    await row.getByRole("button", { name: `Actions for ${from}` }).click();
    await page.getByRole("menuitem", { name: "Merge into…" }).click();
    const picker = page.getByRole("dialog");
    await expect(picker.getByText("Merge into", { exact: true })).toBeVisible();
    await picker.getByPlaceholder("Search tasks…").fill(into.slice(0, 10));
    await picker.getByRole("option", { name: into }).click();
  },
);

Then(
  "the project's entries show {string} under {string}",
  async ({ page }, note: string, task: string) => {
    await page.getByRole("tab", { name: /^Time entries/ }).click();
    const row = page.getByRole("link").filter({ hasText: note });
    await expect(row).toContainText(task);
  },
);

Then("the task {string} is archived", async ({ page }, name: string) => {
  await page.getByRole("tab", { name: /^Tasks/ }).click();
  await page.getByRole("tab", { name: /^Archived/ }).click();
  await expect(
    page.getByRole("row").filter({ hasText: name }).getByText("Archived"),
  ).toBeVisible();
});

Then("a merge suggestion says {string}", async ({ page }, text: string) => {
  const row = page.locator("[data-task-merge-suggestion]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(text);
});

When("I answer {string} on the suggestion", async ({ page }, label: string) => {
  await page
    .locator("[data-task-merge-suggestion]")
    .getByRole("button", { name: label, exact: true })
    .click();
});

Then("no merge suggestion shows", async ({ page }) => {
  await expect(page.getByRole("tab", { name: /^Tasks/ })).toBeVisible();
  await expect(page.locator("[data-task-merge-suggestion]")).toHaveCount(0);
});

When(
  "the source counts the commit, but only {int} hour of it for me",
  async ({ page }, hours: number) => {
    const snapshot = snapshots.get(page)!;
    // The source's figures are from after the commit: it consumed the two
    // hours, but has only one of them for the user.
    snapshot.asOf = new Date().toISOString();
    const acme = snapshot.projects.find(
      (project) => project.remoteId === "ACME-SUP",
    )!;
    acme.budget = { ...acme.budget!, consumed: 33.5, remaining: 6.5 };
    for (const task of acme.tasks) {
      if (task.name === "Ticket #101 - Login") task.myHours = hours;
      else delete task.myHours;
    }
  },
);

/** A figure's value on the budget card, by its label. */
function budgetFigure(page: Page, label: string) {
  return page
    .getByRole("region", { name: "Budget" })
    .locator("dt", { hasText: label })
    .locator("xpath=following-sibling::dd[1]");
}

Then(
  "the budget card reads {string} Not counted yet and {string} Remaining",
  async ({ page }, notCounted: string, remaining: string) => {
    await expect(budgetFigure(page, "Not counted yet")).toHaveText(notCounted);
    await expect(budgetFigure(page, "≈ Remaining")).toHaveText(
      new RegExp(`^${remaining}Estimate`),
    );
  },
);

Then("the budget card says {string}", async ({ page }, text: string) => {
  await expect(page.getByRole("region", { name: "Budget" })).toContainText(
    text,
  );
});

Then(
  "the committed entries show {string} with {string}",
  async ({ page }, task: string, committed: string) => {
    const list = page.getByRole("list", { name: "Tasks that differ" });
    await expect(list).toContainText(task);
    await expect(list).toContainText(committed);
  },
);
