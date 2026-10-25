import { expect, type Page, type Route } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const ICON =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>";

// Connection access and held edits (#395), against a local API that answers
// from memory: it saves the access a form sends and records every write
// that reaches it, so a scenario can say what went to Azure DevOps.

type Json = Record<string, unknown>;

interface AccessMock {
  /** The access choices turned on, those always on left out. */
  access: string[];
  saves: Json[];
  /** The writes that reached the source. */
  writes: { route: string; body: Json }[];
}

let mock: AccessMock;

const CHOICES = [
  {
    id: "readBacklog",
    label: "Read the backlog",
    description: "Work items, queries, comments and descriptions.",
    tokenScope: "Work Items (Read)",
    always: true,
    operations: [],
  },
  {
    id: "editWorkItems",
    label: "Edit work items",
    description:
      "Send estimates, settled and moved work, descriptions and comments.",
    tokenScope: "Work Items (Read & write)",
    always: false,
    operations: [
      "writeSettle",
      "writeDescription",
      "postItemComment",
      "editItemComment",
      "deleteItemComment",
      "setItemCommentReaction",
      "pushEstimates",
    ],
  },
  {
    id: "pullRequests",
    label: "Pull requests",
    description: "Read the pull requests you're involved in.",
    tokenScope: "Code (Read)",
    always: false,
    operations: ["syncPullRequests"],
  },
  {
    id: "peopleSearch",
    label: "Search people across the organisation",
    description: "Suggest anyone in the organisation for @mentions.",
    tokenScope: "Identity (Read)",
    always: false,
    operations: ["searchItemPeople"],
  },
];

const plugin = {
  id: "azure_devops",
  displayName: "Azure DevOps",
  version: "1.1.0",
  apiVersion: 3,
  description: "Azure DevOps work items.",
  iconSvg: ICON,
  entrypoint: "plugin.mjs",
  capabilities: {
    connector: { settle: true, comments: { mentions: true } },
  },
  connectionFields: [
    {
      id: "label",
      label: "Connection label",
      type: "text",
      required: true,
    },
    {
      id: "organizationUrl",
      label: "Organization URL",
      type: "url",
      required: true,
    },
  ],
};

function connection(current: AccessMock) {
  return {
    id: "contoso",
    pluginId: "azure_devops",
    label: "Contoso",
    tenantLabel: "Contoso organisation",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: {
      label: "Contoso",
      organizationUrl: "https://dev.azure.com/contoso",
    },
    access: ["readBacklog", ...current.access],
  };
}

function overviewOf(current: AccessMock) {
  return {
    vault: { state: "available" },
    pluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        connectionAccess: CHOICES,
        connections: [connection(current)],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  };
}

async function fulfill(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, json, headers: cors });
}

const refusal = {
  error:
    'The "Contoso" connection\'s access doesn\'t include "Edit work items". Turn it on in the connection\'s settings.',
  reason: "access_off",
  access: "editWorkItems",
};

async function installAccessMock(page: Page) {
  mock = { access: [], saves: [], writes: [] };
  const current = mock;
  await page.route(`${apiUrl}/api/plugins`, (route) =>
    fulfill(route, overviewOf(current)),
  );
  await page.route(`${apiUrl}/api/backlog/imports`, (route) =>
    fulfill(route, { items: [], totalCount: 0, selectedCount: 0 }),
  );
  await page.route(`${apiUrl}/api/plugins/*/connections`, async (route) => {
    const body = route.request().postDataJSON() as Json;
    current.saves.push(body);
    if (Array.isArray(body.access)) {
      current.access = (body.access as string[]).filter(
        (id) => id !== "readBacklog",
      );
    }
    await fulfill(route, {
      overview: overviewOf(current),
      connection: connection(current),
    });
  });
  // Writes, refused as the local API refuses them while editing is off.
  await page.route(
    `${apiUrl}/api/plugins/azure_devops/connections/contoso/settle`,
    async (route) => {
      if (!current.access.includes("editWorkItems")) {
        await fulfill(route, refusal, 403);
        return;
      }
      const body = route.request().postDataJSON() as Json;
      current.writes.push({ route: "settle", body });
      await fulfill(route, { state: body.state });
    },
  );
  await page.route(
    `${apiUrl}/api/backlog-comments/azure_devops/connections/contoso/*`,
    async (route) => {
      if (!current.access.includes("editWorkItems")) {
        await fulfill(route, refusal, 403);
        return;
      }
      const body = route.request().postDataJSON() as Json;
      current.writes.push({ route: "comment", body });
      await fulfill(route, {
        comment: {
          id: "c1",
          author: { id: "me", displayName: "Me" },
          body: body.body,
          createdAt: "2026-10-25T10:00:00Z",
        },
      });
    },
  );
}

