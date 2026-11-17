import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { DesktopUpdateState } from "../../../src/lib/desktop-bridge";

declare global {
  interface Window {
    headerUpdateFixture: {
      updates: number;
      version: string | null;
      releases: string[];
      finishCheck: (status: string) => void;
      cancelUpdate: () => void;
      acceptUpdate: () => void;
      progress: (percent: number) => void;
      install: () => void;
    };
  }
}

const { Given, When, Then } = createBdd();

Given("I use the sidebar header in the browser", async ({ page }) => {
  await page.route("**/api/plugins", (route) =>
    route.fulfill({
      json: {
        pluginsEnabled: false,
        plugins: [],
        connectionGroups: [],
        totalPendingImportCount: 0,
        totalSelectedImportCount: 0,
      },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "ajour.local-state.v2",
      JSON.stringify({
        projects: [
          {
            _id: "footer",
            name: "Footer",
            status: "active",
            tasks: [],
            color: "#059669",
          },
        ],
      }),
    );
  });
  await page.goto("/time/2026-10-05");
});

Then("the sidebar header ends with Settings alone", async ({ page }) => {
  const header = page
    .getByRole("navigation", { name: "Primary navigation" })
    .locator('[data-slot="sidebar-header"]');
  const actions = header.locator("[data-sidebar-actions]");
  await expect(actions.locator("a, button")).toHaveCount(1);
  await expect(actions.getByRole("link")).toHaveAccessibleName("Settings");
  await expect(
    header.getByRole("button", { name: "Commit week", exact: true }),
  ).toHaveCount(0);
  await expect(header.locator("[data-app-update]")).toHaveCount(0);
});

When("I open Settings from the header", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
});

When("I open Settings from the header's update menu", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: "Settings, 1.0.1 is ready", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
});

Then("the General settings page is open", async ({ page }) => {
  await expect(page).toHaveURL(/\/settings\/general$/);
});

Then("the browser has no application update button", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Check for updates", exact: true }),
  ).toHaveCount(0);
});

Given(
  "the desktop has {string} update state",
  async ({ page }, initial: string) => {
    await page.route("**/api/plugins", (route) =>
      route.fulfill({
        json: {
          pluginsEnabled: false,
          plugins: [],
          connectionGroups: [],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        },
        headers: { "access-control-allow-origin": "*" },
      }),
    );
    await page.addInitScript((initial) => {
      localStorage.setItem(
        "ajour.local-state.v2",
        JSON.stringify({
          projects: [
            {
              _id: "footer",
              name: "Footer",
              status: "active",
              tasks: [],
              color: "#059669",
            },
          ],
        }),
      );
      const candidate = {
        track: "stable" as const,
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        latestTag: "v1.0.1",
        releaseName: "Ajour 1.0.1",
        releaseUrl:
          "https://github.com/les-cabochons/ajour/releases/tag/v1.0.1",
        publishedAt: "2026-10-18T12:00:00Z",
        updateAvailable: true,
        checkedAt: "2026-10-19T12:00:00Z",
      };
      let state: DesktopUpdateState = {
        status: initial === "idle" ? "idle" : "available",
        track: "stable",
        result: initial === "idle" ? null : candidate,
        error: null,
        progress: null,
        canInstall: initial !== "manual-install",
      };
      const listeners = new Set<(state: DesktopUpdateState) => void>();
      const publish = (patch: Partial<DesktopUpdateState>) => {
        state = { ...state, ...patch };
        for (const callback of listeners) callback(state);
      };
      let finishCheck: ((state: DesktopUpdateState) => void) | undefined;
      let finishUpdate: ((state: DesktopUpdateState) => void) | undefined;
      window.headerUpdateFixture = {
        updates: 0,
        version: null,
        releases: [],
        finishCheck: (status) => {
          publish({
            status:
              status === "available"
                ? "available"
                : status === "error"
                  ? "error"
                  : "up-to-date",
            result: { ...candidate, updateAvailable: status === "available" },
            error: status === "error" ? "Update check failed. Offline." : null,
          });
          finishCheck?.(state);
        },
        cancelUpdate: () => {
          publish({ status: "available" });
          finishUpdate?.(state);
        },
        acceptUpdate: () => publish({ status: "downloading", progress: 0 }),
        progress: (progress) => publish({ status: "downloading", progress }),
        install: () => publish({ status: "installing", progress: 100 }),
      };
      window.ajourDesktop = {
        runtime: {
          version: "1.0.0",
          platform: "win32",
          automaticUpdatesEnabled: state.canInstall,
          developmentBuild: false,
        },
        configureAutomaticUpdates: async () => {},
        getUpdateState: async () => state,
        onUpdateStateChanged: (callback) => {
          listeners.add(callback);
          return () => {
            listeners.delete(callback);
          };
        },
        checkForUpdates: async () => {
          publish({ status: "checking" });
          return await new Promise<DesktopUpdateState>((resolve) => {
            finishCheck = resolve;
          });
        },
        updateAndRestart: async (_track, version) => {
          window.headerUpdateFixture.updates += 1;
          window.headerUpdateFixture.version = version;
          publish({ status: "confirming" });
          return await new Promise<DesktopUpdateState>((resolve) => {
            finishUpdate = resolve;
          });
        },
        openUpdateRelease: async (url) => {
          window.headerUpdateFixture.releases.push(url);
        },
      };
    }, initial);
    await page.goto("/time/2026-10-05");
  },
);

