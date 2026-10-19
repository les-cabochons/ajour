import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const acceptanceHost = "127.0.0.1";
const acceptancePort = Number(process.env.AJOUR_ACCEPTANCE_PORT ?? 4173);
const baseURL = `http://${acceptanceHost}:${acceptancePort}`;

const testDir = defineBddConfig({
  features: "tests/acceptance/features/**/*.feature",
  steps: "tests/acceptance/steps/**/*.ts",
});

export default defineConfig({
  testDir,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["line"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],
  webServer: {
    command: `just --set ACCEPTANCE_WEB_PORT ${acceptancePort} acceptance-server`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
