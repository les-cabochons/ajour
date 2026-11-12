import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { TimeSyncRequest } from "@ajour/shared";
import {
  deleteExampleRemoteEntry,
  editExampleRemoteEntry,
  exampleProjectSourceManifest,
  logExampleRemoteEntry,
  runExampleTimeSyncRound,
  startExampleRemoteTimer,
} from "../../../../../packages/example/index.ts";
import { timeEntryEditor } from "../../fixtures/time-entry-editor";

/*
 * Time sync (#691 to #696): the example planner declares a project source
 * and a time sync. A mocked local API serves it. With Time entries off, it
 * answers turning it on as the API does when the plugin refuses the
 * connection: a 400 with the connection's label and the plugin's sentence.
 * With Time entries on, its sync-time-entries route is a stateful fake
 * remote: the example planner's own in-memory remote, one per page, where
 * a step logs, edits and deletes entries, or starts a timer, as another
 * tool would. The page's clock runs as usual, and a step moves it forward
 * to reach the next 60-second round without waiting for it.
 */

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const CONNECTION = "planner";
const REFUSAL =
  "Planner: Time entries need a token that can write. This one can only read.";

const plugin = {
  ...exampleProjectSourceManifest,
  connectionFields: exampleProjectSourceManifest.connectionFields.map(
    (field) => ({ secret: false, ...field }),
  ),
};

function overview(timeSync: "on" | "off" = "off") {
  return {
    vault: { state: "available" },
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        inactiveCapabilities: timeSync === "on" ? [] : ["timeSync"],
        connections: [
          {
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
          },
        ],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

Given(
  "the example planner is connected, and refuses a token that can only read for time entries",
  async ({ page }) => {
    // Synced a moment ago, so the project source scheduler leaves it alone.
    await page.addInitScript(
      ({ connectionId, pluginId }) => {
        if (sessionStorage.getItem("time-sync-fixture")) return;
        localStorage.clear();
        sessionStorage.setItem("time-sync-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            projectSources: {
              [connectionId]: {
                pluginId,
                label: "Example planner",
                asOf: "2026-10-01T00:00:00.000Z",
                syncedAt: Date.now(),
                held: [],
              },
            },
          }),
        );
      },
      { connectionId: CONNECTION, pluginId: plugin.id },
    );
    await page.route(`${apiUrl}/api/plugins`, (route) =>
      route.fulfill({ json: overview(), headers: cors }),
    );
    await page.route(
      `${apiUrl}/api/plugins/${plugin.id}/activation`,
      async (route) => {
        expect(route.request().postDataJSON()).toEqual({
          enabled: true,
          capability: "timeSync",
        });
        await route.fulfill({
          status: 400,
          json: { error: REFUSAL },
          headers: cors,
        });
      },
    );
  },
);

When("I open the example planner's settings", async ({ page }) => {
  await page.goto(`/settings/plugins/${plugin.id}`);
  await expect(
    page.getByRole("heading", { name: plugin.displayName, exact: true }),
  ).toBeVisible();
});

Then("the example planner's Time entries switch is off", async ({ page }) => {
  await expect(
    page.getByRole("switch", {
      name: `Activate time entries for ${plugin.displayName}`,
      exact: true,
    }),
  ).not.toBeChecked();
});

When("I turn on time entries for the example planner", async ({ page }) => {
  await page
    .getByRole("switch", {
      name: `Activate time entries for ${plugin.displayName}`,
      exact: true,
    })
    .click();
});

/** Today in the browser's time zone, as Ajour dates entries. */
function today() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Each page's fake remote: the example planner's remote under a key of its
 * own, the remote id it first gave each task's entry, and the entry another
 * tool logged last, for its edit and delete.
 */
const remotes = new WeakMap<
  Page,
  {
    key: string;
    failNextChange?: string;
    firstIds: Map<string, string>;
    loggedId?: string;
  }
>();

/** What the page's fake remote holds now. */
function remoteEntries(page: Page) {
  return runExampleTimeSyncRound(remotes.get(page)!.key, {
    from: "2000-01-01",
    to: "2100-12-31",
    timeZone: "UTC",
    changes: [],
  }).entries;
}

