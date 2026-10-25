import { expect, type Page, type Route } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const DAY = 86_400_000;
const ICON =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>";

// The plugin settings and the Vault, against a local API that answers from
// memory. Each scenario builds an overview, and the routes below change it
// the way the real API does: a removed secret leaves the connection, a
// retry reopens the vault, a removed plugin goes.

type Json = Record<string, unknown>;

interface SecretFieldMock {
  id: string;
  state: "saved" | "unreadable" | "rejected";
  setAt?: number;
  lastUsedAt?: number;
  expiresAt?: number;
}

interface ConnectionMock extends Json {
  id: string;
  label: string;
  secretFields?: SecretFieldMock[];
  sealedConfig?: Json;
  paused?: { reason: string; message: string };
}

interface GroupMock extends Json {
  plugin: Json & { id: string };
  connections: ConnectionMock[];
}

interface Mock {
  vault: Json;
  groups: GroupMock[];
  /** Bodies of the connection saves. */
  saves: Json[];
  /** Bodies of the secret removals, with the connection they hit. */
  removals: Array<{ connectionId: string; body: Json }>;
  /** Plugins whose data was removed. */
  dataRemovals: string[];
  /** Connections deleted. */
  deleted: string[];
  retries: number;
  /** What the vault is after a retry. */
  vaultAfterRetry: Json;
  /** Agent task settings saves. */
  agentSaves: Json[];
  agentSecrets: SecretFieldMock[];
}

let mock: Mock;

const now = () => Date.now();
const endOfDayIn = (days: number) => {
  const date = new Date();
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    23,
    59,
    59,
    999,
  ).getTime();
};

function field(id: string, label: string, extra: Json = {}) {
  return { id, label, type: "text", required: true, secret: false, ...extra };
}

const azurePlugin = {
  id: "azure-devops",
  displayName: "Azure DevOps",
  version: "1.0.0",
  apiVersion: 3,
  description: "Azure DevOps work items.",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [
    field("label", "Connection label"),
    field("organizationUrl", "Organization URL", { type: "url" }),
    field("token", "Personal access token", {
      type: "password",
      secret: true,
    }),
  ],
};

const calendarPlugin = {
  id: "ics-calendar",
  displayName: "Calendar (ICS)",
  version: "1.0.0",
  apiVersion: 3,
  description: "An ICS calendar.",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  capabilities: { calendar: {} },
  connectionFields: [
    field("label", "Connection label"),
    // A secret address is a url field, which used to render as text.
    field("calendarUrl", "Calendar address", { type: "url", secret: true }),
  ],
};

const workdayTasks = [
  {
    id: "enter-week",
    label: "Enter in Workday",
    placement: "commit-week",
    prompt: "prompts/enter-week.md",
    estimateMinutes: 10,
    settings: [
      field("timesheetUrl", "Workday timesheet URL", { type: "url" }),
      field("apiKey", "API key", { type: "password", secret: true }),
    ],
  },
];

const workdayPlugin = {
  id: "workday-agent",
  displayName: "Workday (agent)",
  version: "0.3.0",
  apiVersion: 3,
  description: "Workday agent tasks.",
  iconSvg: ICON,
  connectionFields: [],
  capabilities: { agentTask: { tasks: workdayTasks } },
};

const jiraPlugin = {
  id: "jira",
  displayName: "Jira",
  version: "0.0.0",
  apiVersion: 1,
  description: "Plugin unavailable.",
  iconSvg: ICON,
  unavailableReason:
    "This plugin is not installed. Download it again to use its saved connections.",
  connectionFields: [field("label", "Connection label")],
  capabilities: { connector: {} },
};

function connection(
  id: string,
  pluginId: string,
  label: string,
  extra: Partial<ConnectionMock> = {},
): ConnectionMock {
  return {
    id,
    pluginId,
    label,
    tenantLabel: `${label} organisation`,
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: {
      label,
      ...(pluginId === "azure-devops"
        ? { organizationUrl: "https://dev.azure.com/contoso" }
        : {}),
    },
    ...extra,
  };
}

