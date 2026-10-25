import { createRequire } from "node:module";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  PLUGIN_API_VERSION,
  type PluginCatalogEntry,
  type PluginsOverview,
} from "@ajour/shared";

const { Given, When, Then } = createBdd();
const { BUILT_IN_PLUGIN_CATALOG_ENTRIES: builtInEntries } = createRequire(
  import.meta.url,
)("../../../../desktop/electron/plugin-catalog-seed.cjs") as {
  BUILT_IN_PLUGIN_CATALOG_ENTRIES: PluginCatalogEntry[];
};

Given(
  "the catalog contains a plugin with backlog and code host capabilities",
  async ({ page }) => {
    const entries: PluginCatalogEntry[] = [
      ...builtInEntries,
      {
        ...builtInEntries[0]!,
        id: "combined",
        title: "Combined plugin",
        capabilities: ["connector", "codeHost"],
        features: ["work-item-sync", "pull-requests"],
      },
    ];
    await page.addInitScript((catalogEntries) => {
      window.ajourDesktop = {
        bootstrapLocalState: null,
        runtime: {
          automaticUpdatesEnabled: false,
          developmentBuild: false,
          platform: "win32",
          version: "0.1.0",
        },
        getPluginCatalog: async () => ({
          entries: catalogEntries,
          source: "cache",
          checkedAt: "2026-10-12T00:00:00Z",
        }),
        downloadCatalogPlugin: async () => {
          throw new Error("This scenario must not download a package.");
        },
      };
    }, entries);
  },
);

Given(
  "the catalog skipped an entry this Ajour cannot read",
  async ({ page }) => {
    // Runs after the Background's script, so it wraps its catalog.
    await page.addInitScript(() => {
      const desktop = (
        window as unknown as {
          ajourDesktop: { getPluginCatalog: () => Promise<object> };
        }
      ).ajourDesktop;
      const original = desktop.getPluginCatalog;
      desktop.getPluginCatalog = async () => ({
        ...(await original()),
        source: "network",
        skippedPluginIds: ["future-plugin"],
      });
    });
  },
);

Then("the catalog says {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then(
  "the catalog does not say it was loaded from its local cache",
  async ({ page }) => {
    await expect(
      page.getByText("The catalog was loaded from its local cache", {
        exact: false,
      }),
    ).toHaveCount(0);
  },
);

When(
  "I open the catalog at {int} pixels wide",
  async ({ page }, width: number) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/settings/plugins");
  },
);

Then("every plugin filter fits inside the viewport", async ({ page }) => {
  for (const name of [
    "All",
    "Backlog",
    "Code hosts",
    "Calendars",
    "Agent tasks",
    "Schemas",
  ]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }
  await page.getByRole("tab", { name: "All", exact: true }).click();
  await page.screenshot({
    path: `test-results/catalog-${page.viewportSize()!.width}.png`,
  });
});

When("I select the {string} plugin filter", async ({ page }, name: string) => {
  await page.getByRole("tab", { name, exact: true }).click();
});

Then(
  "the combined plugin appears with its backlog and code host badge",
  async ({ page }) => {
    const entry = page.getByRole("link", {
      name: "View Combined plugin",
      exact: true,
    });
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("Backlog · Code host");
  },
);

Then("the GitHub catalog entry offers a download", async ({ page }) => {
  const entry = page.getByRole("link", { name: "View GitHub", exact: true });
  await expect(entry).toBeVisible();
  await expect(
    entry
      .locator("..")
      .getByRole("button", { name: "Download GitHub", exact: true }),
  ).toBeEnabled();
});

Then("the Workday schema is the only catalog entry", async ({ page }) => {
  await expect(page.getByRole("link", { name: /^View / })).toHaveText(
    /Workday schema/,
  );
});

Then(
  "the Workday agent is the only catalog entry and offers a download",
  async ({ page }) => {
    await expect(page.getByRole("link", { name: /^View / })).toHaveText(
      /Workday \(agent\)/,
    );
    await expect(
      page.getByRole("button", {
        name: "Download Workday (agent)",
        exact: true,
      }),
    ).toBeEnabled();
    await page.screenshot({ path: "test-results/catalog-agent-tasks.png" });
  },
);

const oldJira = {
  id: "jira",
  displayName: "Jira",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION - 1,
  description: "Test connector",
  iconSvg:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>",
  entrypoint: "",
  capabilities: { connector: {} },
  connectionFields: [
    {
      id: "token",
      label: "Token",
      type: "password" as const,
      required: true,
      secret: true,
    },
  ],
  unavailableReason: `Jira 1.0.0 uses plugin API ${PLUGIN_API_VERSION - 1}, but this version of Ajour needs plugin API ${PLUGIN_API_VERSION}. Update the plugin to use it again.`,
};
const savedJiraConnection = {
  id: "saved-jira",
  pluginId: "jira",
  label: "My Jira",
  tenantLabel: "My workspace",
  autoSync: false,
  autoSyncIntervalMinutes: 15,
  connectedAt: 1,
  pendingImportCount: 0,
  selectedImportCount: 0,
  configSummary: { organizationUrl: "https://example.invalid" },
  editableValues: {},
};
const oldJiraOverview: PluginsOverview = {
  pluginsEnabled: true,
  plugins: [oldJira],
  connectionGroups: [
    { plugin: oldJira, enabled: false, connections: [savedJiraConnection] },
  ],
  totalPendingImportCount: 0,
  totalSelectedImportCount: 0,
};
const { unavailableReason: _reason, ...jiraIdentity } = oldJira;
const updatedJira = {
  ...jiraIdentity,
  apiVersion: PLUGIN_API_VERSION,
  version: "1.1.0",
  entrypoint: "plugin.mjs",
};
const updatedJiraOverview: PluginsOverview = {
  ...oldJiraOverview,
  plugins: [updatedJira],
  connectionGroups: [
    {
      ...oldJiraOverview.connectionGroups[0]!,
      plugin: updatedJira,
      enabled: true,
    },
  ],
};

