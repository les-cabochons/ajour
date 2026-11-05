import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  exampleProjectSourceManifest,
  fixtureSnapshot,
} from "../../../../../packages/example/index.ts";

/*
 * Managed projects (#505): the example project source's fixture, served
 * through a mocked local API, synced from Settings.
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

/** Synced just now, so the scheduler leaves it to Sync now. */
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