const PAUSED_MESSAGES: Record<string, string> = {
  secret_rejected:
    "The service rejected this connection's saved token, so sync is paused. Replace the token to resume it.",
  secret_unreadable:
    "This connection's saved credentials can't be read on this computer. Enter them again to resume it.",
  secret_removed:
    "This connection's token was removed, so it is paused. Add a token to resume it.",
};

function pausedFor(reason: string) {
  return { reason, message: PAUSED_MESSAGES[reason] ?? reason };
}

/** The Azure DevOps connection of the scenario, with its token in the state given. */
function azureConnection(state: string) {
  const token = (extra: Partial<SecretFieldMock>): SecretFieldMock => ({
    id: "token",
    state: "saved",
    setAt: now() - 30 * DAY,
    lastUsedAt: now() - 2 * 3_600_000,
    ...extra,
  });
  switch (state) {
    case "saved":
      return connection("azure-1", "azure-devops", "Contoso", {
        secretFields: [token({})],
      });
    case "expiring in 5 days":
      return connection("azure-1", "azure-devops", "Contoso", {
        secretFields: [token({ expiresAt: endOfDayIn(5) })],
      });
    case "expired":
      return connection("azure-1", "azure-devops", "Contoso", {
        secretFields: [token({ expiresAt: now() - 2 * DAY })],
      });
    case "rejected":
      return connection("azure-1", "azure-devops", "Contoso", {
        secretFields: [token({ state: "rejected" })],
        paused: pausedFor("secret_rejected"),
        lastError: "Azure DevOps answered 401.",
      });
    case "unreadable":
      return connection("azure-1", "azure-devops", "Contoso", {
        secretFields: [token({ state: "unreadable" })],
        paused: pausedFor("secret_unreadable"),
      });
    case "not set":
      return connection("azure-1", "azure-devops", "Contoso", {
        paused: pausedFor("secret_removed"),
      });
    default:
      throw new Error(`Unknown token state: ${state}`);
  }
}

function overviewOf(current: Mock) {
  const plugins = current.groups.map((group) => group.plugin);
  return {
    vault: current.vault,
    pluginsEnabled: true,
    plugins,
    connectionGroups: current.groups.map((group) => ({
      enabled: group.plugin.id !== "jira",
      ...group,
    })),
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

function agentOverview(current: Mock) {
  return {
    settings: { cli: "claude-code", browserMode: "ajour-chrome", model: "" },
    clis: [
      {
        id: "claude-code",
        label: "Claude Code",
        supported: true,
        installed: true,
        version: "2.1.0",
      },
    ],
    tasks: [
      {
        pluginId: "workday-agent",
        pluginName: "Workday (agent)",
        taskId: "enter-week",
        label: "Enter in Workday",
        placement: "commit-week",
        estimateMinutes: 10,
        settings: workdayTasks[0]!.settings,
        values: { timesheetUrl: "https://wd.example/t" },
        ...(current.agentSecrets.length > 0
          ? { secretFields: current.agentSecrets }
          : {}),
        blockers: [],
      },
    ],
    currentRun: null,
  };
}

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, json, headers: cors });
}

function connectionIn(current: Mock, connectionId: string) {
  for (const group of current.groups) {
    const found = group.connections.find((item) => item.id === connectionId);
    if (found) return { group, connection: found };
  }
  return undefined;
}

