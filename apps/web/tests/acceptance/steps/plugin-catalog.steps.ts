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
      page.getByText("Some plugin sources couldn't be read", {
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
  unsignedPluginsEnabled: true,
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
        // A file install is unsigned: updating from one needs the switch on.
        getPluginCatalogSettings: async () => ({
          refreshMinutes: 15,
          allowUnsignedInstalls: true,
        }),
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

const ALICE = "https://codeberg.org/alice/plugins";

Given("Alice's unsigned plugin source can be added", async ({ page }) => {
  await page.addInitScript((url) => {
    const desktop = window.ajourDesktop!;
    const original = desktop.getPluginCatalog!;
    Object.assign(desktop, {
      inspectPluginSource: async () => ({
        url,
        name: "Alice's plugins",
        official: false,
        hostKind: "gitea",
        signed: false,
        plugins: [{ id: "weather", name: "Weather", version: "1.0.0" }],
        alreadyAdded: false,
      }),
      addPluginSource: async (added: string, keyFingerprint: string | null) => {
        if (added !== url || keyFingerprint !== null) {
          throw new Error("Unexpected source");
        }
        return {
          ...(await original()),
          sources: [
            {
              url,
              name: "Alice's plugins",
              official: false,
              hostKind: "gitea",
              state: "unsigned",
              pluginCount: 1,
            },
          ],
        };
      },
    });
  }, ALICE);
});

When("I add the plugin source {string}", async ({ page }, address: string) => {
  await page.getByLabel("Add a source", { exact: true }).fill(address);
  await page
    .getByRole("button", { name: "Add source", exact: true })
    .first()
    .click();
});

Then(
  "Ajour shows the source's plugins and warns that it isn't signed",
  async ({ page }) => {
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Add Alice's plugins?" }),
    ).toBeVisible();
    await expect(dialog.getByText("Weather", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("This source isn't signed", { exact: false }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/plugin-source-review.png" });
  },
);

When("I confirm adding the source", async ({ page }) => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add source", exact: true })
    .click();
});

Then("Alice's plugins is listed as an unsigned source", async ({ page }) => {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Alice's plugins is added.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Alice's plugins", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("codeberg.org/alice/plugins · 1 plugin", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/plugin-sources.png",
    fullPage: true,
  });
});

Given("plugins can be installed from a file", async ({ page }) => {
  await page.addInitScript(() => {
    let settings = { refreshMinutes: 15, allowUnsignedInstalls: false };
    Object.assign(window.ajourDesktop!, {
      installPlugin: async () => null,
      getPluginCatalogSettings: async () => settings,
      configurePluginCatalog: async (next: typeof settings) => {
        settings = next;
        return settings;
      },
    });
  });
});

Then(
  "installing from a file waits for unsigned installs to be allowed",
  async ({ page }) => {
    await expect(
      page.getByRole("button", { name: "Install from file", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("switch", {
        name: "Allow installing unsigned plugins",
        exact: true,
      }),
    ).not.toBeChecked();
  },
);

When("I allow installing unsigned plugins", async ({ page }) => {
  await page
    .getByRole("switch", {
      name: "Allow installing unsigned plugins",
      exact: true,
    })
    .click();
});

Then("I can install a plugin from a file", async ({ page }) => {
  await expect(
    page.getByText(
      "Unsigned plugins can be installed. Ajour warns you each time.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Install from file", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/plugin-unsigned-switches.png" });
});
