import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { PluginCatalogEntry } from "@ajour/shared";

const { Given, When, Then } = createBdd();
const { BUILT_IN_PLUGIN_CATALOG_ENTRIES: builtInEntries } = createRequire(
  import.meta.url,
)("../../../../desktop/electron/plugin-catalog-seed.cjs") as {
  BUILT_IN_PLUGIN_CATALOG_ENTRIES: PluginCatalogEntry[];
};

const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const ICON =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>";
const MINUTE = 60_000;

// The Access section and the consent panel, against a local API that answers
// from memory. Each scenario builds the plugin's overview group the way the
// real API reports it: the manifest's access, the broker's activity record,
// and the access an update waits for the user to allow.

type Json = Record<string, any>;
type Table = { raw(): string[][] };

interface Mock {
  /** The installed plugin's group, or none when the plugin isn't installed. */
  group: Json | null;
  /** Bodies of the activation requests. */
  activations: Json[];
}

let mock: Mock;

function tracker(apiVersion: number, version = "1.0.0"): Json {
  return {
    id: "tracker",
    displayName: "Tracker",
    version,
    apiVersion,
    description: "Tracker work items.",
    iconSvg: ICON,
    entrypoint: "plugin.mjs",
    capabilities: {
      connector: {},
      agentTask: {
        tasks: [
          {
            id: "enter-week",
            label: "Enter the week",
            placement: "commit-week",
            prompt: "prompts/enter-week.md",
            estimateMinutes: 5,
            settings: [],
          },
        ],
      },
    },
    connectionFields: [
      {
        id: "baseUrl",
        label: "Site URL",
        type: "url",
        required: true,
        secret: false,
      },
      {
        id: "apiToken",
        label: "API token",
        type: "password",
        required: true,
        secret: true,
      },
    ],
  };
}

const BASE_ENDPOINTS = [
  { host: "base", method: "GET", path: "/rest/myself" },
  {
    host: "base",
    method: "PUT",
    path: "/rest/issue/*",
    access: "editIssues",
  },
];
const PEOPLE_FORM = {
  id: "people",
  whenHost: "tracker.example.com",
  host: "people.{host}",
  keepBasePath: true,
};
const PEOPLE_ENDPOINT = { host: "people", method: "GET", path: "/rest/people" };

function view(extra: Json = {}): Json {
  return {
    summary: {
      capabilities: ["agentTask", "connector"],
      authSchemes: [{ scheme: "bearer", fields: ["apiToken"] }],
      hosts: [{ kind: "baseAddress", field: "baseUrl" }],
      derivedHosts: [PEOPLE_FORM],
      endpoints: [...BASE_ENDPOINTS, PEOPLE_ENDPOINT],
      publicHosts: ["avatars.example.com"],
      mcpTools: [{ task: "enter-week", tool: "get_week_status" }],
      agentPrompts: [{ task: "enter-week", prompt: "hash" }],
      alwaysOnAccess: [],
      accessOperations: [{ choice: "editIssues", operation: "writeSettle" }],
      startMode: "whenNeeded",
      ...extra,
    },
    hostLabels: { people: "People in your organisation" },
    choices: [{ id: "editIssues", label: "Edit issues", always: false }],
  };
}

const NOTHING_NEW = {
  capabilities: [],
  authSchemes: [],
  hosts: [],
  derivedHosts: [],
  endpoints: [],
  publicHosts: [],
  mcpTools: [],
  agentPrompts: [],
  alwaysOnAccess: [],
  accessOperations: [],
  ungatedOperations: [],
  alwaysReady: false,
};

function groupOf(extra: Json = {}, plugin = tracker(4)): Json {
  return {
    plugin,
    enabled: true,
    connections: [],
    access: view(),
    ...extra,
  };
}

function overviewOf(current: Mock) {
  return {
    pluginsEnabled: true,
    plugins: current.group ? [current.group.plugin] : [],
    connectionGroups: current.group ? [current.group] : [],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
    vault: { state: "available" },
  };
}

