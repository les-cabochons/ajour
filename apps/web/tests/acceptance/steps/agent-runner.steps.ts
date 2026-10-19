import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";
const cors = { "access-control-allow-origin": "*" };

interface RunnerMockState {
  /** Bodies of the `POST /api/agent-runs` requests. */
  runRequests: unknown[];
  /** Bodies of the task settings saves. */
  settingsSaves: unknown[];
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
  placement: "commit-week",
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

const submitWeekTask = {
  ...enterWeek,
  taskId: "submit-week",
  label: "Check Workday and submit",
  placement: "submit-week",
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
async function mockRunner(
  page: Page,
  overview: unknown,
  installedPlugins: unknown[] = [],
) {
  const state: RunnerMockState = { runRequests: [], settingsSaves: [] };
  let runRequested = false;

  await page.route(`${apiUrl}/api/plugins`, (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: installedPlugins.length > 0,
        plugins: installedPlugins,
        connectionGroups: installedPlugins.map((plugin) => ({
          plugin,
          enabled: true,
          connections: [],
        })),
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
  await page.route(
    `${apiUrl}/api/agents/plugins/ajp-workday/settings`,
    async (route) => {
      const body = route.request().postDataJSON() as { values: object };
      state.settingsSaves.push(body);
      // The saved settings fill every task of the plugin.
      const tasks = (overview as { tasks: object[] }).tasks.map((task) => ({
        ...task,
        values: body.values,
        blockers: [],
      }));
      await route.fulfill({
        json: { ...readyOverview, tasks },
        headers: cors,
      });
    },
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

const manifestTask = (task: typeof enterWeek) => ({
  id: task.taskId,
  label: task.label,
  placement: task.placement,
  prompt: `prompts/${task.taskId}.md`,
  estimateMinutes: task.estimateMinutes,
  weekLink: task.weekLink,
  settings: task.settings,
});

/**
 * The installed manifest of a plugin that declares only agent tasks: both
 * ask for the same timesheet URL.
 */
const workdayPlugin = {
  id: "ajp-workday",
  displayName: "Workday",
  version: "0.1.0",
  apiVersion: 3,
  iconSvg:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>",
  connectionFields: [],
  capabilities: {
    agentTask: {
      tasks: [manifestTask(enterWeek), manifestTask(submitWeekTask)],
    },
  },
};

Given(
  "the Workday plugin is installed without its timesheet URL",
  async ({ page }) => {
    runner = await mockRunner(
      page,
      {
        ...readyOverview,
        tasks: [enterWeek, submitWeekTask].map((task) => ({
          ...task,
          values: {},
          blockers: [
            "Fill in Workday timesheet URL in Settings > Plugins > Workday",
          ],
        })),
      },
      [workdayPlugin],
    );
    await page.route(`${apiUrl}/api/project-data-shapes`, (route) =>
      route.fulfill({ json: { plugins: [] }, headers: cors }),
    );
  },
);

When("I open the Workday plugin settings", async ({ page }) => {
  await page.goto("/settings/plugins/ajp-workday");
});

When(
  "I fill in {string} with {string}",
  async ({ page }, label: string, value: string) => {
    await page.getByLabel(label, { exact: true }).fill(value);
  },
);

Then("both tasks say {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toHaveCount(2);
});

Then("the page asks for {string} once", async ({ page }, label: string) => {
  await expect(page.getByLabel(label, { exact: true })).toHaveCount(1);
});

Then(
  "the timesheet URL {string} is saved",
  async ({}, timesheetUrl: string) => {
    await expect
      .poll(() => runner.settingsSaves)
      .toEqual([{ values: { timesheetUrl } }]);
  },
);

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

Given(
  "the local API reports a ready {string} submit task",
  async ({ page }, label: string) => {
    expect(label).toBe(submitWeekTask.label);
    runner = await mockRunner(page, {
      ...readyOverview,
      tasks: [enterWeek, submitWeekTask],
    });
  },
);

/** Releases the held `GET /api/agents` answer, see the step below. */
let sendAgentTasks: () => void = () => {};

Given(
  "the local API holds back a ready {string} submit task",
  async ({ page }, label: string) => {
    expect(label).toBe(submitWeekTask.label);
    const overview = { ...readyOverview, tasks: [enterWeek, submitWeekTask] };
    runner = await mockRunner(page, overview);
    const held = new Promise<void>((resolve) => {
      sendAgentTasks = resolve;
    });
    // Registered last, so it answers before the mock's own route.
    await page.route(`${apiUrl}/api/agents`, async (route) => {
      await held;
      await route.fulfill({ json: overview, headers: cors });
    });
  },
);

When("the local API sends the agent tasks", () => {
  sendAgentTasks();
});

Then(
  "the Commit page offers {string} alongside Submit week",
  async ({ page }, label: string) => {
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Submit week", exact: true }),
    ).toBeEnabled();
  },
);

Then("the manual Submit week button is enabled", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Submit week", exact: true }),
  ).toBeEnabled();
});

Then("no agent run is requested", () => {
  expect(runner.runRequests).toEqual([]);
});

When("I undo the manual week submission", async ({ page }) => {
  await page
    .getByLabel("Week submitted", { exact: true })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
});

Then("{string} is the primary button", async ({ page }, label: string) => {
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toHaveClass(/\bbg-primary\b/);
});

Then(
  "the {string} run is requested for the week of {word}",
  async ({}, taskId: string, weekOf: string) => {
    await expect
      .poll(() => runner.runRequests)
      .toEqual([{ pluginId: "ajp-workday", taskId, weekOf }]);
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
  "I open the Commit page for the week of {word}",
  async ({ page }, weekOf: string) => {
    await page.goto(`/time/${weekOf}/commit`);
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