/** A synced item settled while editing was off, and a comment refused then. */
async function seedHeldChanges(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("held-edits-fixture")) return;
    localStorage.clear();
    sessionStorage.setItem("held-edits-fixture", "true");
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        workItems: [
          {
            _id: "synced",
            title: "Ship the access group",
            source: "azure_devops",
            sourceId: "42",
            sourceConnectionId: "contoso",
            sourceConnectionLabel: "Contoso",
            sourceStatusLabel: "Waiting",
            status: "settled",
            settledAt: 1,
            createdAt: 1,
            pendingSourceWrite: {
              state: "Waiting",
              heldAt: 2,
              previous: { sourceStatusLabel: "Active" },
            },
          },
        ],
      }),
    );
    localStorage.setItem(
      "ajour.held-comments",
      JSON.stringify([
        {
          kind: "comment",
          id: "held-1",
          itemId: "synced",
          pluginId: "azure_devops",
          connectionId: "contoso",
          sourceId: "42",
          body: "Waiting on the client",
          at: 3,
        },
      ]),
    );
  });
}

Given(
  "an Azure DevOps connection that reads only and holds no changes",
  async ({ page }) => {
    await installAccessMock(page);
    await page.addInitScript(() => {
      if (sessionStorage.getItem("access-fixture")) return;
      localStorage.clear();
      sessionStorage.setItem("access-fixture", "true");
    });
  },
);

Given(
  "an Azure DevOps connection that reads only and holds a settle and a comment",
  async ({ page }) => {
    await installAccessMock(page);
    await seedHeldChanges(page);
  },
);

When(
  "I open the Azure DevOps plugin page with its access",
  async ({ page }) => {
    await page.goto("/settings/plugins/azure_devops");
  },
);

When("I edit the connection with its access", async ({ page }) => {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("group", { name: "Access" })).toBeVisible();
});

Then(
  "the connection row has the badge {string}",
  async ({ page }, badge: string) => {
    await expect(page.getByText(badge, { exact: true })).toBeVisible();
  },
);

Then(
  "the Access group lists each choice with the token scope it needs",
  async ({ page }) => {
    const group = page.getByRole("group", { name: "Access" });
    await expect(
      group.getByText(
        "Ajour blocks anything not chosen here, even when the token allows more.",
      ),
    ).toBeVisible();
    for (const choice of CHOICES) {
      await expect(
        group.getByRole("checkbox", { name: choice.label }),
      ).toBeVisible();
      await expect(
        group.getByText(`The token needs ${choice.tokenScope}.`, {
          exact: false,
        }),
      ).toBeVisible();
    }
    await expect(
      group.getByRole("checkbox", { name: "Edit work items" }),
    ).not.toBeChecked();
  },
);

Then(
  "{string} is on and can't be turned off",
  async ({ page }, label: string) => {
    const checkbox = page
      .getByRole("group", { name: "Access" })
      .getByRole("checkbox", { name: label });
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeDisabled();
  },
);

When(
  "I turn on {string} and update the connection",
  async ({ page }, label: string) => {
    await page
      .getByRole("group", { name: "Access" })
      .getByRole("checkbox", { name: label })
      .click();
    await page.getByRole("button", { name: "Update connection" }).click();
  },
);

Then("the connection was saved with editing work items on", async () => {
  await expect.poll(() => mock.saves.length).toBe(1);
  expect(mock.saves[0]).toMatchObject({
    id: "contoso",
    access: ["editWorkItems"],
  });
});

Then("the connection row says {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then(
  "the Access group says {int} changes made while editing was off are held",
  async ({ page }, count: number) => {
    await expect(
      page
        .getByRole("group", { name: "Access" })
        .getByText(
          `${count} changes made while editing was off are held on this computer.`,
          { exact: false },
        ),
    ).toBeVisible();
  },
);

Then("nothing was sent to Azure DevOps", async () => {
  expect(mock.writes).toEqual([]);
});

Then(
  "Sync review shows {int} held changes for {string}",
  async ({ page }, count: number, label: string) => {
    await expect(page).toHaveURL(/\/settings\/sync-review\?held=contoso/);
    const panel = page.getByRole("region", { name: "Held changes" });
    await expect(panel.getByText(`${count} changes held`)).toBeVisible();
    await expect(
      panel.getByRole("region", { name: `Held changes of ${label}` }),
    ).toBeVisible();
  },
);

When("I send the held {string}", async ({ page }, kind: string) => {
  await page
    .locator("[data-held-edit]")
    .filter({ hasText: kind })
    .getByRole("button", { name: "Send" })
    .click();
});

Then("the settle went to Azure DevOps", async () => {
  await expect.poll(() => mock.writes.length).toBe(1);
  expect(mock.writes[0]).toEqual({
    route: "settle",
    body: { sourceId: "42", state: "Waiting" },
  });
});

When(
  "I discard the held {string} and confirm",
  async ({ page }, kind: string) => {
    await page
      .locator("[data-held-edit]")
      .filter({ hasText: kind })
      .getByRole("button", { name: "Discard" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Discard" })
      .click();
  },
);

Then("Sync review shows no held changes", async ({ page }) => {
  await expect(page.getByRole("region", { name: "Held changes" })).toHaveCount(
    0,
  );
});

Then("no comment was posted to Azure DevOps", async () => {
  expect(mock.writes.filter((write) => write.route === "comment")).toEqual([]);
});
