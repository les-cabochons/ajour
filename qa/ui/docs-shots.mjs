// Takes the screenshots of the docs site, in light and dark, from a
// production build of the web app on the seeded workspace. The app API
// and the desktop bridge are mocked, so the official plugins show as
// installed and connected. Output: apps/docs/public/shots/<name>-<theme>.webp,
// encoded by Chromium, about a fifth of the PNG size.
//
// Run with `just docs-shots`. Pass shot names to take only those:
// `just docs-shots time-day backlog-list`.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  NOW,
  calendarEvents,
  desktopBridgeScript,
  itemComments,
  itemPeople,
  mcpSettings,
  pluginsOverview,
  pullRequestsScript,
  quietEventSourceScript,
  rememberedScript,
  settleStates,
  sourceStatuses,
  stagedImports,
} from "./docs-fixtures.mjs";
import { seedScript } from "./seed.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.join(repoRoot, "apps/docs/public/shots");
const HOST = "127.0.0.1";
const PORT = Number(process.env.AJOUR_DOCS_SHOTS_PORT ?? 4196);
const BASE_URL = `http://${HOST}:${PORT}`;
const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 390, height: 780 };

/** The mocked internal API, keyed by path. Anything else answers 404. */
const api = {
  "/api/plugins": pluginsOverview,
  "/api/backlog/imports": stagedImports,
  "/api/backlog/source-statuses": sourceStatuses,
  "/api/mcp/settings": () => mcpSettings(false),
  "/api/project-data-shapes": () => ({ shapes: [] }),
  "/api/backlog-comments/azure_devops/connections/ado-work/listItemComments":
    itemComments,
  "/api/backlog-comments/azure_devops/connections/ado-work/searchItemPeople":
    itemPeople,
  "/api/calendars/ics/connections/ics-work/listCalendarEvents": calendarEvents,
};

/** Connects the ICS calendar plugin, for the calendar shots. */
const withCalendar = {
  "/api/plugins": () => pluginsOverview({ calendar: true }),
};

/** Opens the Calendar panel from the Time page header. */
async function openCalendarPanel(page) {
  await page
    .getByRole("button", { name: /^Calendar( · \d+)?$/ })
    .first()
    .click();
}

async function go(page, route) {
  await page.goto(BASE_URL + route, { waitUntil: "networkidle" });
}

/** Scrolls the page so the element sits at the top of the window. */
async function scrollToTop(locator) {
  await locator
    .first()
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
}

/**
 * Every shot. `run` opens the surface and may return a locator: the shot is
 * then cropped to it, with `margin` around it and `marginBottom` below it.
 * `seed` passes options to seed.mjs, and `api` replaces mocked API responses.
 */