function updateButton(page: import("@playwright/test").Page) {
  return page
    .getByRole("navigation", { name: "Settings sections" })
    .locator("[data-app-update]");
}

When("I click the update button", async ({ page }) => {
  await updateButton(page).click();
});
Then("the update button is disabled", async ({ page }) => {
  await expect(updateButton(page)).toBeDisabled();
});
When("the desktop check returns {string}", async ({ page }, status: string) => {
  await expect(updateButton(page)).toHaveAccessibleName(
    /^Checking(?: for updates)?$/,
  );
  await expect(updateButton(page)).toBeDisabled();
  await page.evaluate(
    (status) => window.headerUpdateFixture.finishCheck(status),
    status,
  );
});
Then("the update button offers Ajour 1.0.1", async ({ page }) => {
  await expect(updateButton(page)).toHaveAccessibleName(
    "Update to Ajour 1.0.1",
  );
  await expect(updateButton(page)).toBeEnabled();
  await page.mouse.move(0, 0);
  await updateButton(page).hover();
  await expect(
    page.locator('[data-slot="tooltip-content"][data-open]'),
  ).toContainText("Update to Ajour 1.0.1");
});
Then("the desktop has received no update request", async ({ page }) => {
  expect(await page.evaluate(() => window.headerUpdateFixture.updates)).toBe(0);
});
Then(
  "the desktop receives a request to confirm updating to 1.0.1",
  async ({ page }) => {
    expect(
      await page.evaluate(() => ({
        count: window.headerUpdateFixture.updates,
        version: window.headerUpdateFixture.version,
      })),
    ).toEqual({ count: 1, version: "1.0.1" });
  },
);
When("I cancel the desktop update warning", async ({ page }) => {
  await page.evaluate(() => window.headerUpdateFixture.cancelUpdate());
});
Then("the update button says the check failed", async ({ page }) => {
  await expect(updateButton(page)).toHaveAccessibleName(
    /Update check failed.*Check for updates again/,
  );
  await expect(updateButton(page)).toBeEnabled();
});
Then("the update button says Ajour is up to date", async ({ page }) => {
  await expect(updateButton(page)).toHaveAccessibleName(/Ajour is up to date/);
});
Then("Settings offers Update and restart", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Update and restart", exact: true }),
  ).toBeEnabled();
});
When("I choose Update and restart in Settings", async ({ page }) => {
  await page
    .getByRole("button", { name: "Update and restart", exact: true })
    .click();
  await expect(
    page
      .locator(".settings-content")
      .getByRole("status")
      .filter({ hasText: "Waiting for update confirmation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update and restart", exact: true }),
  ).toBeDisabled();
});
When("I accept the desktop update warning", async ({ page }) => {
  await page.evaluate(() => window.headerUpdateFixture.acceptUpdate());
});
When(
  "the desktop reports download progress of {int} percent",
  async ({ page }, progress: number) => {
    await page.evaluate(
      (progress) => window.headerUpdateFixture.progress(progress),
      progress,
    );
  },
);
Then("Settings shows the download progress", async ({ page }) => {
  await expect(
    page
      .locator(".settings-content")
      .getByRole("status")
      .filter({ hasText: "Downloading Ajour update, 42%" }),
  ).toBeVisible();
});
Then("Settings disables Check again", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Check again", exact: true }),
  ).toBeDisabled();
});
Then("Settings allows update track changes", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Use stable updates" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Use nightly updates" }),
  ).toBeEnabled();
});
When("the desktop starts installing the update", async ({ page }) => {
  await page.evaluate(() => window.headerUpdateFixture.install());
});
Then("Settings disables update track changes", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Use stable updates" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Use nightly updates" }),
  ).toBeDisabled();
});
Then(
  "the desktop opens the release page without an update request",
  async ({ page }) => {
    expect(
      await page.evaluate(() => window.headerUpdateFixture.releases),
    ).toEqual(["https://github.com/les-cabochons/ajour/releases/tag/v1.0.1"]);
    expect(await page.evaluate(() => window.headerUpdateFixture.updates)).toBe(
      0,
    );
  },
);
Then(
  "the Settings window shows Ajour 1.0.0 beside the update button",
  async ({ page }) => {
    const foot = page
      .getByRole("navigation", { name: "Settings sections" })
      .locator("[data-app-version]");
    await expect(foot).toContainText(/Ajour\s+1\.0\.0/);
    const version = await foot.boundingBox();
    const update = await updateButton(page).boundingBox();
    // One row, the button at its end.
    expect(update!.y).toBeGreaterThanOrEqual(version!.y);
    expect(update!.y + update!.height).toBeLessThanOrEqual(
      version!.y + version!.height,
    );
    expect(
      version!.x + version!.width - (update!.x + update!.width),
    ).toBeLessThan(12);
  },
);
