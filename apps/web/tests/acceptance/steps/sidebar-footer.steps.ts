import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import type { DesktopUpdateState } from "../../../src/lib/desktop-bridge";

declare global {
  interface Window {
    footerUpdateFixture: {
      updates: number;
      version: string | null;
      releases: string[];
      finishCheck: (status: string) => void;
      cancelUpdate: () => void;
      acceptUpdate: () => void;
      progress: (percent: number) => void;
    };
  }
}

const { Given, When, Then } = createBdd();

Given("I use the sidebar footer in the browser", async ({ page }) => {
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

When(
  "I open the footer's Commit button with the keyboard",
  async ({ page }) => {
    const link = page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("button", { name: "Commit week", exact: true });
    await link.focus();
    await link.press("Enter");
  },
);

Then("the footer opens Commit for {word}", async ({ page }, date: string) => {
  await expect(page).toHaveURL(new RegExp(`/time/${date}/commit(?:\\?.*)?$`));
});

When("I open Settings from the footer", async ({ page }) => {
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
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
  "the desktop footer has {string} update state",
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
      window.footerUpdateFixture = {
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
          window.footerUpdateFixture.updates += 1;
          window.footerUpdateFixture.version = version;
          publish({ status: "confirming" });
          return await new Promise<DesktopUpdateState>((resolve) => {
            finishUpdate = resolve;
          });
        },
        openUpdateRelease: async (url) => {
          window.footerUpdateFixture.releases.push(url);
        },
      };
    }, initial);
    await page.goto("/time/2026-10-05");
  },
);

function updateButton(page: import("@playwright/test").Page) {
  return page
    .getByRole("navigation", { name: "Primary navigation" })
    .locator('[data-slot="sidebar-footer"]')
    .locator('button[aria-label]:not([aria-label="Commit week"])');
}

When("I click the footer update button", async ({ page }) => {
  await updateButton(page).click();
});
Then("the footer update button is disabled", async ({ page }) => {
  await expect(updateButton(page)).toBeDisabled();
});
When("the desktop check returns {string}", async ({ page }, status: string) => {
  await expect(
    page.getByRole("button", { name: /^Checking(?: for updates)?$/ }),
  ).toBeDisabled();
  await page.evaluate(
    (status) => window.footerUpdateFixture.finishCheck(status),
    status,
  );
});
Then("the footer offers Ajour 1.0.1", async ({ page }) => {
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
  expect(await page.evaluate(() => window.footerUpdateFixture.updates)).toBe(0);
});
Then(
  "the desktop receives a request to confirm updating to 1.0.1",
  async ({ page }) => {
    expect(
      await page.evaluate(() => ({
        count: window.footerUpdateFixture.updates,
        version: window.footerUpdateFixture.version,
      })),
    ).toEqual({ count: 1, version: "1.0.1" });
  },
);
When("I cancel the desktop update warning", async ({ page }) => {
  await page.evaluate(() => window.footerUpdateFixture.cancelUpdate());
});
Then("the footer update button says the check failed", async ({ page }) => {
  await expect(updateButton(page)).toHaveAccessibleName(
    /Update check failed.*Check for updates again/,
  );
  await expect(updateButton(page)).toBeEnabled();
});
Then("the footer says Ajour is up to date", async ({ page }) => {
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
      .getByRole("status")
      .filter({ hasText: "Waiting for update confirmation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update and restart", exact: true }),
  ).toBeDisabled();
});
When("I accept the desktop update warning", async ({ page }) => {
  await page.evaluate(() => window.footerUpdateFixture.acceptUpdate());
});
When(
  "the desktop reports download progress of {int} percent",
  async ({ page }, progress: number) => {
    await page.evaluate(
      (progress) => window.footerUpdateFixture.progress(progress),
      progress,
    );
  },
);
Then("Settings shows the download progress", async ({ page }) => {
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Downloading Ajour update, 42%" }),
  ).toBeVisible();
});
Then("Settings disables Check again", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: "Check again", exact: true }),
  ).toBeDisabled();
});
Then(
  "the desktop opens the release page without an update request",
  async ({ page }) => {
    expect(
      await page.evaluate(() => window.footerUpdateFixture.releases),
    ).toEqual(["https://github.com/les-cabochons/ajour/releases/tag/v1.0.1"]);
    expect(await page.evaluate(() => window.footerUpdateFixture.updates)).toBe(
      0,
    );
  },
);
Then("the footer actions stay at opposite ends", async ({ page }) => {
  const footer = page.locator('[data-slot="sidebar-footer"]');
  const settings = await footer
    .getByRole("link", { name: "Settings", exact: true })
    .boundingBox();
  const commit = await footer
    .getByRole("button", { name: "Commit week", exact: true })
    .boundingBox();
  const update = await updateButton(page).boundingBox();
  expect(settings!.x + settings!.width).toBeLessThanOrEqual(commit!.x);
  expect(commit!.x + commit!.width + 50).toBeLessThan(update!.x);
  expect(settings!.y).toBe(update!.y);
});