/** Stubs the local API the plugin pages and the Vault call. */
async function installMock(page: Page, initial: Partial<Mock>) {
  mock = {
    vault: { state: "available" },
    groups: [],
    saves: [],
    removals: [],
    dataRemovals: [],
    deleted: [],
    retries: 0,
    vaultAfterRetry: { state: "available" },
    agentSaves: [],
    agentSecrets: [],
    ...initial,
  };
  const current = mock;
  await page.route(`${apiUrl}/api/plugins`, (route) =>
    fulfill(route, overviewOf(current)),
  );
  await page.route(`${apiUrl}/api/project-data-shapes`, (route) =>
    fulfill(route, { plugins: [] }),
  );
  await page.route(`${apiUrl}/api/mcp/settings`, (route) =>
    fulfill(route, { enabled: true, clients: [] }),
  );
  await page.route(`${apiUrl}/api/mcp/bridge`, (route) =>
    route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/event-stream" },
      body: "retry: 200\n\n",
    }),
  );
  await page.route(`${apiUrl}/api/mcp/seen`, (route) =>
    fulfill(route, {
      sessions: [],
      openQuestions: [],
      activity: [],
      errors: [],
      seenAt: Date.now(),
    }),
  );
  await page.route(`${apiUrl}/api/agents`, (route) =>
    fulfill(route, agentOverview(current)),
  );
  await page.route(`${apiUrl}/api/plugins/*/connections`, async (route) => {
    const body = route.request().postDataJSON() as Json;
    current.saves.push(body);
    const id = String(body.id ?? "new-connection");
    const found = connectionIn(current, id);
    await fulfill(route, {
      overview: overviewOf(current),
      connection: found?.connection ?? connection(id, "azure-devops", "New"),
    });
  });
  await page.route(
    `${apiUrl}/api/plugins/*/connections/*/secrets/remove`,
    async (route) => {
      const body = route.request().postDataJSON() as { fieldIds: string[] };
      const id = route
        .request()
        .url()
        .split("/connections/")[1]!
        .split("/")[0]!;
      current.removals.push({ connectionId: id, body });
      const found = connectionIn(current, id)!;
      found.connection.secretFields = (
        found.connection.secretFields ?? []
      ).filter((secret) => !body.fieldIds.includes(secret.id));
      found.connection.paused = pausedFor("secret_removed");
      await fulfill(route, {
        overview: overviewOf(current),
        connection: found.connection,
      });
    },
  );
  await page.route(`${apiUrl}/api/plugins/*/connections/*`, async (route) => {
    const id = decodeURIComponent(route.request().url().split("/").pop()!);
    current.deleted.push(id);
    for (const group of current.groups) {
      group.connections = group.connections.filter((item) => item.id !== id);
    }
    await fulfill(route, overviewOf(current));
  });
  await page.route(`${apiUrl}/api/plugins/*/data`, async (route) => {
    const pluginId = route
      .request()
      .url()
      .split("/api/plugins/")[1]!
      .split("/")[0]!;
    current.dataRemovals.push(pluginId);
    current.groups = current.groups.filter(
      (group) => group.plugin.id !== pluginId,
    );
    await fulfill(route, overviewOf(current));
  });
  await page.route(`${apiUrl}/api/vault/retry`, async (route) => {
    current.retries += 1;
    current.vault = current.vaultAfterRetry;
    await fulfill(route, overviewOf(current));
  });
  await page.route(
    `${apiUrl}/api/agents/plugins/workday-agent/settings`,
    async (route) => {
      const body = route.request().postDataJSON() as {
        removeSecrets?: string[];
      };
      current.agentSaves.push(body);
      current.agentSecrets = current.agentSecrets.filter(
        (secret) => !body.removeSecrets?.includes(secret.id),
      );
      await fulfill(route, agentOverview(current));
    },
  );
}

const azureGroup = (...connections: ConnectionMock[]): GroupMock => ({
  plugin: azurePlugin,
  connections,
});

function pluginPath(page: Page, pluginId: string) {
  return page.goto(`/settings/plugins/${pluginId}`);
}

// Connection forms.

Given(
  "an Azure DevOps connection whose token is {}",
  async ({ page }, state: string) => {
    await installMock(page, { groups: [azureGroup(azureConnection(state))] });
  },
);

Given("a calendar connection with a saved secret address", async ({ page }) => {
  await installMock(page, {
    groups: [
      {
        plugin: calendarPlugin,
        connections: [
          connection("ics-1", "ics-calendar", "Work calendar", {
            secretFields: [
              {
                id: "calendarUrl",
                state: "saved",
                setAt: now() - DAY,
                lastUsedAt: now() - 12 * 60_000,
              },
            ],
          }),
        ],
      },
    ],
  });
});

