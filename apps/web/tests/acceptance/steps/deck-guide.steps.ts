import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";

/*
 * Deck's built guide (#782): the review page reads a pull request in its
 * guide's order, built from the code by the local API, which is mocked here.
 */

const { Given, When, Then } = createBdd();

/** The summary, on the Overview tab. */
async function summaryOf(page: Page) {
  await page.getByRole("tab", { name: "Overview" }).click();
  return page.getByRole("region", { name: "Summary" });
}
const apiUrl = "http://127.0.0.1:8787";

const lines = (count: number, from: number, text: (line: number) => string) =>
  Array.from({ length: count }, (_, index) => text(from + index));

/** A hunk as the local API sends it, its patch as Review Deck's `hunkToPatch` writes it. */
function hunk(path: string, index: number, start: number, body: string[]) {
  const removed = body.filter((line) => !line.startsWith("+")).length;
  const added = body.filter((line) => !line.startsWith("-")).length;
  const header = `@@ -${start},${removed} +${start},${added} @@`;
  return {
    id: `${path}#${index}`,
    header,
    oldStart: start,
    oldLines: removed,
    newStart: start,
    newLines: added,
    patch: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      header,
      ...body,
      "",
    ].join("\n"),
  };
}

const context = (from: number) =>
  lines(3, from, (line) => `   const step${line} = read(${line});`);

const OPENED = {
  headSha: "head",
  baseSha: "base",
  files: [
    {
      path: "src/client/retry.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/client/retry.ts", 0, 10, [
          ...context(10),
          "-  const delay = 100;",
          "+  const delay = backoff(attempt);",
          ...context(14),
        ]),
      ],
    },
    {
      path: "src/client/retry.test.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/client/retry.test.ts", 0, 4, [
          ...context(4),
          "+  it('backs off', () => expect(backoff(2)).toBe(400));",
          ...context(8),
        ]),
      ],
    },
    {
      path: "src/webhooks/signer.ts",
      status: "added",
      binary: false,
      hunks: [
        hunk("src/webhooks/signer.ts", 0, 1, [
          "+export function sign(body: string, secret: string) {",
          "+  return hmac(secret, body);",
          "+}",
        ]),
      ],
    },
  ],
  guide: {
    madeWith: "code",
    concerns: [
      {
        id: "g1",
        title: "Sign each webhook payload",
        rationale: "sign is new, and nothing else reads it yet.",
        hunkIds: ["src/webhooks/signer.ts#0"],
        kinds: [],
      },
      {
        id: "g2",
        title: "Back off between retries",
        rationale: "backoff replaces the fixed delay, with its test.",
        hunkIds: ["src/client/retry.ts#0", "src/client/retry.test.ts#0"],
        kinds: ["tests"],
      },
    ],
    summary: {
      problem: {
        text: "Webhook retries hammer the receiver",
        source: "ticket",
        ticket: {
          number: 482,
          repository: "acme/api",
          title: "Webhook retries hammer the receiver",
          url: "https://github.com/acme/api/issues/482",
          state: "Open",
        },
      },
      tickets: [
        {
          number: 482,
          repository: "acme/api",
          title: "Webhook retries hammer the receiver",
          url: "https://github.com/acme/api/issues/482",
          state: "Open",
        },
      ],
      kinds: ["tests"],
      breaking: [],
      risks: [
        {
          id: "risk:auth",
          text: "Auth and security: src/webhooks/signer.ts",
          hunkIds: ["src/webhooks/signer.ts#0"],
        },
      ],
      tests: [
        {
          id: "tests:g2",
          text: "Tested in src/client/retry.test.ts",
          hunkIds: ["src/client/retry.test.ts#0"],
          concernId: "g2",
        },
      ],
      untested: [
        {
          id: "untested:g1",
          text: "No test for src/webhooks/signer.ts",
          hunkIds: ["src/webhooks/signer.ts#0"],
          concernId: "g1",
        },
      ],
      leftovers: [],
    },
  },
};

Given(
  "the local API built the requested pull request's guide",
  async ({ page }) => {
    await page.route(
      `${apiUrl}/api/deck/github/connections/work/open`,
      async (route) =>
        route.fulfill({
          json: OPENED,
          headers: { "access-control-allow-origin": "*" },
        }),
    );
  },
);