Given("an installed Jira plugin uses an older plugin API", async ({ page }) => {
  await page.route("**/api/plugins", async (route) => {
    const updated = await page.evaluate(
      () => sessionStorage.getItem("jira-updated") === "true",
    );
    await route.fulfill({
      json: updated ? updatedJiraOverview : oldJiraOverview,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.route("**/api/project-data-shapes", (route) =>
    route.fulfill({
      json: { plugins: [] },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.addInitScript(
    ({ plugin, overview }) => {
      const result = { plugin, replaced: true, overview };
      const update = async () => {
        if (sessionStorage.getItem("jira-fail-next") === "true") {
          sessionStorage.removeItem("jira-fail-next");
          throw new Error("Plugin download failed. Try again.");
        }
        sessionStorage.setItem("jira-updated", "true");
        return result;
      };
      Object.assign(window.ajourDesktop!, {
        downloadCatalogPlugin: async (id: string) => {
          if (id !== "jira") throw new Error("Unexpected plugin download");
          return { type: "plugin", result: await update() };
        },
        installPlugin: update,
      });
    },
    { plugin: updatedJira, overview: updatedJiraOverview },
  );
});

Given("the next Jira update download fails", async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("jira-fail-next", "true"),
  );
});

Given("Jira has no catalog download", async ({ page }) => {
  await page.addInitScript(() => {
    window.ajourDesktop!.getPluginCatalog = async () => ({
      entries: [],
      source: "cache",
      checkedAt: "2026-10-15T00:00:00Z",
    });
  });
});

When(
  "I open the {word} for Jira at {int} pixels wide",
  async ({ page }, view: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(
      view === "catalog" ? "/settings/plugins" : "/settings/plugins/jira",
    );
  },
);

Then("Jira explains the plugin API mismatch", async ({ page }) => {
  await expect(
    page.getByText(oldJira.unavailableReason, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Unavailable", { exact: true }).first(),
  ).toBeVisible();
  const update = page.getByRole("button", { name: "Update Jira", exact: true });
  await expect(update).toBeEnabled();
  await update.scrollIntoViewIfNeeded();
  const box = await update.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({
    path: `test-results/plugin-update-${page.viewportSize()!.width}.png`,
  });
});

When("I update Jira", async ({ page }) => {
  await page.getByRole("button", { name: "Update Jira", exact: true }).click();
});

Then("Jira is available with its saved connection", async ({ page }) => {
  // Catalog updates are verified on the detail page as well.
  if (!page.url().endsWith("/jira")) {
    await page.getByRole("link", { name: "View Jira", exact: true }).click();
  }
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(0);
  await expect(page.getByText("My Jira", { exact: true })).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText(/Organization Url:|Last sync:/)).toHaveCount(0);
  await expect(page.getByText(/Connection ready to/)).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "Deactivate Jira", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Update Jira", exact: true }),
  ).toHaveCount(0);
});

Then(
  "the update error is shown and Jira can be updated again",
  async ({ page }) => {
    await expect(
      page.getByText("Plugin download failed. Try again.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("My Jira", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Update Jira", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Add a connection", exact: true }),
    ).toBeDisabled();
  },
);

Then(
  "Jira offers an update from file instead of a catalog update",
  async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "Update Jira", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Update from file", exact: true }),
    ).toBeEnabled();
  },
);

When("I update Jira from a file", async ({ page }) => {
  await page
    .getByRole("button", { name: "Update from file", exact: true })
    .click();
});

Given("plugins are off because {string}", async ({ page }, reason: string) => {
  // The local API turns every plugin off while this computer can't
  // sandbox them, and says why.
  const overview: PluginsOverview = {
    ...updatedJiraOverview,
    connectionGroups: updatedJiraOverview.connectionGroups.map((group) => ({
      ...group,
      enabled: false,
    })),
    sandbox: { state: "off", reason },
  };
  await page.route("**/api/plugins", (route) =>
    route.fulfill({
      json: overview,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route("**/api/project-data-shapes", (route) =>
    route.fulfill({
      json: { plugins: [] },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
});

Then(
  "the plugins page says {string} with {string}",
  async ({ page }, title: string, reason: string) => {
    const notice = page.getByText(title, { exact: true }).locator("xpath=..");
    await expect(notice).toBeVisible();
    await expect(notice.getByText(reason, { exact: true })).toBeVisible();
    const box = await notice.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({
      path: `test-results/plugins-off-${page.viewportSize()!.width}.png`,
    });
  },
);

Then("Jira shows as off with its saved connection", async ({ page }) => {
  if (page.url().endsWith("/jira")) {
    await expect(page.getByText("My Jira", { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("switch", { name: "Activate Jira", exact: true }),
  ).not.toBeChecked();
});