When("I open the Azure DevOps plugin page", async ({ page }) => {
  await pluginPath(page, "azure-devops");
});

When("I edit the Azure DevOps connection", async ({ page }) => {
  await pluginPath(page, "azure-devops");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
});

When("I edit the calendar connection", async ({ page }) => {
  await pluginPath(page, "ics-calendar");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
});

Then(
  "the token shows the {word} chip saying {string}",
  async ({ page }, kind: string, text: string) => {
    const chip = page.locator(`[data-secret-state="${kind}"]`);
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText(text);
    await page.screenshot({ path: `test-results/secret-field-${kind}.png` });
  },
);

Then("the token field shows no value", async ({ page }) => {
  // A saved token has no input at all. A field with none has an empty one.
  // No mask stands in for a value.
  const input = page.locator("#secret-token");
  if ((await input.count()) > 0) await expect(input).toHaveValue("");
  await expect(page.locator('input[value*="•"]')).toHaveCount(0);
  await expect(page.getByText("••••", { exact: false })).toHaveCount(0);
});

Then(
  "the secret address shows as saved and is not an input",
  async ({ page }) => {
    await expect(page.locator('[data-secret-state="saved"]')).toBeVisible();
    await expect(page.locator("#secret-calendarUrl")).toHaveCount(0);
    for (const type of ["text", "url"]) {
      await expect(
        page.locator(`input[type="${type}"]`).filter({
          has: page.locator("xpath=self::*[@id='secret-calendarUrl']"),
        }),
      ).toHaveCount(0);
    }
  },
);

When("I replace the secret address", async ({ page }) => {
  await page
    .getByRole("button", { name: "Replace Calendar address", exact: true })
    .click();
});

Then("the replacement is an empty password input", async ({ page }) => {
  const input = page.locator("#secret-calendarUrl");
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveValue("");
});

When("I press Replace on the token", async ({ page }) => {
  await page
    .getByRole("button", { name: "Replace Personal access token" })
    .click();
});

Then(
  "the token has an empty password input and a Cancel button",
  async ({ page }) => {
    const input = page.locator("#secret-token");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }).first(),
    ).toBeVisible();
  },
);

When("I press Cancel on the token", async ({ page }) => {
  // The form's own Cancel comes after the field's.
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
});

When("I paste the new token {string}", async ({ page }, token: string) => {
  await page.locator("#secret-token").fill(token);
});

When("I rename the connection to {string}", async ({ page }, label: string) => {
  await page.getByLabel("Connection label", { exact: true }).fill(label);
});

When("I update the connection", async ({ page }) => {
  await page
    .getByRole("button", { name: "Update connection", exact: true })
    .click();
  await expect.poll(() => mock.saves.length).toBe(1);
});

Then(
  "the connection was saved with the new token {string}",
  async ({}, token: string) => {
    expect(mock.saves[0]).toMatchObject({
      id: "azure-1",
      values: { token },
    });
  },
);

Then("the connection was saved without a token", async ({}) => {
  const saved = mock.saves[0] as { values: Record<string, unknown> };
  expect(saved.values.label).toBe("Contoso EU");
  // An empty value keeps the saved secret, and no mask is sent for it.
  expect(saved.values.token).toBe("");
  expect(JSON.stringify(saved)).not.toContain("•");
});

When("I press Remove on the token and confirm", async ({ page }) => {
  await page
    .getByRole("button", { name: "Remove Personal access token" })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove Personal access token" })
    .click();
});

Then(
  "the API was asked to remove the {string} secret",
  async ({ page }, fieldId: string) => {
    await expect.poll(() => mock.removals.length).toBe(1);
    expect(mock.removals[0]).toEqual({
      connectionId: "azure-1",
      body: { fieldIds: [fieldId] },
    });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  },
);

Then(
  "the connection row says {string} and {string}",
  async ({ page }, chip: string, note: string) => {
    await expect(
      page.locator(`[data-connection-status="${chip}"]`),
    ).toBeVisible();
    await expect(page.getByText(note, { exact: true })).toBeVisible();
  },
);

