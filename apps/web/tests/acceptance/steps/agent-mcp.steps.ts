import { expect, type Page } from "@playwright/test";
import { viewSwitcher } from "../../fixtures/sidebar";
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
  postedDismissals: string[];
}

/** What the API answers once the user has answered or seen everything. */
const emptySnapshot = () => ({
  sessions: [],
  openQuestions: [],
  activity: [],
  errors: [],
  seenAt: Date.now(),
});

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
    postedDismissals: [],
    ...initial,
  };
  let bridgeOpened = false;

  await page.route(`${apiUrl}/api/plugins`, (route) =>
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
  // Opening the panel keeps open questions open. Answering closes them.
  await page.route(`${apiUrl}/api/mcp/questions/*/answer`, async (route) => {
    const questionId = route.request().url().split("/").at(-2)!;
    const { text } = route.request().postDataJSON() as { text: string };
    state.postedAnswers.push({ questionId, text });
    await route.fulfill({ json: emptySnapshot(), headers: cors });
  });
  await page.route(`${apiUrl}/api/mcp/sessions/*/dismiss`, async (route) => {
    state.postedDismissals.push(route.request().url().split("/").at(-2)!);
    // The API answers with the session ended as cancelled.
    const snapshot = state.bridgeEvents.find(({ event }) => event === "agents")
      ?.data as { sessions: { state: string }[] } | undefined;
    await route.fulfill({
      json: snapshot
        ? {
            ...snapshot,
            sessions: snapshot.sessions.map((session) => ({
              ...session,
              state: "cancelled",
            })),
          }
        : emptySnapshot(),
      headers: cors,
    });
  });
  await page.route(`${apiUrl}/api/mcp/seen`, (route) =>
    route.fulfill({
      json:
        state.bridgeEvents.find(({ event }) => event === "agents")?.data ??
        emptySnapshot(),
      headers: cors,
    }),
  );
  return state;
}

let mcp: McpMockState;

Given("MCP is on with no clients", async ({ page }) => {
  mcp = await mockMcp(page);
});

When("I open Settings MCP", async ({ page }) => {
  await page.goto("/settings/mcp");
});

When("I add the agent client {string}", async ({ page }, name: string) => {
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

Given(
  "MCP is on and {string} starts an entry on {string} {string}",
  async (
    { page },
    clientName: string,
    projectName: string,
    taskName: string,
  ) => {
    await page.addInitScript(
      ({ projectName, taskName }) => {
        if (sessionStorage.getItem("agent-fixture")) return;
        localStorage.clear();
        sessionStorage.setItem("agent-fixture", "true");
        localStorage.setItem(
          "ajour.local-state.v2",
          JSON.stringify({
            projects: [
              {
                _id: "p-acme",
                name: projectName,
                color: "#4f46e5",
                status: "active",
                tasks: [
                  {
                    _id: "t-build",
                    name: taskName,
                    status: "active",
                    createdAt: 1,
                  },
                ],
              },
            ],
          }),
        );
      },
      { projectName, taskName },
    );
    mcp = await mockMcp(page, {
      bridgeEvents: [
        {
          event: "tool-call",
          data: {
            requestId: "call-1",
            tool: "start_timer",
            input: {
              projectId: "p-acme",
              taskId: "t-build",
              note: "From the agent",
            },
            client: { id: "client-1", name: clientName },
          },
        },
      ],
    });
  },
);

When("I open the app", async ({ page }) => {
  await page.goto("/");
});

Then(
  "an entry is running on {string} {string}",
  async ({ page }, projectName: string, taskName: string) => {
    // The timer dock shows the entry the agent started.
    const dock = page.getByRole("button", {
      name: "Edit the running entry",
      exact: true,
    });
    await expect(dock).toBeVisible();
    await expect(dock).toContainText(projectName);
    await expect(dock).toContainText(taskName);
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
  },
);

Then("a toast reads {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text)).toBeVisible();
});

Then("the bridge received a successful result", async () => {
  expect(mcp.postedResults[0]).toMatchObject({ requestId: "call-1", ok: true });
});

Given("MCP is off", async ({ page }) => {
  mcp = await mockMcp(page, { enabled: false });
});

Given(
  "MCP is on and {string} asks {string} with choices {string} and {string}",
  async (
    { page },
    clientName: string,
    text: string,
    first: string,
    second: string,
  ) => {
    const client = { id: "client-1", name: clientName };
    mcp = await mockMcp(page, {
      bridgeEvents: [
        {
          event: "agents",
          data: {
            sessions: [],
            openQuestions: [
              {
                status: "open",
                id: "question-1",
                client,
                text,
                choices: [first, second],
                askedAt: Date.now(),
              },
            ],
            activity: [],
            errors: [],
            seenAt: 0,
          },
        },
      ],
    });
  },
);

Then("the agent indicator is absent", async ({ page }) => {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /^Agents:/ })).toHaveCount(0);
});

Then("the agent indicator reads {string}", async ({ page }, label: string) => {
  await expect(
    page.getByRole("button", { name: `Agents: ${label}` }),
  ).toBeVisible();
});

When("I open the agent panel", async ({ page }) => {
  await page.getByRole("button", { name: /^Agents:/ }).click();
});

When(
  "I open the agent panel and choose {string}",
  async ({ page }, choice: string) => {
    await page.getByRole("button", { name: /^Agents:/ }).click();
    await page.getByRole("button", { name: choice, exact: true }).click();
  },
);

