import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };

interface RunnerMockState {
  /** Bodies of the `POST /api/agent-runs` requests. */
  runRequests: unknown[];
}

const cli = (
  id: string,
  label: string,
  fields: { supported: boolean; installed: boolean; version?: string },
) => ({ id, label, ...fields });

const enterWeek = {
  pluginId: "ajp-workday",
  pluginName: "Workday",
  taskId: "enter-week",
  label: "Enter in Workday",
  placement: "submit-week",
  estimateMinutes: 10,
  settings: [
    {
      id: "timesheetUrl",
      label: "Workday timesheet URL",
      type: "url",
      required: true,
      secret: false,
    },
  ],
  values: { timesheetUrl: "https://wd.example/t" },
  weekLink: "{{settings.timesheetUrl}}?date={{weekOf}}",
  blockers: [] as string[],
};

const readyOverview = {
  settings: { cli: "claude-code", browserMode: "ajour-chrome", model: "" },
  clis: [
    cli("claude-code", "Claude Code", {
      supported: true,
      installed: true,
      version: "2.1.0",
    }),
    cli("codex", "Codex", { supported: false, installed: false }),
    cli("opencode", "OpenCode", { supported: false, installed: false }),
  ],
  tasks: [enterWeek],
  currentRun: null,
};

/** What the bridge sends once the run is going: a session the runner owns. */
const runningSnapshot = () => {
  const now = Date.now();
  return {
    sessions: [
      {
        id: "session-1",
        client: { id: "client-1", name: "Enter in Workday" },
        title: "Enter in Workday, week of 2026-10-12",
        state: "active",
        startedAt: now,
        deadlineAt: now + 20 * 60_000,
        messages: [],
        runId: "run-1",
      },
    ],
    openQuestions: [],
    activity: [],
    errors: [],
    seenAt: 0,
  };
};

/**
 * Stubs the local API for the agent runner: the overview, the run request,
 * and an MCP bridge that sends the running session only after the run was
 * requested. The bridge stream ends after each answer and EventSource
 * reconnects quickly, so the second connection carries the snapshot.
 */
async function mockRunner(page: Page, overview: unknown) {
  const state: RunnerMockState = { runRequests: [] };
  let runRequested = false;

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
    route.fulfill({ json: { enabled: true, clients: [] }, headers: cors }),
  );
  await page.route(`${apiUrl}/api/mcp/bridge`, (route) =>
    route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/event-stream" },
      body:
        "retry: 200\n\n" +
        (runRequested
          ? `event: agents\ndata: ${JSON.stringify(runningSnapshot())}\n\n`
          : ""),
    }),
  );
  await page.route(`${apiUrl}/api/mcp/seen`, (route) =>
    route.fulfill({
      json: runRequested
        ? runningSnapshot()
        : {
            sessions: [],
            openQuestions: [],
            activity: [],
            errors: [],
            seenAt: Date.now(),
          },
      headers: cors,
    }),
  );
  await page.route(`${apiUrl}/api/agents`, (route) =>
    route.fulfill({ json: overview, headers: cors }),
  );
  await page.route(`${apiUrl}/api/agent-runs`, async (route) => {
    state.runRequests.push(route.request().postDataJSON());
    runRequested = true;
    await route.fulfill({
      status: 201,
      json: {
        id: "run-1",
        pluginId: "ajp-workday",
        taskId: "enter-week",
        weekOf: "2026-10-12",
        sessionId: "session-1",
        startedAt: Date.now(),
      },
      headers: cors,
    });
  });
  return state;
}

let runner: RunnerMockState;

Given(
  "the local API reports Claude Code installed and Codex missing",
  async ({ page }) => {
    runner = await mockRunner(page, {
      ...readyOverview,
      clis: [
        readyOverview.clis[0],
        // Unsupported agents are not listed, so Codex must be supported.
        cli("codex", "Codex", { supported: true, installed: false }),
      ],
      tasks: [],
    });
  },
);

Given(
  "the local API reports a ready {string} task with a week link",
  async ({ page }, label: string) => {
    expect(label).toBe(enterWeek.label);
    runner = await mockRunner(page, readyOverview);
  },
);

Given(
  "the local API reports the {string} task blocked by {string}",
  async ({ page }, label: string, blocker: string) => {
    expect(label).toBe(enterWeek.label);
    runner = await mockRunner(page, {
      ...readyOverview,
      tasks: [{ ...enterWeek, values: {}, blockers: [blocker] }],
    });
  },
);

When("I open Settings > Agents", async ({ page }) => {
  await page.goto("/settings/agents");
  await page.getByRole("combobox", { name: "Agent", exact: true }).click();
});

Then("the agent choice offers {string}", async ({ page }, label: string) => {
  await expect(
    page.getByRole("option", { name: label, exact: true }),
  ).toBeVisible();
});

Then(
  "the agent choice shows {string} as unavailable",
  async ({ page }, label: string) => {
    await expect(
      page.getByRole("option", { name: label, exact: true }),
    ).toBeDisabled();
  },
);

When(
  "I open the Submit page for the week of {word}",
  async ({ page }, weekOf: string) => {
    await page.goto(`/time/${weekOf}/submit`);
  },
);

Then(
  "I see a link {string} to {string}",
  async ({ page }, name: string, href: string) => {
    await expect(page.getByRole("link", { name })).toHaveAttribute(
      "href",
      href,
    );
  },
);

When("I press {string}", async ({ page }, name: string) => {
  await page.getByRole("button", { name, exact: true }).click();
});

Then(
  "the run is requested for the week of {word}",
  async ({}, weekOf: string) => {
    await expect
      .poll(() => runner.runRequests)
      .toEqual([{ pluginId: "ajp-workday", taskId: "enter-week", weekOf }]);
  },
);

Then(
  "the agent panel shows {string} with Stop",
  async ({ page }, title: string) => {
    const panel = page.getByRole("complementary", { name: "Agents" });
    // Starting a run opens the panel. Open it from the indicator otherwise.
    if ((await panel.count()) === 0) {
      await page.getByRole("button", { name: /^Agents:/ }).click();
    }
    await expect(panel.getByRole("button", { name: title })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
  },
);

Then(
  "{string} is disabled with the reason {string}",
  async ({ page }, name: string, reason: string) => {
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel(`${name}: ${reason}`)).toBeVisible();
  },
);