Then("the connection row has no Error chip", async ({ page }) => {
  await expect(page.locator('[data-connection-status="Error"]')).toHaveCount(0);
  await expect(page.getByText("Azure DevOps answered 401.")).toHaveCount(0);
});

When(
  "I set the token's expiry date to {string}",
  async ({ page }, date: string) => {
    await page
      .getByLabel("Personal access token expires on (optional)", {
        exact: true,
      })
      .fill(date);
  },
);

Then(
  "the connection was saved with the reminder date {string}",
  async ({}, date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    const saved = mock.saves[0] as { secretExpiry: Record<string, number> };
    expect(saved.secretExpiry.token).toBe(
      new Date(year!, month! - 1, day!, 23, 59, 59, 999).getTime(),
    );
  },
);

Then(
  "the token's expiry field says it is a reminder only",
  async ({ page }) => {
    await expect(
      page.getByText("A reminder only. Ajour keeps using it after this date."),
    ).toBeVisible();
  },
);

// The Vault.

function vaultGroups(): GroupMock[] {
  const secret = (extra: Partial<SecretFieldMock> = {}): SecretFieldMock => ({
    id: "token",
    state: "saved",
    setAt: now() - 30 * DAY,
    lastUsedAt: now() - 2 * 3_600_000,
    ...extra,
  });
  return [
    {
      plugin: jiraPlugin,
      missing: true,
      connections: [
        connection("jira-1", "jira", "Acme", {
          sealedConfig: {
            state: "saved",
            setAt: now() - 90 * DAY,
            lastUsedAt: now() - 60 * DAY,
          },
        }),
      ],
    },
    {
      plugin: workdayPlugin,
      connections: [],
      agentTaskSecretFields: [
        {
          id: "apiKey",
          state: "unreadable",
          setAt: now() - 5 * DAY,
        },
      ],
    },
    {
      plugin: calendarPlugin,
      connections: [
        connection("ics-1", "ics-calendar", "Work calendar", {
          secretFields: [
            secret({ id: "calendarUrl", lastUsedAt: now() - 12 * 60_000 }),
          ],
        }),
      ],
    },
    {
      plugin: azurePlugin,
      connections: [
        connection("azure-1", "azure-devops", "Contoso", {
          secretFields: [secret({ expiresAt: endOfDayIn(5) })],
        }),
        connection("azure-2", "azure-devops", "Fabrikam", {
          secretFields: [
            secret({ state: "rejected", lastUsedAt: now() - DAY }),
          ],
          paused: pausedFor("secret_rejected"),
        }),
      ],
    },
  ];
}

Given("a Vault with secrets of several plugins", async ({ page }) => {
  await installMock(page, { groups: vaultGroups() });
});

Given(
  "a Vault whose encryption is unavailable because {string}",
  async ({ page }, reason: string) => {
    await installMock(page, {
      vault: { state: "unavailable", reason },
      groups: [azureGroup(azureConnection("saved"))],
    });
  },
);

Given("a Vault whose saved secrets can't be read", async ({ page }) => {
  await installMock(page, {
    vault: { state: "unreadable" },
    groups: [azureGroup(azureConnection("unreadable"))],
  });
});

When(
  "I open the Vault at {int} pixels wide",
  async ({ page }, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings/vault");
    await expect(
      page.getByRole("heading", { name: "Vault", level: 1 }),
    ).toBeVisible();
  },
);

Then(
  "the Vault groups are {string}, {string}, {string}, {string} in that order",
  async (
    { page },
    first: string,
    second: string,
    third: string,
    last: string,
  ) => {
    await expect(vaultHeadings(page)).toHaveText([first, second, third, last]);
  },
);

/** The plugin groups of the Vault page, not the app's own headings. */
function vaultHeadings(page: Page) {
  return page.locator(".settings-content").getByRole("heading", { level: 2 });
}