async function installMock(page: Page, group: Json | null) {
  mock = { group, activations: [] };
  const current = mock;
  const json = (body: unknown) => ({ status: 200, json: body, headers: cors });
  await page.route(`${apiUrl}/api/plugins`, (route) =>
    route.fulfill(json(overviewOf(current))),
  );
  await page.route(`${apiUrl}/api/plugins/*/activation`, async (route) => {
    const body = route.request().postDataJSON() as Json;
    current.activations.push(body);
    current.group = { ...current.group, enabled: body.enabled };
    // Allowing the access is what turns the plugin on: nothing is pending.
    delete current.group.pendingAccess;
    await route.fulfill(json(overviewOf(current)));
  });
  await page.route(`${apiUrl}/api/project-data-shapes`, (route) =>
    route.fulfill(json({ plugins: [] })),
  );
  await page.route(`${apiUrl}/api/mcp/settings`, (route) =>
    route.fulfill(json({ enabled: true, clients: [] })),
  );
  await page.route(`${apiUrl}/api/mcp/bridge`, (route) =>
    route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/event-stream" },
      body: "retry: 200\n\n",
    }),
  );
  await page.route(`${apiUrl}/api/mcp/seen`, (route) =>
    route.fulfill(
      json({
        sessions: [],
        openQuestions: [],
        activity: [],
        errors: [],
        seenAt: Date.now(),
      }),
    ),
  );
  await page.route(`${apiUrl}/api/agents`, (route) =>
    route.fulfill(
      json({
        settings: {
          cli: "claude-code",
          browserMode: "ajour-chrome",
          model: "",
        },
        clis: [],
        tasks: [],
        currentRun: null,
      }),
    ),
  );
}

const accessSection = (page: Page) =>
  page.locator('section[aria-labelledby="plugin-access"]');
const accessList = (page: Page) =>
  page.locator('ul[aria-label="Access"] > li[data-access-item]');
const titleOf = (item: ReturnType<Page["locator"]>) =>
  item.locator(":scope > div > p").first();
const itemTitled = (page: Page, title: string) =>
  accessList(page).filter({
    has: page.locator(":scope > div > p").filter({ hasText: title }),
  });

// Setup.

Given(
  "the catalog offers a plugin on plugin API 4 to download",
  async ({ page }) => {
    const github = builtInEntries.find((entry) => entry.id === "github")!;
    const entries = [
      { ...github, compatibility: { pluginApiVersion: 4 } },
    ] as PluginCatalogEntry[];
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
    await installMock(page, null);
  },
);

Given("an installed Tracker plugin on plugin API 4", async ({ page }) => {
  await installMock(page, groupOf());
});

Given("an installed Tracker plugin on plugin API 3", async ({ page }) => {
  const { access: _access, ...legacy } = groupOf({}, tracker(3));
  await installMock(page, legacy);
});

Given(
  "an installed Tracker plugin on plugin API 4 that made a request 3 minutes ago",
  async ({ page }) => {
    await installMock(
      page,
      groupOf({
        accessActivity: { lastRequestAt: Date.now() - 3 * MINUTE - 5_000 },
      }),
    );
  },
);

Given(
  "the broker blocked it twice from connecting directly",
  async ({ page: _page }) => {
    mock.group!.accessActivity = {
      ...mock.group!.accessActivity,
      blockedCount: 2,
      lastBlockedAt: Date.now() - MINUTE,
    };
  },
);

Given(
  "a Tracker update 1.1.0 that reaches more and waits for consent",
  async ({ page }) => {
    await installMock(
      page,
      groupOf(
        {
          enabled: false,
          pendingAccess: {
            version: "1.1.0",
            difference: {
              ...NOTHING_NEW,
              derivedHosts: [PEOPLE_FORM],
              endpoints: [PEOPLE_ENDPOINT],
            },
          },
        },
        tracker(4, "1.1.0"),
      ),
    );
  },
);

Given(
  "a Tracker update 1.1.0 that adds an endpoint and waits for consent",
  async ({ page }) => {
    await installMock(
      page,
      groupOf(
        {
          enabled: false,
          pendingAccess: {
            version: "1.1.0",
            difference: {
              ...NOTHING_NEW,
              endpoints: [
                { host: "base", method: "GET", path: "/rest/people" },
              ],
            },
          },
          access: view({
            endpoints: [
              ...BASE_ENDPOINTS,
              { host: "base", method: "GET", path: "/rest/people" },
            ],
          }),
        },
        tracker(4, "1.1.0"),
      ),
    );
  },
);

// Opening pages.

When("I open the access catalog plugin page", async ({ page }) => {
  await page.goto("/settings/plugins/github");
});

When("I open the Tracker plugin page", async ({ page }) => {
  await page.goto("/settings/plugins/tracker");
});

// The Access section.

Then("the Access section comes before Features", async ({ page }) => {
  const access = page.getByRole("heading", { name: "Access", exact: true });
  const features = page.getByRole("heading", { name: "Features", exact: true });
  await expect(access).toBeVisible();
  const [accessBox, featuresBox] = [
    await access.boundingBox(),
    await features.boundingBox(),
  ];
  expect(accessBox!.y).toBeLessThan(featuresBox!.y);
});

Then(
  "the Access section says the addresses are listed once it is downloaded",
  async ({ page }) => {
    await expect(accessSection(page)).toContainText(
      "listed here once you download it",
    );
  },
);

