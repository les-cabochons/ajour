// Screenshots every settings page, plugin page, connection form and dialog,
// on the seeded workspace with Azure DevOps, Jira and GitHub connected.
// Uses a dev server on AJOUR_FORMS_PORT (default 4310) if one runs.
// Output: AJOUR_FORMS_OUT (default qa/ui/out/forms)/<theme>-<name>.png.
// Pass shot names to take only those.
import { spawn } from "node:child_process";
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
const OUT = path.resolve(
  process.env.AJOUR_FORMS_OUT ?? path.join(repoRoot, "qa/ui/out/forms"),
);
const HOST = "127.0.0.1";
const PORT = Number(process.env.AJOUR_FORMS_PORT ?? 4310);
const BASE_URL = `http://${HOST}:${PORT}`;
const THEMES = (process.env.AJOUR_FORMS_THEMES ?? "dark").split(",");

const api = {
  "/api/plugins": () => pluginsOverview({ calendar: true }),
  "/api/backlog/imports": stagedImports,
  "/api/backlog/source-statuses": sourceStatuses,
  "/api/mcp/settings": mcpSettings,
  "/api/project-data-shapes": () => ({ shapes: [] }),
  "/api/backlog-comments/azure_devops/connections/ado-work/listItemComments":
    itemComments,
  "/api/backlog-comments/azure_devops/connections/ado-work/searchItemPeople":
    itemPeople,
  "/api/calendars/ics/connections/ics-work/listCalendarEvents": calendarEvents,
};

const go = (page, route) =>
  page.goto(BASE_URL + route, { waitUntil: "networkidle" });
const dialog = (page) => page.getByRole("dialog").last();

async function editConnection(page, pluginId) {
  await go(page, `/settings/plugins/${pluginId}`);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.waitForTimeout(300);
}

const shots = [
  ...[
    "general",
    "plugins",
    "vault",
    "mcp",
    "agents",
    "backlog",
    "workflow",
    "projects",
    "calendar",
    "time-entries",
    "sync-review",
  ].map((name) => ({
    name: `settings-${name}`,
    full: true,
    run: (page) => go(page, `/settings/${name}`),
  })),
  ...["azure_devops", "jira", "github", "ics"].flatMap((id) => [
    {
      name: `plugin-${id}`,
      full: true,
      run: (page) => go(page, `/settings/plugins/${id}`),
    },
    {
      name: `plugin-${id}-edit-connection`,
      full: true,
      run: (page) => editConnection(page, id),
    },
  ]),
  {
    name: "plugin-azure_devops-add-connection",
    full: true,
    run: async (page) => {
      await go(page, "/settings/plugins/azure_devops");
      await page
        .getByRole("button", { name: /Add a connection|Add connection/ })
        .first()
        .click();
    },
  },
  {
    name: "project-form",
    run: async (page) => {
      await go(page, "/projects");
      await page.getByRole("button", { name: "New project" }).click();
    },
  },
  {
    name: "new-backlog-item",
    run: async (page) => {
      await go(page, "/backlog");
      await page
        .getByRole("button", { name: "New backlog item" })
        .first()
        .click();
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
    },
  },
  {
    name: "time-entry-editor",
    run: async (page) => {
      await go(page, "/time/today");
      await page.getByRole("row").nth(2).dblclick();
    },
  },
  {
    name: "timer-dock-editor",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: "Edit the running entry" })
        .click();
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
    },
  },
  {
    name: "project-task-editor",
    run: async (page) => {
      await go(page, "/projects/p-atlas");
      await page.getByText("Development", { exact: true }).first().click();
    },
  },
  {
    name: "command-palette",
    run: async (page) => {
      await go(page, "/time/today");
      await page.keyboard.press("ControlOrMeta+k");
    },
  },
];

async function isUp() {
  try {
    return (await fetch(BASE_URL, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isUp()) return () => {};
  const child = spawn(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@ajour/web",
      "dev",
      "--host",
      HOST,
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { cwd: repoRoot, stdio: "ignore", shell: process.platform === "win32" },
  );
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(await isUp())) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!(await isUp())) throw new Error(`No dev server on ${BASE_URL}.`);
  return () => {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else child.kill("SIGTERM");
  };
}

async function capture(browser, shot, theme) {
  const viewport = { width: 1440, height: 900 };
  const context = await browser.newContext({
    viewport,
    colorScheme: theme,
    deviceScaleFactor: 1,
  });
  await context.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const handler =
        api[pathname] ??
        (pathname.endsWith("/settle-states") ? settleStates : undefined);
      return route.fulfill({
        status: handler ? 200 : 404,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(handler ? handler() : { error: "Not mocked" }),
      });
    },
  );
  await context.clock.setSystemTime(NOW);
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
  const file = path.join(OUT, `${theme}-${shot.name}.png`);
  try {
    await shot.run(page);
    await page.mouse.move(viewport.width - 2, viewport.height - 2);
    // The dev server's router devtools button is not part of the app.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll("button, footer, div")) {
        if (element.textContent?.trim() === "TanStack Router") {
          (element.closest(".TanStackRouterDevtools") ?? element).remove();
        }
      }
    });
    await page.waitForTimeout(500);
    if (shot.full) {
      // The settings pane scrolls, not the page: grow the window to fit it.
      const height = await page.evaluate(() => {
        let tallest = document.documentElement.scrollHeight;
        for (const element of document.querySelectorAll("*")) {
          const style = getComputedStyle(element);
          if (
            /(auto|scroll)/.test(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 4
          ) {
            tallest = Math.max(
              tallest,
              element.scrollHeight + element.getBoundingClientRect().top + 40,
            );
          }
        }
        return Math.min(Math.ceil(tallest), 6000);
      });
      if (height > viewport.height) {
        await page.setViewportSize({ width: viewport.width, height });
        await page.waitForTimeout(300);
      }
    }
    await page.screenshot({ path: file });
    return true;
  } catch (error) {
    console.error(`[${shot.name} ${theme}]`, error.message.split("\n")[0]);
    await page
      .screenshot({ path: path.join(OUT, `${theme}-${shot.name}.ERROR.png`) })
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
fs.mkdirSync(OUT, { recursive: true });
const stop = await ensureServer();
const browser = await chromium.launch();
let failures = 0;
for (const shot of selected) {
  for (const theme of THEMES) {
    if (!(await capture(browser, shot, theme))) failures += 1;
  }
}
await browser.close();
stop();
console.log(failures ? `${failures} shots failed: ${OUT}` : `done: ${OUT}`);
process.exit(failures ? 1 : 0);
