import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };
const TOKEN = "ajour_acceptance-token";

interface McpMockState {
  enabled: boolean;
  clients: { id: string; name: string; createdAt: number }[];
  /** Events the first bridge connection sends, such as tool calls. */
  bridgeEvents: { event: string; data: unknown }[];
  postedResults: unknown[];
  postedAnswers: { questionId: string; text: string }[];
}

/**
 * Stubs the local API's MCP routes. The bridge stream sends `bridgeEvents`
 * once, then nothing, so EventSource's reconnects don't replay tool calls.
 */
async function mockMcp(page: Page, initial: Partial<McpMockState> = {}) {
  const state: McpMockState = {
    enabled: true,
    clients: [],
    bridgeEvents: [],
    postedResults: [],
    postedAnswers: [],
    ...initial,
  };
  let bridgeOpened = false;

  await page.route(`${apiUrl}/api/connectors`, (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: false,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: cors,
    }),
  );
  await page.route(`${apiUrl}/api/mcp/settings`, (route) =>
    route.fulfill({
      json: { enabled: state.enabled, clients: state.clients },
      headers: cors,
    }),
  );
  await page.route(`${apiUrl}/api/mcp/clients`, async (route) => {
    const { name } = route.request().postDataJSON() as { name: string };
    const client = { id: "client-1", name, createdAt: Date.now() };
    state.clients.push(client);
    await route.fulfill({
      status: 201,
      json: { client, token: TOKEN },
      headers: cors,
    });
  });
  await page.route(`${apiUrl}/api/mcp/bridge`, (route) => {
    if (!state.enabled) {
      return route.fulfill({
        status: 404,
        json: { error: "MCP is off." },
        headers: cors,
      });
    }
    const events = bridgeOpened ? [] : state.bridgeEvents;
    bridgeOpened = true;
    return route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/event-stream" },
      body:
        "retry: 60000\n\n" +
        events
          .map(
            ({ event, data }) =>
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          )
          .join(""),
    });
  });
  await page.route(`${apiUrl}/api/mcp/bridge/results`, async (route) => {
    state.postedResults.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true }, headers: cors });
  });
  return state;
}

let mcp: McpMockState;

Given("MCP is on with no clients", async ({ page }) => {
  mcp = await mockMcp(page);
});

When("I open Settings MCP", async ({ page }) => {
  await page.goto("/settings/mcp");
});

When("I add the MCP client {string}", async ({ page }, name: string) => {
  await page.getByLabel("Client name").fill(name);
  await page.getByRole("button", { name: "Add client" }).click();
});

Then("I see its token and the command for Claude Code", async ({ page }) => {
  await expect(page.getByText(TOKEN).first()).toBeVisible();
  await expect(
    page.getByText(`claude mcp add --scope user --transport http ajour`, {
      exact: false,
    }),
  ).toBeVisible();
});

When("I reload the page", async ({ page }) => {
  await page.reload();
});

Then(
  "the client {string} is listed without its token",
  async ({ page }, name: string) => {
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText(TOKEN)).toHaveCount(0);
  },
);

export { mockMcp, mcp };
