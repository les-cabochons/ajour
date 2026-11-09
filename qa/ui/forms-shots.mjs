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
  "/api/plugins": () => withSavedSecrets(pluginsOverview({ calendar: true })),
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

/**
 * Gives every connection a saved secret for each secret field, as a working
 * connection has, so the forms show the Saved state, not "Not set".
 */
function withSavedSecrets(overview) {
  for (const group of overview.connectionGroups ?? []) {
    const secretIds = (group.plugin.connectionFields ?? [])
      .filter((field) => field.secret)
      .map((field) => field.id);
    for (const connection of group.connections ?? []) {
      // A saved connection's form shows its own label and tenant.
      connection.editableValues = {
        label: connection.label,
        tenantLabel: connection.tenantLabel,
        ...connection.editableValues,
      };
      connection.secretFields ??= secretIds.map((id) => ({
        id,
        state: "saved",
        setAt: NOW - 20 * 86_400_000,
        lastUsedAt: NOW - 2 * 3_600_000,
      }));
    }
  }
  return overview;
}

/** Opens a route and waits for its lazily loaded page to mount. */
async function go(page, route) {
  await page.goto(BASE_URL + route, { waitUntil: "networkidle" });
  await page.locator("main").first().waitFor();
  await page.waitForTimeout(400);
}
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
  // Whole pages, for the narrow layout above all.
  { name: "page-backlog", run: (page) => go(page, "/backlog") },
  {
    name: "page-backlog-item",
    full: true,
    run: (page) => go(page, "/backlog/w2"),
  },
  {
    name: "page-backlog-synced-item",
    full: true,
    run: (page) => go(page, "/backlog/w1"),
  },
  { name: "page-time-day", run: (page) => go(page, "/time/today") },
  {
    name: "page-time-week",
    run: (page) => go(page, "/time/today?view=week"),
  },
  { name: "page-projects", run: (page) => go(page, "/projects") },
  {
    name: "page-project",
    full: true,
    run: (page) => go(page, "/projects/p-atlas"),
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
  // Time
  {
    name: "time-new-entry-start",
    seed: { running: false },
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: "Create time entry" })
        .first()
        .click();
    },
  },
  {
    name: "time-create-task",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: "Create time entry" })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Project or task" })
        .first()
        .click();
      await page.getByPlaceholder(/^Search .*\.\.\.$/).fill("Planning");
      await page
        .getByRole("option", { name: /^Create task/ })
        .first()
        .click();
    },
  },
  {
    name: "time-day-new-entry",
    run: async (page) => {
      await go(page, "/time/today");
      await page.getByRole("button", { name: "New entry" }).first().click();
    },
  },
  {
    name: "time-entry-narrow-dialog",
    viewport: { width: 700, height: 900 },
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: "Create time entry" })
        .first()
        .click();
    },
  },
  {
    name: "time-move-entry",
    run: async (page) => {
      await go(page, "/time/today");
      await page.getByText("Standup").first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to…" }).click();
    },
  },
  {
    name: "time-date-picker",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: /^Select time entry date/ })
        .first()
        .click();
    },
  },
  {
    name: "week-cell-input",
    run: async (page) => {
      await go(page, "/time/today?view=week");
      await page
        .getByRole("button", { name: /^Code review, Tuesday/ })
        .first()
        .dblclick();
    },
  },
  {
    name: "week-cell-panel",
    run: async (page) => {
      await go(page, "/time/today?view=week");
      await page
        .getByRole("button", { name: /^Development, Thursday/ })
        .first()
        .click();
    },
  },
  {
    name: "week-add-row",
    run: async (page) => {
      await go(page, "/time/today?view=week");
      await page.getByRole("button", { name: "Add row" }).first().click();
    },
  },
  {
    name: "week-delete-row",
    run: async (page) => {
      await go(page, "/time/today?view=week");
      await page
        .getByRole("button", { name: /^Code review, Tuesday/ })
        .first()
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete row" }).click();
    },
  },
  {
    name: "calendar-panel",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: /^Calendar( · \d+)?$/ })
        .first()
        .click();
      await page.waitForTimeout(400);
      const boxes = page.getByRole("checkbox", { name: /^Add / });
      // Ticks the first suggestion that has a project.
      if ((await boxes.count()) > 0) await boxes.first().click();
    },
  },
  {
    name: "calendar-choose-project",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: "Meeting actions" })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Choose project…" }).click();
    },
  },
  {
    name: "commit-page",
    full: true,
    run: (page) => go(page, "/time/today/commit"),
  },
  // Backlog
  {
    name: "backlog-new-in-group",
    run: async (page) => {
      await go(page, "/backlog");
      await page
        .getByRole("button", { name: /^New item in / })
        .first()
        .click();
    },
  },
  {
    name: "backlog-edit-item",
    run: async (page) => {
      await go(page, "/backlog");
      // A click selects the row; Space opens its peek.
      await page
        .locator("[data-work-item-id=w2] .backlog-item-title")
        .first()
        .click();
      await page.keyboard.press("Space");
      await page
        .getByRole("complementary", { name: "Backlog item peek" })
        .getByRole("button", { name: "Edit", exact: true })
        .first()
        .click();
    },
  },
  {
    name: "backlog-subitem-dialog",
    run: async (page) => {
      await go(page, "/backlog");
      await page
        .locator("[data-work-item-id=w2]")
        .first()
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Add subitem" }).click();
    },
  },
  {
    name: "backlog-inline-subitem",
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page.getByRole("button", { name: "Add subitem" }).first().click();
    },
  },
  {
    name: "backlog-inline-title",
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page.locator("h1").first().click();
    },
  },
  {
    name: "backlog-inline-estimate",
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page
        .getByRole("button", { name: /^Edit remaining estimate/ })
        .first()
        .click();
    },
  },
  {
    name: "backlog-inline-description",
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page
        .getByRole("button", { name: /^(Edit|Add description)$/ })
        .first()
        .click();
    },
  },
  {
    name: "backlog-state-picker",
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page
        .getByRole("button", { name: /^Change state of / })
        .first()
        .click();
    },
  },
  {
    name: "backlog-comment-composer",
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page.getByRole("button", { name: "Leave a comment…" }).click();
    },
  },
  {
    name: "backlog-settle-archive",
    run: async (page) => {
      await go(page, "/backlog/w1");
      await page
        .getByRole("button", { name: "Settle", exact: true })
        .first()
        .click({ modifiers: ["Shift"] });
      await dialog(page).getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Closed" }).first().click();
    },
  },
  {
    name: "backlog-settle-subitems",
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page
        .getByRole("button", { name: "Settle", exact: true })
        .first()
        .click({ modifiers: ["Shift"] });
    },
  },
  {
    name: "backlog-close-subitems",
    run: async (page) => {
      await go(page, "/backlog/w2");
      await page
        .getByRole("button", { name: /^Change state of / })
        .first()
        .click();
      await page.getByText("Done", { exact: true }).last().click();
    },
  },
  {
    name: "backlog-multi-select",
    run: async (page) => {
      await go(page, "/backlog");
      const titles = page.locator(".backlog-workspace .backlog-item-title");
      await titles.nth(0).click();
      await titles.nth(2).click({ modifiers: ["Shift"] });
      await titles.nth(1).click({ button: "right" });
    },
  },
  {
    name: "backlog-display",
    run: async (page) => {
      await go(page, "/backlog");
      await page.getByRole("button", { name: "Display" }).click();
    },
  },
  {
    name: "backlog-filter",
    run: async (page) => {
      await go(page, "/backlog");
      await page.getByRole("button", { name: "Filter", exact: true }).click();
    },
  },
  // Projects
  {
    name: "project-form-icon-popover",
    run: async (page) => {
      await go(page, "/projects");
      await page.getByRole("button", { name: "New project" }).click();
      await page.getByRole("button", { name: /^Project icon:/ }).click();
    },
  },
  {
    name: "project-inline-full-name",
    run: async (page) => {
      await go(page, "/projects/p-atlas");
      await page
        .getByRole("button", { name: "Edit full name, Atlas platform" })
        .click();
    },
  },
  {
    name: "project-task-new",
    run: async (page) => {
      await go(page, "/projects/p-atlas");
      await page.getByRole("button", { name: "New task", exact: true }).click();
    },
  },
  {
    name: "project-assign-shortcut",
    run: async (page) => {
      await go(page, "/projects/p-atlas");
      await page
        .getByText("Development", { exact: true })
        .first()
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Assign shortcut…" }).click();
    },
  },
  // Global
  {
    name: "shortcuts-overlay",
    run: async (page) => {
      await go(page, "/time/today");
      await page.keyboard.press("?");
    },
  },
  {
    name: "sidebar-search",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("searchbox", { name: "Search the sidebar" })
        .first()
        .click();
    },
  },
  {
    name: "sidebar-filter",
    run: async (page) => {
      await go(page, "/time/today");
      await page
        .getByRole("button", { name: /^Filter and order/ })
        .first()
        .click();
    },
  },
  // Settings confirmations and menus
  {
    name: "plugin-remove-connection",
    run: async (page) => {
      await go(page, "/settings/plugins/github");
      await page
        .getByRole("button", { name: /^More actions for / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Remove" }).click();
    },
  },
  {
    name: "plugin-connection-menu",
    run: async (page) => {
      await go(page, "/settings/plugins/azure_devops");
      await page
        .getByRole("button", { name: /^More actions for / })
        .first()
        .click();
    },
  },
  {
    name: "plugin-uninstall",
    run: async (page) => {
      await go(page, "/settings/plugins/azure_devops");
      await page.getByRole("button", { name: "Uninstall" }).click();
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
  // AJOUR_FORMS_VIEWPORT=390x844 captures every shot at that size, for
  // the narrow (phone) layout.
  const forced = process.env.AJOUR_FORMS_VIEWPORT?.match(/^(\d+)x(\d+)$/);
  const viewport = forced
    ? { width: Number(forced[1]), height: Number(forced[2]) }
    : (shot.viewport ?? { width: 1440, height: 900 });
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
// A cold dev server compiles on the first visit: let that one take its time.
const warm = await browser.newPage();
await warm
  .goto(BASE_URL + "/settings/general", { timeout: 180_000 })
  .catch(() => {});
await warm.close();
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