const shots = [
  // Time
  { name: "time-day", run: (page) => go(page, "/time/today") },
  { name: "time-week-grid", run: (page) => go(page, "/time/today?view=week") },
  {
    name: "time-week-days",
    seed: { weekStyle: "days" },
    run: (page) => go(page, "/time/today?view=week"),
  },
  {
    name: "time-entry-editor",
    run: async (page) => {
      await go(page, "/time/today");
      await page.getByRole("row").nth(2).dblclick();
    },
  },
  {
    name: "time-new-entry",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: "Create time entry" })
        .first()
        .click();
      return page.getByRole("dialog");
    },
  },
  {
    name: "timer-dock",
    run: async (page) => {
      await go(page, "/time/today");
      return page.getByRole("region", { name: "Running entry" });
    },
    margin: 12,
  },
  {
    name: "timer-dock-editor",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: "Edit the running entry" })
        .click();
      return page.getByRole("dialog");
    },
  },
  {
    name: "time-entry-menu",
    run: async (page) => {
      await go(page, "/time/today");
      await page.getByRole("row").nth(2).click({ button: "right" });
      return page.getByRole("menu");
    },
  },
  { name: "commit-week", run: (page) => go(page, "/time/today/commit") },
  // Calendar suggestions
  {
    name: "time-calendar-day",
    api: withCalendar,
    run: (page) => go(page, "/time/today"),
  },
  {
    name: "time-calendar-panel",
    api: withCalendar,
    run: async (page) => {
      await go(page, "/time/today");
      await openCalendarPanel(page);
    },
  },
  {
    name: "time-calendar-week-days",
    api: withCalendar,
    seed: { weekStyle: "days" },
    run: (page) => go(page, "/time/today?view=week"),
  },
  // Backlog
  { name: "backlog-list", run: (page) => go(page, "/backlog") },
  {
    name: "backlog-board",
    seed: { backlogLayout: "board" },
    run: (page) => go(page, "/backlog"),
  },
  {
    name: "backlog-display",
    run: async (page) => {
      await go(page, "/backlog");
      await page.getByRole("button", { name: "Display" }).click();
      return page.getByRole("dialog");
    },
  },
  {
    name: "backlog-filter",
    run: async (page) => {
      await go(page, "/backlog");
      await page.getByRole("button", { name: "Filter", exact: true }).click();
      return page.getByRole("dialog");
    },
  },
  {
    name: "backlog-peek",
    run: async (page) => {
      await go(page, "/backlog");
      // A click opens the item page; Space on a focused row opens the peek.
      await page
        .locator(".ajour-app-workspace")
        .getByText("Week grid: keyboard editing of cells", { exact: true })
        .first()
        .locator("xpath=ancestor::*[@tabindex][1]")
        .focus();
      await page.keyboard.press("Space");
    },
  },
  { name: "backlog-item", run: (page) => go(page, "/backlog/w2") },
  {
    name: "backlog-comments",
    // Tall enough that the whole thread shows above the comment field.
    height: 1200,
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page.getByRole("button", { name: "Leave a comment…" }).click();
      // Type only once the editor has focus, or the keys reach the page.
      const editor = page.getByRole("textbox", { name: "New comment" });
      await editor.click();
      await editor.pressSequentially("On it with @jo");
      await page.getByRole("option", { name: /Joanna Brooks/ }).waitFor();
      return page.getByRole("region", { name: "Comments" });
    },
    // Room for the people picker, which hangs below the comment field.
    marginBottom: 72,
  },
  {
    name: "backlog-item-menu",
    run: async (page) => {
      await go(page, "/backlog");
      await page
        .locator(".ajour-app-workspace")
        .getByText("Fix export rounding on half-hour entries")
        .click({ button: "right" });
      return page.getByRole("menu");
    },
  },
  {
    name: "backlog-settle",
    run: async (page) => {
      await go(page, "/backlog/w1");
      await page
        .getByRole("button", { name: "Settle", exact: true })
        .first()
        .click({ modifiers: ["Shift"] });
      return page.getByRole("dialog");
    },
  },
  {
    name: "backlog-snooze",
    run: async (page) => {
      await go(page, "/backlog/w1");
      await page
        .getByRole("button", { name: "Snooze", exact: true })
        .first()
        .click();
      return page.getByRole("dialog");
    },
  },
  // Sidebar
  {
    name: "sidebar",
    run: async (page) => {
      await go(page, "/time/today");
      return page.locator(".ajour-app-navigation-sidebar").first();
    },
    margin: 0,
  },
  {
    name: "sidebar-view-switcher",
    run: async (page) => {
      await go(page, "/time/today");
      await page.getByRole("button", { name: /^Time/ }).first().click();
      return page.getByRole("menu");
    },
  },
  // Pull requests
  { name: "pull-requests", run: (page) => go(page, "/pull-requests") },
  // Projects
  { name: "projects-list", run: (page) => go(page, "/projects") },
  { name: "project-page", run: (page) => go(page, "/projects/p-atlas") },
  {
    name: "project-form",
    run: async (page) => {
      await go(page, "/projects");
      await page.getByRole("button", { name: "New project" }).click();
      return page.getByRole("dialog");
    },
  },
  {
    name: "project-task-editor",
    run: async (page) => {
      await go(page, "/projects/p-atlas");
      await page.getByText("Development", { exact: true }).first().click();
    },
  },
  // Settings
  ...[
    "general",
    "plugins",
    "mcp",
    "backlog",
    "workflow",
    "projects",
    "calendar",
    "time-entries",
    "sync-review",
  ].map((settingsPage) => ({
    name: `settings-${settingsPage}`,
    run: (page) => go(page, `/settings/${settingsPage}`),
    api: {
      mcp: { "/api/mcp/settings": mcpSettings },
      calendar: withCalendar,
    }[settingsPage],
  })),
  {
    name: "settings-plugin-azure-devops",
    run: (page) => go(page, "/settings/plugins/azure_devops"),
  },
  {
    name: "settings-plugin-connections",
    run: async (page) => {
      await go(page, "/settings/plugins/azure_devops");
      await scrollToTop(page.getByRole("heading", { name: "Configuration" }));
    },
  },
  {
    name: "settings-plugin-connection-form",
    run: async (page) => {
      await go(page, "/settings/plugins/azure_devops");
      await page.getByRole("button", { name: "Edit" }).first().click();
      await scrollToTop(page.getByText("Edit Azure DevOps connection"));
    },
  },
  // Anywhere
  {
    name: "command-palette",
    run: async (page) => {
      await go(page, "/time/today");
      await page.keyboard.press("ControlOrMeta+k");
      return page.getByRole("dialog");
    },
  },
  {
    name: "shortcuts",
    run: async (page) => {
      await go(page, "/time/today");
      await page.keyboard.press("?");
      return page.getByRole("dialog");
    },
  },
  {
    name: "empty-workspace",
    seed: { empty: true },
    run: (page) => go(page, "/time/today"),
  },
  {
    name: "narrow-time",
    viewport: NARROW,
    run: (page) => go(page, "/time/today"),
  },
  {
    name: "narrow-backlog",
    viewport: NARROW,
    run: (page) => go(page, "/backlog"),
  },
];

