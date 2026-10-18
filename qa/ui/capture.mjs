// Screenshots every product surface on a seeded workspace: light and dark at
// 1440px, the 1000px overlay, the 420px narrow view, popovers and menus.
// Output: qa/ui/out/<name>-<label>.png. Run with `just ui-capture`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { emptyPluginsOverview, seedScript } from "./seed.mjs";
import { BASE_URL, ensureServer } from "./server.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "out");
fs.mkdirSync(OUT, { recursive: true });

const stopServer = await ensureServer();
const browser = await chromium.launch();
let failures = 0;

async function session(
  { name, width = 1440, height = 900, seed = {}, colorScheme = "light" },
  steps,
) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    deviceScaleFactor: 1,
  });
  await context.route("**/api/plugins", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(emptyPluginsOverview),
    }),
  );
  await context.addInitScript(seedScript(seed));
  const page = await context.newPage();
  const shot = async (label, { wait = 400 } = {}) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`) });
  };
  try {
    await steps(page, shot);
  } catch (error) {
    failures += 1;
    console.error(`[${name}]`, error.message);
    await page
      .screenshot({ path: path.join(OUT, `${name}-ERROR.png`) })
      .catch(() => {});
  }
  await context.close();
}

const go = (page, route) =>
  page.goto(BASE_URL + route, { waitUntil: "networkidle" });

await session({ name: "light" }, async (page, shot) => {
  await go(page, "/time/today");
  await shot("time-day");
  await page.getByRole("row").nth(2).dblclick();
  await shot("time-day-editor");
  await page.keyboard.press("Escape");
  await go(page, "/time/today?view=week");
  await shot("time-week-grid");
  await go(page, "/time/today/commit");
  await shot("commit");
  await go(page, "/backlog");
  await shot("backlog-list");
  await page
    .getByRole("button", { name: /Display/ })
    .first()
    .click()
    .catch(() => {});
  await shot("backlog-display-popover");
  await page.keyboard.press("Escape");
  await go(page, "/backlog/w2");
  await shot("backlog-item");
  await go(page, "/projects");
  await shot("projects-list");
  await go(page, "/projects/p-atlas");
  await shot("projects");
  await go(page, "/projects/archive");
  await shot("projects-archive");
  await go(page, "/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await shot("project-form");
  await page.getByRole("button", { name: /^Project color/ }).click();
  await shot("project-color-popover");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  for (const settingsPage of [
    "general",
    "plugins",
    "workflow",
    "backlog",
    "time-entries",
    "projects",
    "sync-review",
  ]) {
    await go(page, `/settings/${settingsPage}`);
    await shot(`settings-${settingsPage}`);
  }
  await go(page, "/time/today");
  await page.keyboard.press("Control+k");
  await shot("command-palette");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Create time entry" }).click();
  await shot("new-entry-popover");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit the running entry" }).click();
  await shot("dock-editor");
  await page.keyboard.press("Escape");
  await page.getByRole("row").nth(2).click({ button: "right" });
  await shot("row-context-menu");
  await page.keyboard.press("Escape");
  await page.keyboard.press("?");
  await shot("shortcuts-overlay");
});

await session(
  { name: "alt", seed: { backlogLayout: "board", weekStyle: "days" } },
  async (page, shot) => {
    await go(page, "/backlog");
    await shot("backlog-board");
    await go(page, "/time/today?view=week");
    await shot("time-week-days");
    await go(page, "/projects");
    await shot("projects-index");
  },
);

await session(
  { name: "hidden", seed: { sidebar: "hidden" } },
  async (page, shot) => {
    await go(page, "/time/today");
    await shot("time-day");
    await go(page, "/settings/general");
    await shot("settings");
  },
);

await session(
  { name: "dark", seed: { theme: "dark" }, colorScheme: "dark" },
  async (page, shot) => {
    for (const [route, label] of [
      ["/time/today", "time-day"],
      ["/time/today?view=week", "time-week-grid"],
      ["/backlog", "backlog-list"],
      ["/backlog/w2", "backlog-item"],
      ["/projects/p-atlas", "projects"],
      ["/settings/general", "settings-general"],
      ["/time/today/commit", "commit"],
    ]) {
      await go(page, route);
      await shot(label);
    }
  },
);

await session({ name: "mid", width: 1000, height: 760 }, async (page, shot) => {
  await go(page, "/time/today");
  await shot("time-day");
  await page.keyboard.press("Control+b");
  await shot("sidebar-overlay");
  await page.keyboard.press("Escape");
  await go(page, "/projects/p-atlas");
  await shot("projects");
});

await session(
  { name: "narrow", width: 420, height: 820 },
  async (page, shot) => {
    for (const [route, label] of [
      ["/time/today", "time-day"],
      ["/backlog", "backlog"],
      ["/backlog/w2", "backlog-item"],
      ["/projects", "projects"],
      ["/projects/p-atlas", "project"],
      ["/settings", "settings"],
      ["/settings/general", "settings-general"],
      ["/time/today/commit", "commit"],
    ]) {
      await go(page, route);
      await shot(label);
    }
  },
);

await session({ name: "empty", seed: { empty: true } }, async (page, shot) => {
  await go(page, "/time/today");
  await shot("time-day");
});

await browser.close();
stopServer();
console.log(
  failures ? `done with ${failures} failed sessions: ${OUT}` : `done: ${OUT}`,
);
process.exit(failures ? 1 : 0);