Given(
  "MCP is on and {string} runs {string} asking {string} and {string} saying {string}",
  async (
    { page },
    clientName: string,
    askingTitle: string,
    text: string,
    quietTitle: string,
    update: string,
  ) => {
    const client = { id: "client-1", name: clientName };
    const now = Date.now();
    const MINUTE = 60_000;
    mcp = await mockMcp(page, {
      bridgeEvents: [
        {
          event: "agents",
          data: {
            sessions: [
              {
                id: "session-1",
                client,
                title: askingTitle,
                state: "active",
                startedAt: now - 10 * MINUTE,
                deadlineAt: now + 90 * MINUTE,
                messages: [
                  {
                    kind: "update",
                    at: now - 9 * MINUTE,
                    text: "Reading the week",
                  },
                  {
                    kind: "question",
                    at: now - MINUTE,
                    questionId: "question-1",
                    text,
                    choices: ["Acme", "Globex"],
                  },
                ],
              },
              {
                id: "session-2",
                client,
                title: quietTitle,
                state: "active",
                startedAt: now - MINUTE,
                deadlineAt: now + 10 * MINUTE,
                messages: [{ kind: "update", at: now - 30_000, text: update }],
              },
            ],
            openQuestions: [
              {
                status: "open",
                id: "question-1",
                sessionId: "session-1",
                client,
                text,
                choices: ["Acme", "Globex"],
                askedAt: now - MINUTE,
              },
            ],
            activity: [],
            errors: [],
            seenAt: 0,
          },
        },
      ],
    });
  },
);

Given(
  "MCP is on and {string} has a stalled session {string}",
  async ({ page }, clientName: string, title: string) => {
    const now = Date.now();
    mcp = await mockMcp(page, {
      bridgeEvents: [
        {
          event: "agents",
          data: {
            sessions: [
              {
                id: "session-1",
                client: { id: "client-1", name: clientName },
                title,
                state: "stalled",
                startedAt: now - 30 * 60_000,
                deadlineAt: now - 5 * 60_000,
                messages: [
                  {
                    kind: "update",
                    at: now - 20 * 60_000,
                    text: "Reading the week",
                  },
                ],
              },
            ],
            openQuestions: [],
            activity: [],
            errors: [],
            seenAt: 0,
          },
        },
      ],
    });
  },
);

When("I open Settings MCP on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/mcp");
});

// The agent panel's row around the page must not push it past the window.
Then("the page content ends within the window", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "MCP", exact: true }).first(),
  ).toBeVisible();
  const main = await page.locator("main.app-content-shell").boundingBox();
  const viewport = page.viewportSize()!;
  expect(main!.y + main!.height).toBeLessThanOrEqual(viewport.height + 0.5);
});

When("I open the app on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
});

Then(
  "the agent indicator sits on the navigation toggle's row",
  async ({ page }) => {
    const indicator = await page
      .getByRole("button", { name: /^Agents:/ })
      .boundingBox();
    const toggle = await page
      .getByRole("navigation", { name: "Primary navigation" })
      .boundingBox();
    // Same vertical center, so neither floats above the other.
    expect(
      Math.abs(
        indicator!.y + indicator!.height / 2 - (toggle!.y + toggle!.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
  },
);

const agentPanel = (page: Page) =>
  page.getByRole("complementary", { name: "Agents" });

Then(
  "the session {string} lists {string}, {string} and {string}",
  async (
    { page },
    title: string,
    client: string,
    state: string,
    left: string,
  ) => {
    const row = agentPanel(page).getByRole("button", { name: title });
    await expect(row).toContainText(`${client} · ${state} · ${left}`);
  },
);

Then("the chat shows {string}", async ({ page }, text: string) => {
  await expect(agentPanel(page).getByText(text)).toBeVisible();
});

When("I select the session {string}", async ({ page }, title: string) => {
  await agentPanel(page).getByRole("button", { name: title }).click();
});

When("I choose {string} in the chat", async ({ page }, choice: string) => {
  await agentPanel(page)
    .getByRole("button", { name: choice, exact: true })
    .click();
});

When("I dismiss the session", async ({ page }) => {
  await agentPanel(page)
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
});

Then(
  "the dismissal is sent for the session {string}",
  async ({}, title: string) => {
    const snapshot = mcp.bridgeEvents.find(({ event }) => event === "agents")
      ?.data as { sessions: { id: string; title: string }[] };
    const session = snapshot.sessions.find(
      (candidate) => candidate.title === title,
    );
    expect(session).toBeDefined();
    await expect.poll(() => mcp.postedDismissals).toEqual([session!.id]);
  },
);

Then(
  "the session {string} can no longer be dismissed",
  async ({ page }, title: string) => {
    await expect(
      agentPanel(page).getByRole("button", { name: title }),
    ).toContainText("cancelled");
    await expect(
      agentPanel(page).getByRole("button", { name: "Dismiss", exact: true }),
    ).toHaveCount(0);
  },
);

Then("the page stays usable beside the panel", async ({ page }) => {
  await viewSwitcher(page).click();
  await page.getByRole("menuitem", { name: /^Backlog/ }).click();
  await expect(page).toHaveURL(/\/backlog/);
  await expect(agentPanel(page)).toBeVisible();
});

Then("the agent panel is an overlay", async ({ page }) => {
  await expect(page.getByRole("dialog", { name: "Agents" })).toBeVisible();
  await expect(agentPanel(page)).toHaveCount(0);
});

Then(
  "the answer {string} is sent for that question",
  async ({}, text: string) => {
    await expect
      .poll(() => mcp.postedAnswers)
      .toEqual([{ questionId: "question-1", text }]);
  },
);

Then("the question toast is gone", async ({ page }) => {
  await expect(
    page.getByText("Claude Code asks: Which project gets the 2 hours?"),
  ).toHaveCount(0);
});