function buildWebApp() {
  console.log("Building the web app");
  const result = spawnSync(
    "corepack",
    ["pnpm", "--filter", "@ajour/web", "build"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) throw new Error("The web build failed.");
}

async function startPreview() {
  const child = spawn(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@ajour/web",
      "exec",
      "vite",
      "preview",
      "--host",
      HOST,
      "--port",
      String(PORT),
      "--strictPort",
    ],
    // Its own process group, so stopping it also stops vite under corepack.
    {
      cwd: repoRoot,
      stdio: "ignore",
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
    },
  );
  const stop = () => {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE_URL)).ok) return stop;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  stop();
  throw new Error(
    `The preview server did not start on ${BASE_URL}. Is the port taken?`,
  );
}

/** Encodes a PNG screenshot as WebP in the browser, so no image tool is needed. */
async function toWebp(encoder, png) {
  const base64 = await encoder.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.9).split(",")[1];
  }, png.toString("base64"));
  return Buffer.from(base64, "base64");
}

async function capture(browser, encoder, shot, theme) {
  const viewport = shot.viewport ?? {
    ...WIDE,
    height: shot.height ?? WIDE.height,
  };
  const context = await browser.newContext({
    viewport,
    colorScheme: theme,
    deviceScaleFactor: 2,
  });
  await context.route("http://127.0.0.1:8787/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const handler =
      shot.api?.[pathname] ??
      api[pathname] ??
      (pathname.endsWith("/settle-states") ? settleStates : undefined);
    return route.fulfill({
      status: handler ? 200 : 404,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(handler ? handler() : { error: "Not mocked" }),
    });
  });
  await context.clock.setSystemTime(NOW);
  // One script, because Playwright runs several init scripts in no set
  // order, and the later parts read the workspace the seed writes.
  await context.addInitScript(
    [
      seedScript({ ...shot.seed, theme, now: NOW }),
      pullRequestsScript(),
      rememberedScript(),
      desktopBridgeScript(),
      quietEventSourceScript(),
    ].join("\n;\n"),
  );
  const page = await context.newPage();
  const file = path.join(OUT, `${shot.name}-${theme}.webp`);
  let png;
  try {
    const target = await shot.run(page);
    await page.mouse.move(viewport.width - 2, viewport.height - 2);
    await page.waitForTimeout(500);
    if (target) {
      const box = await target.first().boundingBox();
      if (!box) throw new Error("The element to crop to is not visible.");
      const margin = shot.margin ?? 24;
      const below = shot.marginBottom ?? margin;
      const x = Math.max(0, box.x - margin);
      const y = Math.max(0, box.y - margin);
      png = await page.screenshot({
        clip: {
          x,
          y,
          width: Math.min(viewport.width - x, box.width + margin * 2),
          height: Math.min(viewport.height - y, box.height + margin + below),
        },
      });
    } else {
      png = await page.screenshot();
    }
    fs.writeFileSync(file, await toWebp(encoder, png));
    return true;
  } catch (error) {
    console.error(`[${shot.name} ${theme}]`, error.message.split("\n")[0]);
    await page
      .screenshot({ path: path.join(OUT, `${shot.name}-${theme}.ERROR.png`) })
      .catch(() => {});
    return false;
  } finally {
    await context.close();
  }
}

const only = process.argv.slice(2);
const selected = only.length
  ? shots.filter((shot) => only.includes(shot.name))
  : shots;
if (!selected.length) throw new Error(`No shot named ${only.join(", ")}.`);

fs.mkdirSync(OUT, { recursive: true });
if (!process.env.AJOUR_DOCS_SHOTS_SKIP_BUILD) buildWebApp();
const stopPreview = await startPreview();
const browser = await chromium.launch();
const encoder = await browser.newPage();
let failures = 0;
for (const shot of selected) {
  for (const theme of ["light", "dark"]) {
    if (!(await capture(browser, encoder, shot, theme))) failures += 1;
  }
}
await browser.close();
stopPreview();
console.log(failures ? `${failures} shots failed: ${OUT}` : `done: ${OUT}`);
process.exit(failures ? 1 : 0);
