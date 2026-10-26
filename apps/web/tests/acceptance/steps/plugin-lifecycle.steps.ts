import { expect, type Page } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type {
  PluginOverviewGroup,
  PluginsOverview,
  PluginSuspension,
} from "@ajour/shared";

/*
 * A plugin API 4 plugin's page (#391): the Advanced section's Start and
 * Memory ceiling, and the notice of a plugin that keeps stopping. The local
 * API is mocked at HTTP; it keeps what the page saves.
 */

const { Given, When, Then } = createBdd();

const jira = {
  id: "jira",
  displayName: "Jira",
  version: "4.0.0",
  apiVersion: 4,
  description: "Test connector",
  iconSvg:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M2 2h12v12H2z'/></svg>",
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [
    { id: "site", label: "Site", type: "text" as const, required: true },
  ],
};

interface MockedApi {
  group: PluginOverviewGroup;
  saved: unknown[];
  resumed: number;
}

const apis = new WeakMap<Page, MockedApi>();

function overviewOf(api: MockedApi): PluginsOverview {
  return {
    pluginsEnabled: true,
    plugins: [jira],
    connectionGroups: [api.group],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
    sandbox: { state: "on" },
  };
}

const cors = { "access-control-allow-origin": "*" };

Given(
  "an installed Jira plugin runs in a sandbox of its own",
  async ({ page }) => {
    const api: MockedApi = {
      group: {
        plugin: jira,
        enabled: true,
        connections: [],
        runtime: {
          declared: { start: "whenNeeded", memoryCeilingMb: 256 },
          settings: { start: "plugin" },
        },
      },
      saved: [],
      resumed: 0,
    };
    apis.set(page, api);
    await page.route("**/api/plugins", (route) =>
      route.fulfill({ json: overviewOf(api), headers: cors }),
    );
    await page.route("**/api/plugins/jira/runtime", async (route) => {
      const body = route.request().postDataJSON() as {
        start: "plugin" | "whenNeeded" | "alwaysReady";
        memoryCeilingMb: number | null;
      };
      api.saved.push(body);
      api.group = {
        ...api.group,
        runtime: {
          ...api.group.runtime!,
          settings: {
            start: body.start,
            ...(body.memoryCeilingMb === null
              ? {}
              : { memoryCeilingMb: body.memoryCeilingMb }),
          },
        },
      };
      await route.fulfill({ json: overviewOf(api), headers: cors });
    });
    await page.route("**/api/plugins/jira/resume", async (route) => {
      api.resumed += 1;
      const { suspended: _suspended, ...rest } = api.group;
      api.group = rest;
      await route.fulfill({ json: overviewOf(api), headers: cors });
    });
    await page.route("**/api/project-data-shapes", (route) =>
      route.fulfill({ json: { plugins: [] }, headers: cors }),
    );
  },
);

Given(
  "Jira kept stopping, the last time above its memory ceiling",
  async ({ page }) => {
    const api = apis.get(page)!;
    const suspended: PluginSuspension = {
      cause: "memory",
      at: Date.parse("2026-10-25T14:00:00Z"),
    };
    api.group = { ...api.group, suspended };
  },
);

When(
  "I open Jira's plugin page at {int} pixels wide",
  async ({ page }, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings/plugins/jira");
    await expect(
      page.getByRole("heading", { name: "Jira", exact: true }).first(),
    ).toBeVisible();
  },
);

const advanced = (page: Page) =>
  page.locator("[data-plugin-advanced]", {
    has: page.getByRole("heading", { name: "Advanced", exact: true }),
  });

Then(
  "the page ends with an Advanced section showing Start {string} and the plugin's memory ceiling of {int} MB",
  async ({ page }, start: string, ceiling: number) => {
    const section = advanced(page);
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    // Nothing follows it on the page.
    const last = page.locator(".settings-section").last();
    await expect(last).toHaveAttribute("data-plugin-advanced", "");
    await expect(
      section.getByRole("combobox", { name: "Start", exact: true }),
    ).toHaveText(start);
    // Start applies now; only a new ceiling waits for the next start.
    await expect(
      section.getByText(
        "Start applies at once. A new Memory ceiling applies the next time the plugin starts.",
        { exact: true },
      ),
    ).toBeVisible();
    const memory = section.getByLabel("Memory ceiling", { exact: true });
    await expect(memory).toHaveValue("");
    await expect(memory).toHaveAttribute("placeholder", String(ceiling));
    await expect(
      section.getByText(`Empty uses the plugin's, ${ceiling} MB.`, {
        exact: false,
      }),
    ).toBeVisible();
    const box = await section.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({
      path: `test-results/plugin-advanced-${page.viewportSize()!.width}.png`,
      fullPage: true,
    });
  },
);

When("I choose {string} for Start", async ({ page }, label: string) => {
  await advanced(page)
    .getByRole("combobox", { name: "Start", exact: true })
    .click();
  await page.getByRole("option", { name: label, exact: true }).click();
});

When(
  "I enter {string} as the memory ceiling",
  async ({ page }, value: string) => {
    const memory = advanced(page).getByLabel("Memory ceiling", {
      exact: true,
    });
    await memory.fill(value);
    await memory.press("Enter");
  },
);

Then(
  "Ajour saves Start {string} with the plugin's memory ceiling",
  async ({ page }, start: string) => {
    const api = apis.get(page)!;
    await expect
      .poll(() => api.saved.at(-1))
      .toEqual({
        start,
        memoryCeilingMb: null,
      });
    await expect(
      advanced(page).getByRole("combobox", { name: "Start", exact: true }),
    ).toHaveText("Always ready");
  },
);

Then(
  "Ajour saves Start {string} with a memory ceiling of {int} MB",
  async ({ page }, start: string, ceiling: number) => {
    const api = apis.get(page)!;
    await expect
      .poll(() => api.saved.at(-1))
      .toEqual({
        start,
        memoryCeilingMb: ceiling,
      });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      advanced(page).getByLabel("Memory ceiling", { exact: true }),
    ).toHaveValue(String(ceiling));
  },
);

Then(
  "the memory ceiling says {string} and nothing more is saved",
  async ({ page }, error: string) => {
    const api = apis.get(page)!;
    const savedBefore = api.saved.length;
    await expect(
      advanced(page).getByRole("alert").getByText(error, { exact: true }),
    ).toBeVisible();
    // What the user typed stays, to correct.
    await expect(
      advanced(page).getByLabel("Memory ceiling", { exact: true }),
    ).toHaveValue("32");
    expect(api.saved.length).toBe(savedBefore);
  },
);

Then(
  "Jira's page says {string} with {string}",
  async ({ page }, title: string, reason: string) => {
    const notice = page.locator("[data-plugin-suspended]");
    await expect(notice.getByText(title, { exact: true })).toBeVisible();
    await expect(notice.getByText(reason, { exact: true })).toBeVisible();
    await expect(
      notice.getByRole("button", { name: "Turn back on", exact: true }),
    ).toBeEnabled();
    const box = await notice.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({
      path: `test-results/plugin-suspended-${page.viewportSize()!.width}.png`,
    });
  },
);

When("I turn Jira back on", async ({ page }) => {
  await page
    .locator("[data-plugin-suspended]")
    .getByRole("button", { name: "Turn back on", exact: true })
    .click();
});

Then("Jira's page no longer says {string}", async ({ page }, title: string) => {
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  expect(apis.get(page)!.resumed).toBe(1);
  await expect(
    page.getByText("Jira turned back on.", { exact: true }),
  ).toBeVisible();
});