Given(
  "the example planner manages {string}, with Time entries on",
  async ({ page }, projectName: string) => {
    remotes.set(page, {
      key: `acceptance-${crypto.randomUUID()}`,
      firstIds: new Map(),
    });
    await page.clock.install();
    // Synced a moment ago, so the project source scheduler leaves it alone.
    await page.addInitScript(
      ({ connectionId, pluginId, projectName }) => {
        if (sessionStorage.getItem("time-sync-fixture")) return;
        localStorage.clear();
        sessionStorage.setItem("time-sync-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            projects: [
              {
                _id: "acme",
                name: projectName,
                code: "ACME-SUP",
                color: "#123456",
                icon: { kind: "preset", name: "dot" },
                status: "active",
                source: {
                  pluginId,
                  connectionId,
                  remoteId: "ACME-SUP",
                  syncedAt: Date.now(),
                },
                tasks: [
                  {
                    _id: "login",
                    name: "Ticket #101 - Login",
                    status: "active",
                    createdAt: 1,
                    source: { remoteId: "1001", assigned: true },
                  },
                  {
                    _id: "export",
                    name: "Ticket #102 - Export",
                    status: "active",
                    createdAt: 1,
                    source: { remoteId: "1002", assigned: true },
                  },
                ],
              },
            ],
            projectSources: {
              [connectionId]: {
                pluginId,
                label: "Example planner",
                asOf: "2026-10-01T00:00:00.000Z",
                syncedAt: Date.now(),
                held: [],
              },
            },
          }),
        );
      },
      { connectionId: CONNECTION, pluginId: plugin.id, projectName },
    );
    await page.route(`${apiUrl}/api/plugins`, (route) =>
      route.fulfill({ json: overview("on"), headers: cors }),
    );
    await page.route(
      `${apiUrl}/api/plugins/${plugin.id}/connections/${CONNECTION}/sync-time-entries`,
      async (route) => {
        const remote = remotes.get(page)!;
        const request = route.request().postDataJSON() as TimeSyncRequest;
        if (remote.failNextChange && request.changes.length > 0) {
          const error = remote.failNextChange;
          remote.failNextChange = undefined;
          await route.fulfill({ status: 502, json: { error }, headers: cors });
          return;
        }
        const answer = runExampleTimeSyncRound(remote.key, request);
        await route.fulfill({
          json: {
            connection: overview("on").connectionGroups[0]!.connections[0],
            ...answer,
          },
          headers: cors,
        });
      },
    );
  },
);

Given(
  "the planner fails the next round that brings a change with {string}",
  async ({ page }, message: string) => {
    remotes.get(page)!.failNextChange = message;
  },
);

When(
  "I log {string} on {string} today",
  async ({ page }, hours: string, task: string) => {
    await page.goto(`/time/${today()}?view=day`);
    await page.getByRole("button", { name: "Create time entry" }).click();
    const editor = timeEntryEditor(page);
    await editor.getByRole("button", { name: "Project or task" }).click();
    await page.getByPlaceholder("Search projects and tasks...").fill(task);
    await page.locator("[cmdk-item]").filter({ hasText: task }).first().click();
    await editor
      .getByRole("textbox", { name: "Hours", exact: true })
      .fill(hours);
    await editor.getByRole("button", { name: "Create entry" }).click();
    await expect(
      page.locator(".time-entry-row").filter({ hasText: task }),
    ).toContainText(hours);
  },
);

When(
  "I change today's {string} entry to {string} hours",
  async ({ page }, task: string, hours: string) => {
    await page.goto(`/time/${today()}?view=day`);
    const row = page.locator(".time-entry-row").filter({ hasText: task });
    await row.dblclick();
    await timeEntryEditor(page)
      .getByRole("textbox", { name: "Hours", exact: true })
      .fill(hours);
    await timeEntryEditor(page).getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText(hours);
  },
);

When("I delete today's {string} entry", async ({ page }, task: string) => {
  await page.goto(`/time/${today()}?view=day`);
  await page
    .locator(".time-entry-row")
    .filter({ hasText: task })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(
    page.locator(".time-entry-row").filter({ hasText: task }),
  ).toHaveCount(0);
});