const changes = (page: Parameters<Parameters<typeof When>[1]>[0]["page"]) =>
  page.getByRole("region", { name: "Changes" });

Then(
  "its changes show the guide's concerns in reading order",
  async ({ page }) => {
    await expect(changes(page).getByRole("heading", { level: 3 })).toHaveText([
      "Concern 1: Sign each webhook payload",
      "Concern 2: Back off between retries",
    ]);
    await expect(changes(page).getByText("Built from the code")).toBeVisible();
    await expect(
      changes(page).getByText("sign is new, and nothing else reads it yet."),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/deck-guide.png" });
  },
);

Then("the second concern is focused", async ({ page }) => {
  await expect(
    changes(page).getByRole("heading", {
      name: "Concern 2: Back off between retries",
    }),
  ).toBeFocused();
});

When("I mark the second concern's first hunk viewed", async ({ page }) => {
  await changes(page)
    .getByRole("button", {
      name: "Viewed: src/client/retry.ts, lines 10 to 16",
    })
    .click();
});

Then(
  "the guide tree shows the second concern half viewed",
  async ({ page }) => {
    // The tree opens on its titles, each with its viewed count.
    await expect(
      page
        .getByRole("navigation", { name: "Guide tree" })
        .getByRole("button", { name: /Back off between retries/ }),
    ).toContainText("1/2");
    await expect(
      changes(page).getByRole("group", {
        name: "src/client/retry.ts, lines 10 to 16",
      }),
    ).toHaveCount(0);
  },
);

Then("the guide tree folds to its ticks", async ({ page }) => {
  const tree = page.getByRole("navigation", { name: "Guide tree" });
  await expect(tree.getByText("Sign each webhook payload")).toHaveCount(0);
  await expect(
    tree.getByRole("button", {
      name: "2. Back off between retries · 1 of 2 viewed",
    }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/deck-guide-tree.png" });
});

When("I switch to Files A–Z", async ({ page }) => {
  await changes(page).getByRole("button", { name: "Files A–Z" }).click();
});

Then("the changed files show in path order", async ({ page }) => {
  await expect(changes(page).getByRole("heading", { level: 3 })).toHaveText([
    "src/client/retry.test.ts",
    "src/client/retry.ts",
    "src/webhooks/signer.ts",
  ]);
});

Then("the guide fits the narrow viewport", async ({ page }) => {
  await expect(
    changes(page).getByRole("heading", {
      name: "Concern 1: Sign each webhook payload",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/deck-guide-narrow.png" });
});

Then(
  "the summary names the linked ticket, the kinds and each section's lines",
  async ({ page }) => {
    const summary = await summaryOf(page);
    await expect(
      summary.getByText("Webhook retries hammer the receiver"),
    ).toBeVisible();
    await expect(
      summary.getByRole("button", {
        name: "Open #482: Webhook retries hammer the receiver",
      }),
    ).toBeVisible();
    await expect(
      summary.getByRole("list", { name: "Kinds of change" }),
    ).toHaveText("Tests");
    await expect(summary.getByRole("heading", { level: 3 })).toHaveText([
      "Risky areas",
      "Tests",
    ]);
    await page.screenshot({ path: "test-results/deck-summary.png" });
  },
);

When("I follow the summary's line about the test", async ({ page }) => {
  await (
    await summaryOf(page)
  )
    .getByRole("button", {
      name: "Concern 2: Tested in src/client/retry.test.ts",
    })
    .click();
});

Then("the test's hunk is in view and focused", async ({ page }) => {
  const hunk = page.locator('[data-hunk-id="src/client/retry.test.ts#0"]');
  await expect(hunk).toBeFocused();
  await expect(hunk).toBeInViewport();
  // Never under the sticky versions bar (#787).
  const [top, bar] = await Promise.all([
    hunk.evaluate((element) => element.getBoundingClientRect().top),
    page
      .locator(".deck-versions")
      .evaluate((element) => element.getBoundingClientRect().bottom),
  ]);
  expect(top).toBeGreaterThanOrEqual(bar - 1);
});

/*
 * The agent's guide (#794): after a regroup, the local API shows the
 * agent's guide, labelled with the agent, until the user goes back to the
 * guide built from the code.
 */

const AGENT_GUIDE = {
  madeWith: "agent",
  provider: { cli: "claude-code", label: "Claude Code" },
  concerns: [
    {
      id: "agent-1",
      title: "Back off between retries, with its test",
      rationale:
        "The retry waits longer each time, and its test says how long.",
      hunkIds: ["src/client/retry.ts#0", "src/client/retry.test.ts#0"],
      kinds: ["breaking", "fix", "tests"],
    },
    {
      id: "agent-2",
      title: "Sign each webhook payload",
      rationale: "A new signer, read by nothing yet.",
      hunkIds: ["src/webhooks/signer.ts#0"],
      kinds: ["feature"],
    },
  ],
  summary: {
    ...OPENED.guide.summary,
    problem: {
      text: "Retries come back too fast for a slow receiver.",
      source: "inferred",
    },
    tickets: [],
    kinds: ["breaking", "feature", "fix", "tests"],
    breaking: [
      {
        id: "breaking:5d1c",
        text: "The retry delay grows with each attempt",
        hunkIds: ["src/client/retry.ts#0"],
      },
    ],
    tests: [],
    untested: [],
  },
};

Given("the local API shows the guide an agent regrouped", async ({ page }) => {
  const cors = { "access-control-allow-origin": "*" };
  await page.route(
    `${apiUrl}/api/deck/github/connections/work/open`,
    async (route) =>
      route.fulfill({
        json: { ...OPENED, guide: AGENT_GUIDE },
        headers: cors,
      }),
  );
  await page.route(
    `${apiUrl}/api/deck/github/connections/work/guide/revert`,
    async (route) =>
      route.fulfill({ json: { guide: OPENED.guide }, headers: cors }),
  );
});

Then("the guide says it was grouped by Claude Code", async ({ page }) => {
  await expect(changes(page).getByRole("heading", { level: 3 })).toHaveText([
    "Concern 1: Back off between retries, with its test",
    "Concern 2: Sign each webhook payload",
  ]);
  await expect(
    changes(page).getByText("Grouped by Claude Code · Built from the code"),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/deck-agent-guide.png" });
});

Then(
  "the summary shows the agent's inferred problem and breaking change",
  async ({ page }) => {
    const summary = await summaryOf(page);
    await expect(summary.getByText("Inferred, no linked ticket")).toBeVisible();
    await expect(
      summary.getByRole("button", {
        name: "The retry delay grows with each attempt",
      }),
    ).toBeVisible();
    await expect(
      summary.getByRole("list", { name: "Kinds of change" }),
    ).toHaveText(/Breaking.*Feature.*Fix.*Tests/);
    // Each line ends with its more ›.
    await expect(
      summary.getByRole("button", { name: "More detail" }),
    ).toHaveCount(2);
    await page.screenshot({ path: "test-results/deck-agent-summary.png" });
    // Back to Changes, where the guide is.
    await page.getByRole("tab", { name: /^Changes/ }).click();
  },
);

When("I open Regroup…", async ({ page }) => {
  await changes(page).getByRole("button", { name: "Regroup…" }).click();
});

Then("its instruction is ready to send as is", async ({ page }) => {
  const field = changes(page).getByRole("textbox", { name: "Instruction" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(
    "Group the changes in the order a reviewer should read them.",
  );
  await page.screenshot({ path: "test-results/deck-regroup.png" });
  await field.press("Escape");
  await expect(field).toHaveCount(0);
});

When("I go back to the guide built from the code", async ({ page }) => {
  await changes(page)
    .getByRole("button", { name: "Built from the code" })
    .click();
});

Then("the guide says it was built from the code", async ({ page }) => {
  await expect(changes(page).getByRole("heading", { level: 3 })).toHaveText([
    "Concern 1: Sign each webhook payload",
    "Concern 2: Back off between retries",
  ]);
  await expect(changes(page).getByText("Grouped by")).toHaveCount(0);
  await expect(changes(page).getByText("Built from the code")).toBeVisible();
});