Then(
  "the Access section says the plugin stays inactive until it is turned on",
  async ({ page }) => {
    await expect(accessSection(page)).toContainText(
      "After the download the plugin stays inactive. Turning it on allows the access listed on its page.",
    );
  },
);

Then("the Access section lists these lines", async ({ page }, table: Table) => {
  const expected = table
    .raw()
    .slice(1)
    .map(([line]) => line!);
  await expect(accessList(page)).toHaveCount(expected.length);
  const titles = await accessList(page)
    .locator(":scope > div > p:first-child")
    .allTextContents();
  expect(titles).toEqual(expected);
  await page.screenshot({ path: "test-results/access-section.png" });
});

Then("the Access section says {string}", async ({ page }, text: string) => {
  await expect(accessSection(page)).toContainText(text);
});

Then("the Access section warns {string}", async ({ page }, text: string) => {
  await expect(
    accessSection(page).locator("[data-access-blocked]"),
  ).toContainText(text);
});

Then("the Access section shows no blocked attempts", async ({ page }) => {
  await expect(accessSection(page)).toBeVisible();
  await expect(
    accessSection(page).locator("[data-access-blocked]"),
  ).toHaveCount(0);
});

// The endpoint disclosure.

const SITE_ADDRESS = 'The address in "Site URL"';

Then("the endpoints of the Site URL address are hidden", async ({ page }) => {
  const details = itemTitled(page, SITE_ADDRESS).locator("details");
  await expect(details.locator("summary")).toContainText("2 endpoints");
  expect(await details.evaluate((node: HTMLDetailsElement) => node.open)).toBe(
    false,
  );
});

When("I open the endpoints of the Site URL address", async ({ page }) => {
  await itemTitled(page, SITE_ADDRESS).locator("details > summary").click();
});

Then(
  "the endpoints of the Site URL address list",
  async ({ page }, table: Table) => {
    const rows = itemTitled(page, SITE_ADDRESS).locator("details li");
    const expected = table
      .raw()
      .slice(1)
      .map(([endpoint]) => endpoint!.split(" · "));
    await expect(rows).toHaveCount(expected.length);
    for (const [index, [endpoint, gate]] of expected.entries()) {
      await expect(rows.nth(index)).toContainText(endpoint!);
      if (gate) await expect(rows.nth(index)).toContainText(gate);
    }
  },
);

// The consent panel.

Then("the plugin page says {string}", async ({ page }, text: string) => {
  await expect(page.locator("[data-access-update]")).toContainText(text);
  await page.screenshot({ path: "test-results/access-update.png" });
});

Then("the plugin is inactive", async ({ page }) => {
  await expect(
    page.getByRole("switch", { name: "Activate Tracker", exact: true }),
  ).not.toBeChecked();
});

Then("the plugin is active", async ({ page }) => {
  await expect(
    page.getByRole("switch", { name: "Deactivate Tracker", exact: true }),
  ).toBeChecked();
});

Then(
  "the update panel lists only these new lines",
  async ({ page }, table: Table) => {
    const expected = table
      .raw()
      .slice(1)
      .map(([line]) => line!);
    const items = page.locator(
      '[data-access-update] ul[aria-label="New access"] > li',
    );
    await expect(items).toHaveCount(expected.length);
    const titles = await items
      .locator(":scope > div > p:first-child")
      .allTextContents();
    // Each carries a New chip.
    expect(titles).toHaveLength(expected.length);
    titles.forEach((title, index) => {
      expect(title).toContain(expected[index]!);
      expect(title).toContain("New");
    });
  },
);

Then(
  "the update panel shows the new endpoint {string}",
  async ({ page }, endpoint: string) => {
    const panel = page.locator("[data-access-update]");
    await panel.locator("details > summary").click();
    await expect(panel.locator("details li")).toHaveCount(1);
    await expect(panel.locator("details li")).toContainText(endpoint);
    await expect(panel.locator("details li")).toContainText("New");
  },
);

Then(
  "the Access section marks {string} as New",
  async ({ page }, title: string) => {
    await expect(itemTitled(page, title)).toContainText("New");
  },
);

Then(
  "the Access section does not mark {string} as New",
  async ({ page }, title: string) => {
    await expect(titleOf(itemTitled(page, title))).not.toContainText("New");
  },
);

Then("the activation request turned the plugin on", async () => {
  await expect.poll(() => mock.activations).toEqual([{ enabled: true }]);
});

Then(
  "the plugin page no longer says {string}",
  async ({ page }, text: string) => {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  },
);

Then(
  "the plugin page does not say {string}",
  async ({ page }, text: string) => {
    await expect(
      page.getByRole("heading", { name: "Access", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  },
);