Then(
  "the planner holds {int} minutes on {string} today",
  async ({ page }, minutes: number, task: string) => {
    // A round goes 2 seconds after the change, or after the 5 second wait
    // that follows a failed one.
    await expect
      .poll(
        () =>
          remoteEntries(page).map((entry) => ({
            localDate: entry.localDate,
            minutes: entry.minutes,
            taskName: entry.taskName,
            projectRemoteId: entry.projectRemoteId,
          })),
        { timeout: 15_000 },
      )
      .toEqual([
        {
          localDate: today(),
          minutes,
          taskName: task,
          projectRemoteId: "ACME-SUP",
        },
      ]);
  },
);

/** Picks a task in the open entry editor, then presses Start. */
async function startOn(page: Page, task: string) {
  const editor = timeEntryEditor(page);
  await editor.getByRole("button", { name: "Project or task" }).click();
  await page.getByPlaceholder("Search projects and tasks...").fill(task);
  await page.locator("[cmdk-item]").filter({ hasText: task }).first().click();
  await editor.getByRole("button", { name: "Start", exact: true }).click();
  await expect(runningEntryCard(page)).toContainText(task);
}

/** The sidebar's card of the running entry. */
function runningEntryCard(page: Page) {
  return page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("region", { name: "Running entry" });
}

When("I start an entry on {string}", async ({ page }, task: string) => {
  await page.goto(`/time/${today()}?view=day`);
  await page.getByRole("button", { name: "Create time entry" }).click();
  await startOn(page, task);
});

// Start on a new entry while another runs: the first is saved, and the new
// one starts at the same instant.
When("I switch to {string}", async ({ page }, task: string) => {
  await page.getByRole("button", { name: "Create time entry" }).first().click();
  await startOn(page, task);
});

When("I stop the running entry", async ({ page }) => {
  await runningEntryCard(page)
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await expect(runningEntryCard(page)).toHaveCount(0);
});

When("{int} minute(s) pass(es)", async ({ page }, minutes: number) => {
  // Fires the 60-second round that falls due meanwhile, once.
  await page.clock.fastForward(minutes * 60_000);
});

/**
 * Waits until the planner holds one entry on `task` as `expected`, and
 * checks it is the entry the planner first gave that task: a stop arrives
 * as the same entry, not a delete and a new one.
 */
async function expectRemoteEntry(
  page: Page,
  task: string,
  expected: { running: boolean; minutes?: number },
) {
  const remote = remotes.get(page)!;
  await expect
    .poll(
      () =>
        remoteEntries(page)
          .filter((entry) => entry.taskName === task)
          .map((entry) => ({
            localDate: entry.localDate,
            running: entry.running,
            counting: entry.countingSince !== undefined,
            ...(expected.minutes === undefined
              ? {}
              : { minutes: entry.minutes }),
          })),
      { timeout: 15_000 },
    )
    .toEqual([
      {
        localDate: today(),
        running: expected.running,
        counting: expected.running,
        ...(expected.minutes === undefined
          ? {}
          : { minutes: expected.minutes }),
      },
    ]);
  const [entry] = remoteEntries(page).filter(
    (candidate) => candidate.taskName === task,
  );
  if (!remote.firstIds.has(task)) remote.firstIds.set(task, entry!.remoteId);
  expect(entry!.remoteId).toBe(remote.firstIds.get(task));
}

Then("the planner shows {string} running", async ({ page }, task: string) => {
  await expectRemoteEntry(page, task, { running: true });
});

Then(
  "the planner shows {string} running for {int} minute(s)",
  async ({ page }, task: string, minutes: number) => {
    await expectRemoteEntry(page, task, { running: true, minutes });
  },
);

Then(
  "the planner shows {string} stopped at {int} minute(s), as the entry it showed running",
  async ({ page }, task: string, minutes: number) => {
    expect(remotes.get(page)!.firstIds.has(task)).toBe(true);
    await expectRemoteEntry(page, task, { running: false, minutes });
  },
);

Then("the planner holds no entry", async ({ page }) => {
  await expect.poll(() => remoteEntries(page), { timeout: 15_000 }).toEqual([]);
});

