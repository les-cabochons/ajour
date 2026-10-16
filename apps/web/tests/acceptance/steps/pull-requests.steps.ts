import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  codeHostOverview,
  pullRequestFacts,
} from "../../fixtures/pull-requests";
import { viewSwitcherOptions } from "../../fixtures/sidebar";

const { Given, When, Then } = createBdd();
const apiUrl = "http://127.0.0.1:8787";

Then(
  "the sidebar shows backlog controls and pull requests together",
  async ({ page }) => {
    const section = page.getByRole("region", {
      name: "Pull requests on your plate",
    });
    await expect(section).toBeVisible();
    // Sidebar rows open their actions with right-click, not a "…" button.
    await expect(
      section.getByRole("button", { name: /^Actions for/ }),
    ).toHaveCount(0);
    // Nothing is snoozed or settled, so those sections are not shown.
    await expect(page.getByRole("button", { name: /^Snoozed/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Settled", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "Primary navigation" })
        .locator("[data-backlog-item-id]")
        .filter({ hasText: "Plan next release" }),
    ).toBeVisible();
  },
);
Then("the pull request page stays open", async ({ page }) => {
  await expect(page).toHaveURL(/\/pull-requests$/);
  await expect(
    page.getByRole("heading", { name: "Pull requests", exact: true }),
  ).toBeVisible();
});
Then("the sidebar has no Pull requests section", async ({ page }) => {
  // The view switcher still lists the Pull requests page.
  await expect(
    page.getByRole("region", { name: "Pull requests on your plate" }),
  ).toHaveCount(0);
  expect(await viewSwitcherOptions(page)).toContain("Pull requests");
});
When("I collapse the sidebar Pull requests section", async ({ page }) => {
  await page
    .getByRole("region", { name: "Pull requests on your plate" })
    .getByRole("button", { name: /^Pull requests \d+$/ })
    .click();
});
Then("the sidebar pull requests are collapsed", async ({ page }) => {
  const section = page.getByRole("region", {
    name: "Pull requests on your plate",
  });
  await expect(
    section.getByRole("button", { name: /^Pull requests \d+$/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(section.getByRole("link")).toHaveCount(0);
});
When("I set the sidebar to its minimum width", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "ajour.sidebar-layout",
      JSON.stringify({ width: 200 }),
    ),
  );
  await page.reload();
});
Then("the sidebar section labels fit inside the sidebar", async ({ page }) => {
  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const navBox = await navigation.boundingBox();
  expect(navBox?.width).toBe(200);
  // The backlog items have no section label; Pull requests is the one left.
  for (const name of [/^Pull requests \d+$/]) {
    const tab = navigation.getByRole("button", { name });
    const box = await tab.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width);
    expect(
      await tab.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/sidebar-work-list-compact.png",
  });
});
Then(
  "the sidebar has no Pull requests section and backlog controls are visible",
  async ({ page }) => {
    await expect(
      page.getByRole("region", { name: "Pull requests on your plate" }),
    ).toHaveCount(0);
    await expect(page.locator('[aria-label="Backlog items"]')).toBeVisible();
  },
);
const makeFacts = () => {
  const now = Date.now();
  return [
    {
      ...pullRequestFacts,
      createdAt: now - 2 * 3600000,
      updatedAt: now - 5000,
      lastPushedAt: now - 5000,
    },
    {
      ...pullRequestFacts,
      id: "pr2",
      number: 2,
      title: "Author's change",
      viewerIsAuthor: true,
      author: { login: "alex", isBot: false },
      reviewRequests: [],
      createdAt: now - 3600000,
      updatedAt: now - 5000,
      lastPushedAt: now - 5000,
    },
  ];
};

Given("a code host connection with local pull requests", async ({ page }) => {
  const initialFacts = makeFacts();
  let overview = structuredClone(codeHostOverview);
  let syncCount = 0;
  let automatic = false;
  await page.exposeFunction("acceptanceSyncCount", () => syncCount);
  await page.exposeFunction("acceptanceEnableCodeHostAutoSync", () => {
    automatic = true;
  });
  await page.exposeFunction("acceptanceAddWorkItemCapability", () => {
    overview = {
      ...overview,
      connectionGroups: overview.connectionGroups.map((group) => ({
        ...group,
        plugin: {
          ...group.plugin,
          capabilities: { ...group.plugin.capabilities, connector: {} },
        },
      })),
    };
  });
  await page.route(`${apiUrl}/api/connectors`, async (route) => {
    await route.fulfill({
      json: {
        ...overview,
        connectionGroups: overview.connectionGroups.map((group) => ({
          ...group,
          connections: group.connections.map((connection) => ({
            ...connection,
            autoSync: automatic,
            lastSyncAt: syncCount ? Date.now() : 1,
          })),
        })),
      },
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.route(`${apiUrl}/api/project-data-shapes`, async (route) =>
    route.fulfill({
      json: { plugins: [] },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route(
    `${apiUrl}/api/code-hosts/github/connections/work/syncPullRequests`,
    async (route) => {
      syncCount += 1;
      await route.fulfill({
        json: {
          viewer: { login: "alex", isBot: false },
          pullRequests: initialFacts,
        },
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await page.route(
    `${apiUrl}/api/connectors/github/activation`,
    async (route) => {
      const { enabled, capability } = route.request().postDataJSON();
      overview = {
        ...overview,
        connectionGroups: overview.connectionGroups.map((group) =>
          capability
            ? {
                ...group,
                inactiveCapabilities: enabled
                  ? (group.inactiveCapabilities ?? []).filter(
                      (candidate) => candidate !== capability,
                    )
                  : [...(group.inactiveCapabilities ?? []), capability],
              }
            : { ...group, enabled },
        ),
      };
      await route.fulfill({
        json: overview,
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await page.route(
    `${apiUrl}/api/connectors/github/connections/work`,
    async (route) => {
      expect(route.request().method()).toBe("DELETE");
      overview = {
        ...overview,
        connectionGroups: overview.connectionGroups.map((group) => ({
          ...group,
          connections: [],
        })),
      };
      await route.fulfill({
        json: overview,
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await page.addInitScript((facts) => {
    if (sessionStorage.getItem("pull-request-fixture-installed")) return;
    localStorage.clear();
    sessionStorage.setItem("pull-request-fixture-installed", "yes");
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        workItems: [
          {
            _id: "sidebar-backlog",
            title: "Plan next release",
            source: "manual",
            status: "active",
            priority: 1,
            createdAt: Date.now(),
          },
        ],
        pullRequests: facts.map((entry, index) => ({
          _id: index ? "authored" : "requested",
          pluginId: "github",
          pluginName: "GitHub",
          connectionId: "work",
          connectionLabel: "Work",
          viewerLogin: "alex",
          facts: entry,
          status: index ? "settled" : "active",
          activeAt: entry.createdAt,
          reason: index ? undefined : "review-requested",
          missingFromSync: false,
        })),
      }),
    );
  }, initialFacts);
});

When("I open the pull request list", async ({ page }) => {
  await page.goto("/pull-requests");
  await expect(
    page.getByRole("heading", { name: "Pull requests", exact: true }),
  ).toBeVisible();
});
Then(
  "review requests appear under Active and authored changes under Settled",
  async ({ page }) => {
    await expect(
      page
        .getByRole("region", { name: "Active", exact: true })
        .getByRole("link", { name: "Open Fix request handling" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Settled", exact: true })
        .getByRole("link", { name: "Open Author's change" }),
    ).toBeVisible();
  },
);
Then(
  "the pull request sidebar contains only active review requests",
  async ({ page }) => {
    const sidebar = page.getByRole("region", {
      name: "Pull requests on your plate",
    });
    await expect(
      sidebar.getByRole("link", { name: "Open Fix request handling" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Open Author's change" }),
    ).toHaveCount(0);
    await page.screenshot({ path: "test-results/pull-requests-desktop.png" });
  },
);
When(
  "I settle the requested pull request with its row key",
  async ({ page }) => {
    const row = page
      .getByRole("region", { name: "Active", exact: true })
      .getByRole("link", { name: "Open Fix request handling" });
    await row.focus();
    await row.press("e");
  },
);
Then(
  "the requested pull request leaves the sidebar and stays Settled after reload",
  async ({ page }) => {
    await expect(
      page
        .getByRole("region", { name: "Pull requests on your plate" })
        .getByRole("link", { name: "Open Fix request handling" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page
        .getByRole("region", { name: "Settled", exact: true })
        .getByRole("link", { name: "Open Fix request handling" }),
    ).toBeVisible();
  },
);
When("I enable Changes end a snooze early", async ({ page }) => {
  await page.goto("/settings/general");
  await page
    .getByRole("switch", { name: "Changes end a snooze early" })
    .click();
});
When("I snooze the requested pull request", async ({ page }) => {
  const row = page
    .getByRole("region", { name: "Active", exact: true })
    .getByRole("link", { name: "Open Fix request handling" });
  await row.focus();
  await row.press("b");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /In an hour/ })
    .click();
});
Then(
  "the requested pull request is absent from the sidebar",
  async ({ page }) => {
    await expect(
      page
        .getByRole("region", { name: "Pull requests on your plate" })
        .getByRole("link", { name: "Open Fix request handling" }),
    ).toHaveCount(0);
  },
);
When(
  "a sync reports a new mention on the requested pull request",
  async ({ page }) => {
    const facts = makeFacts();
    facts[0] = {
      ...facts[0]!,
      comments: [
        {
          id: "mention",
          author: { login: "author", isBot: false },
          createdAt: Date.now() + 1000,
          mentionsViewer: true,
        },
      ],
    };
    await page.route(
      `${apiUrl}/api/code-hosts/github/connections/work/syncPullRequests`,
      async (route) =>
        route.fulfill({
          json: {
            viewer: { login: "alex", isBot: false },
            pullRequests: facts,
          },
          headers: { "access-control-allow-origin": "*" },
        }),
    );
    await page.getByRole("button", { name: "Sync", exact: true }).click();
  },
);
Then(
  "the requested pull request returns with its Returned mark",
  async ({ page }) => {
    await expect(
      page
        .getByRole("region", { name: "Pull requests on your plate" })
        .getByRole("link", { name: "Open Fix request handling" }),
    ).toContainText("Returned");
  },
);
When("I open the requested pull request summary", async ({ page }) => {
  await page
    .getByRole("region", { name: "Active", exact: true })
    .getByRole("link", { name: "Open Fix request handling" })
    .click();
});
Then("the Returned mark is acknowledged", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Fix request handling" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Pull requests on your plate" }),
  ).not.toContainText("Returned");
  await page.screenshot({ path: "test-results/pull-request-summary.png" });
});

Then("the requested pull request remains snoozed", async ({ page }) => {
  await expect(
    page
      .getByRole("region", { name: "Active", exact: true })
      .getByRole("link", { name: "Open Fix request handling" }),
  ).toContainText("Snoozed");
});

When("a sync reports the requested pull request merged", async ({ page }) => {
  const facts = makeFacts().map((entry, index) =>
    index ? entry : { ...entry, state: "merged", closedAt: Date.now() },
  );
  await page.route(
    `${apiUrl}/api/code-hosts/github/connections/work/syncPullRequests`,
    async (route) =>
      route.fulfill({
        json: { viewer: { login: "alex", isBot: false }, pullRequests: facts },
        headers: { "access-control-allow-origin": "*" },
      }),
  );
  await page.getByRole("button", { name: "Sync", exact: true }).click();
});

Then(
  "the requested pull request appears under Recently closed",
  async ({ page }) => {
    await expect(
      page
        .getByRole("region", { name: "Recently closed", exact: true })
        .getByRole("link", { name: "Open Fix request handling" }),
    ).toContainText("Merged");
  },
);
When("I open the GitHub connection settings", async ({ page }) => {
  await page.goto("/settings/plugins/github");
  await expect(
    page.getByRole("heading", { name: "GitHub", exact: true }),
  ).toBeVisible();
});
When("I deactivate the code host plugin", async ({ page }) => {
  await page.goto("/settings/plugins/github");
  await page
    .getByRole("switch", { name: "Deactivate GitHub", exact: true })
    .click();
});
Given("the code host plugin also syncs work items", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    (
      window as unknown as {
        acceptanceAddWorkItemCapability: () => Promise<void>;
      }
    ).acceptanceAddWorkItemCapability(),
  );
});
When("I turn off pull requests for the code host plugin", async ({ page }) => {
  await page.goto("/settings/plugins/github");
  await page
    .getByRole("switch", {
      name: "Deactivate pull requests for GitHub",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("switch", {
      name: "Activate pull requests for GitHub",
      exact: true,
    }),
  ).toBeVisible();
});
When("I turn on pull requests for the code host plugin", async ({ page }) => {
  await page.goto("/settings/plugins/github");
  await page
    .getByRole("switch", {
      name: "Activate pull requests for GitHub",
      exact: true,
    })
    .click();
});
Then("the plugin and its work items stay active", async ({ page }) => {
  await expect(
    page.getByRole("switch", { name: "Deactivate GitHub", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", {
      name: "Deactivate work items for GitHub",
      exact: true,
    }),
  ).toBeChecked();
});
When("I reactivate the code host plugin", async ({ page }) => {
  await page.goto("/settings/plugins/github");
  await page
    .getByRole("switch", { name: "Activate GitHub", exact: true })
    .click();
});
Then(
  "pull request navigation disappears and local records remain",
  async ({ page }) => {
    expect(await viewSwitcherOptions(page)).not.toContain("Pull requests");
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("ajour.local-state.v2")!).pullRequests
            .length,
      ),
    ).toBe(2);
  },
);
Then(
  "pull request navigation returns with the same local records",
  async ({ page }) => {
    expect(await viewSwitcherOptions(page)).toContain("Pull requests");
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("ajour.local-state.v2")!).pullRequests
            .length,
      ),
    ).toBe(2);
  },
);
When("I ask to remove the GitHub connection", async ({ page }) => {
  await page.getByRole("button", { name: "Remove", exact: true }).click();
});
Then(
  "the removal confirmation states the saved pull request count",
  async ({ page }) => {
    await expect(page.getByRole("alertdialog")).toContainText(
      "2 saved pull requests",
    );
  },
);
When("I confirm removal of the GitHub connection", async ({ page }) => {
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove connection" })
    .click();
});
Then("the connection's pull request records are deleted", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("ajour.local-state.v2")!)
            .pullRequests,
      ),
    )
    .toEqual([]);
});
When("I Ctrl-click the requested pull request", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { acceptanceSource: string }).acceptanceSource = "";
    window.open = (url) => {
      (window as unknown as { acceptanceSource: string }).acceptanceSource =
        String(url);
      return null;
    };
  });
  await page
    .getByRole("region", { name: "Active", exact: true })
    .getByRole("link", { name: "Open Fix request handling" })
    // macOS turns Ctrl-click into a right-click, so press Cmd there.
    .click({ modifiers: ["ControlOrMeta"] });
});
Then("its source opens and the list stays open", async ({ page }) => {
  await expect(page).toHaveURL(/\/pull-requests$/);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { acceptanceSource: string }).acceptanceSource,
    ),
  ).toBe(pullRequestFacts.url);
});
When("I open the pull request list on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pull-requests");
});
Then("the pull request list fits the viewport", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Pull requests", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/pull-requests-mobile.png" });
});
Then(
  "Pull requests is available from the narrow Settings list",
  async ({ page }) => {
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("link", { name: "Pull requests", exact: true })
      .click();
    await expect(page).toHaveURL(/\/pull-requests$/);
  },
);
Given(
  "the code host connection has automatic sync enabled",
  async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() =>
      (
        window as unknown as {
          acceptanceEnableCodeHostAutoSync: () => Promise<void>;
        }
      ).acceptanceEnableCodeHostAutoSync(),
    );
  },
);
Then("a code host sync runs automatically", async ({ page }) => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { acceptanceSyncCount: () => Promise<number> }
        ).acceptanceSyncCount(),
      ),
    )
    .toBeGreaterThan(0);
});