function vaultRow(page: Page, owner: string) {
  return page.getByRole("group", { name: new RegExp(`^${owner},`) });
}

Then(
  "the Vault shows {string} with {string}, {string} and {string}",
  async ({ page }, owner: string, a: string, b: string, c: string) => {
    const row = vaultRow(page, owner);
    for (const text of [a, b, c]) await expect(row).toContainText(text);
  },
);

Then(
  "the Vault shows {string} with {string} and {string}",
  async ({ page }, owner: string, a: string, b: string) => {
    const row = vaultRow(page, owner);
    for (const text of [a, b]) await expect(row).toContainText(text);
  },
);

Then(
  "the Vault shows {string} with {string}",
  async ({ page }, owner: string, text: string) => {
    await expect(vaultRow(page, owner)).toContainText(text);
  },
);

Then("nothing in the Vault overflows the viewport", async ({ page }) => {
  const width = page.viewportSize()!.width;
  for (const row of await page.getByRole("group").all()) {
    const box = await row.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: `test-results/vault-${width}.png`,
  });
});

When("I press Replace for Contoso in the Vault", async ({ page }) => {
  await vaultRow(page, "Contoso")
    .getByRole("link", { name: /^Replace/ })
    .click();
});

Then(
  "the Azure DevOps plugin page opens the token's replacement input",
  async ({ page }) => {
    await expect(page).toHaveURL(/\/settings\/plugins\/azure-devops\?/);
    const input = page.locator("#secret-token");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveValue("");
    await expect(page.getByText("Edit Azure DevOps connection")).toBeVisible();
  },
);

When(
  "I remove {string} from the Vault and confirm",
  async ({ page }, title: string) => {
    await page.getByRole("button", { name: `Remove ${title}` }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove connections and secrets" })
      .click();
  },
);

Then("the Vault no longer lists {string}", async ({ page }, title: string) => {
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  await expect(vaultHeadings(page)).toHaveText([
    "Azure DevOps",
    "Calendar (ICS)",
    "Workday (agent)",
  ]);
});

Then(
  "the API was asked to remove the data of {string}",
  async ({}, pluginId: string) => {
    await expect.poll(() => mock.dataRemovals).toEqual([pluginId]);
    expect(mock.deleted).toEqual(["jira-1"]);
  },
);

Then(
  "the Vault says {string} with {string}",
  async ({ page }, title: string, detail: string) => {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText(detail, { exact: false })).toBeVisible();
  },
);

When(
  "the computer can encrypt again and I press Try again",
  async ({ page }) => {
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect.poll(() => mock.retries).toBe(1);
  },
);

Then("the Vault has no notice", async ({ page }) => {
  await expect(
    page.getByText("Ajour can't protect credentials on this computer"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

Then("the Vault offers no Try again", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

// Agent task settings.

Given("the Workday agent has a saved secret API key", async ({ page }) => {
  await installMock(page, {
    groups: [{ plugin: workdayPlugin, connections: [] }],
    agentSecrets: [{ id: "apiKey", state: "saved", setAt: now() - DAY }],
  });
});

When("I open the Workday agent plugin page", async ({ page }) => {
  await pluginPath(page, "workday-agent");
});

Then(
  "the API key shows the saved chip saying {string}",
  async ({ page }, text: string) => {
    await expect(page.locator('[data-secret-state="saved"]')).toContainText(
      text,
    );
    await expect(page.locator("#secret-apiKey")).toHaveCount(0);
  },
);

When(
  "I press Remove on the {string} and confirm",
  async ({ page }, label: string) => {
    await page.getByRole("button", { name: `Remove ${label}` }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: `Remove ${label}` })
      .click();
  },
);

Then(
  "the API was asked to remove the agent task {string} secret",
  async ({ page }, fieldId: string) => {
    await expect.poll(() => mock.agentSaves.length).toBe(1);
    expect(mock.agentSaves[0]).toMatchObject({ removeSecrets: [fieldId] });
    await expect(page.locator('[data-secret-state="not_set"]')).toBeVisible();
  },
);