Then(
  "an error toast {string} says {string}",
  async ({ page }, title: string, text: string) => {
    const toasts = page.getByRole("region", { name: "Notifications" });
    await expect(toasts.getByText(title, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(toasts.getByText(text, { exact: true })).toBeVisible();
  },
);

/** Logs an entry in the page's fake remote as another tool would. */
async function logElsewhere(
  page: Page,
  minutes: number,
  taskName: string,
  projectRemoteId: string,
) {
  const remote = remotes.get(page)!;
  remote.loggedId = logExampleRemoteEntry(remote.key, {
    localDate: today(),
    minutes,
    projectRemoteId,
    taskName,
  }).remoteId;
}

Given(
  "another tool logged {int} minutes on {string} today in the planner",
  async ({ page }, minutes: number, task: string) => {
    await logElsewhere(page, minutes, task, "ACME-SUP");
  },
);

Given(
  "another tool logged {int} minutes on {string} of project {string} today in the planner",
  async ({ page }, minutes: number, task: string, project: string) => {
    await logElsewhere(page, minutes, task, project);
  },
);

When(
  "another tool changes that entry in the planner to {int} minutes",
  async ({ page }, minutes: number) => {
    const remote = remotes.get(page)!;
    editExampleRemoteEntry(remote.key, remote.loggedId!, { minutes });
  },
);

When(
  "another tool changes the planner's {string} entry to {int} minutes",
  async ({ page }, task: string, minutes: number) => {
    const entry = remoteEntries(page).find(
      (candidate) => candidate.taskName === task,
    );
    expect(entry).toBeDefined();
    editExampleRemoteEntry(remotes.get(page)!.key, entry!.remoteId, {
      minutes,
    });
  },
);

When("another tool deletes that entry in the planner", async ({ page }) => {
  const remote = remotes.get(page)!;
  deleteExampleRemoteEntry(remote.key, remote.loggedId!);
});

When(
  "another tool starts a timer on {string} in the planner",
  async ({ page }, task: string) => {
    // Now on the page's clock, which Ajour counts by and the steps move.
    const now = await page.evaluate(() => Date.now());
    startExampleRemoteTimer(remotes.get(page)!.key, {
      localDate: today(),
      projectRemoteId: "ACME-SUP",
      taskName: task,
      countingSince: new Date(now).toISOString(),
    });
  },
);

Then("the running entry is on {string}", async ({ page }, task: string) => {
  await expect(runningEntryCard(page)).toContainText(task, {
    timeout: 15_000,
  });
});

When("I open today in the Day view", async ({ page }) => {
  await page.goto(`/time/${today()}?view=day`);
});

When("I open this week's Commit page", async ({ page }) => {
  const now = new Date();
  // Back to Monday: getDay() counts Sunday as 0.
  now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const monday = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  await page.goto(`/time/${monday}/commit`);
});

When("I open Sync review", async ({ page }) => {
  await page.goto("/settings/sync-review");
});

When("a minute passes", async ({ page }) => {
  // The runner has the plugins overview, and so its 60-second round, once
  // the page is quiet.
  await page.waitForLoadState("networkidle");
  await page.clock.fastForward("01:00");
});

Then(
  "today's {string} entry shows {string}",
  async ({ page }, task: string, hours: string) => {
    await expect(
      page.locator(".time-entry-row").filter({ hasText: task }),
    ).toContainText(hours);
  },
);

Then("the Day view shows no {string} entry", async ({ page }, task: string) => {
  await expect(
    page.locator(".time-entry-row").filter({ hasText: task }),
  ).toHaveCount(0);
});

Then(
  "Sync review holds {string} on {string} for {string}, because {string}",
  async (
    { page },
    task: string,
    project: string,
    hours: string,
    reason: string,
  ) => {
    const held = page
      .getByRole("region", { name: "Time entries held from Planner" })
      .locator("[data-held-time-entry]");
    await expect(held).toHaveCount(1);
    await expect(held).toContainText(task);
    await expect(held).toContainText(project);
    await expect(held).toContainText(hours);
    await expect(held).toContainText(reason);
  },
);
