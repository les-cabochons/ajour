// Screenshot walkthrough for wayfinder ticket #9. Throwaway, lives outside the repo.
const { chromium } = require("/Users/a.trepanier/Repos/Personnal/ajour/node_modules/playwright");
const path = require("node:path");

const BASE = "http://127.0.0.1:5173";
const OUT = path.join(__dirname, "out");
const KEY = "timetracker.local-state.v2";
const WEEK = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const H = 3600000;
const log = [];

function seed(state, { running } = {}) {
  const now = Date.now();
  state.projects = [
    { _id: "p1", name: "Client Atlas", code: "ATL", color: "#2563eb", status: "active",
      tasks: [
        { _id: "t1", name: "Development", status: "active", createdAt: now, budgetMs: 80 * H },
        { _id: "t2", name: "Code review", status: "active", createdAt: now },
      ] },
    { _id: "p2", name: "Internal", color: "#16a34a", status: "active",
      tasks: [
        { _id: "t3", name: "Meetings", status: "active", createdAt: now },
        { _id: "t4", name: "Support", status: "active", createdAt: now },
      ] },
    { _id: "p3", name: "Legacy portal", color: "#9333ea", status: "archived", tasks: [] },
  ];
  const rows = [
    ["p1", "t1", "Client Atlas / Development", "Checkout refactor", 3.5],
    ["p2", "t3", "Internal / Meetings", "Standup and planning", 1],
    ["p1", "t2", "Client Atlas / Code review", "", 1.5],
    ["p2", "t4", "Internal / Support", "Ticket triage", 2],
  ];
  let i = 0;
  state.timesheetEntries = WEEK.flatMap((localDate, d) =>
    rows.slice(0, d === 4 ? 2 : 4).map(([projectId, taskId, label, note, hours]) => ({
      _id: `e${++i}`, localDate, projectId, taskId, label, note, durationMs: hours * H,
      sourceBlockIds: [], committedAt: now + i,
    })),
  );
  state.workItems = [
    { _id: "w1", title: "Checkout refactor", status: "active", source: "manual", projectId: "p1", taskId: "t1", priority: 1, originalEstimateHours: 16, remainingEstimateHours: 6, createdAt: now },
    { _id: "w2", title: "Fix tax rounding", status: "active", source: "manual", hierarchyLevel: 1, parentWorkItemId: "w1", projectId: "p1", taskId: "t1", createdAt: now + 1 },
    { _id: "w3", title: "Update onboarding docs", status: "active", source: "manual", projectId: "p2", taskId: "t4", priority: 3, createdAt: now + 2 },
  ];
  state.timers = running
    ? [{ _id: "tm1", startedAt: now - 25 * 60000, localDate: "2026-10-09", projectId: "p1", taskId: "t1", note: "Pairing on checkout", accumulatedDurationMs: 0 }]
    : [];
  return state;
}

async function setState(page, opts) {
  await page.goto(`${BASE}/time/2026-10-09`);
  await page.waitForTimeout(500);
  await page.evaluate(([key, src, o]) => {
    const seedFn = new Function(`return (${src})`)();
    const state = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(key, JSON.stringify(seedFn(state, o)));
  }, [KEY, seed.toString().replace(/\bH\b/g, String(H)).replace(/\bWEEK\b/g, JSON.stringify(WEEK)), opts]);
}

async function shot(page, name, action) {
  try {
    if (action) await action();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    log.push(`ok   ${name}`);
  } catch (error) {
    log.push(`FAIL ${name}: ${String(error.message).split("\n")[0]}`);
  }
}

async function go(page, url) {
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}

async function wide(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  const esc = () => page.keyboard.press("Escape");

  // Empty state before seeding.
  await shot(page, "w01-day-empty", () => go(page, "/time/2026-10-09"));

  await setState(page);
  await shot(page, "w02-day-entries", () => go(page, "/time/2026-10-07"));
  await shot(page, "w03-day-edit-expanded", () => page.getByText("Checkout refactor").first().click());
  await shot(page, "w04-day-entry-options", () => page.getByRole("button", { name: "Entry options" }).first().click());
  await esc(); await esc();
  await go(page, "/time/2026-10-07");
  await shot(page, "w05-day-inline-create", () => page.getByRole("button", { name: "Add new entry" }).click());
  await esc();

  await go(page, "/time/2026-10-07");
  await shot(page, "w05b-day-row-hover", () => page.getByText("Standup and planning").first().hover());
  await shot(page, "w05c-day-row-delete-confirm", () => page.getByRole("button", { name: /Delete/ }).first().click());
  await shot(page, "w06-titlebar-create", async () => { await go(page, "/time/2026-10-07"); await page.getByRole("button", { name: "Create time entry" }).first().click(); });
  await esc();
  await shot(page, "w07-titlebar-totals", () => page.getByRole("button", { name: "Show day and week totals" }).click());
  await esc();
  await shot(page, "w08-day-scope-menu", () => page.getByRole("button", { name: "Time view" }).click());
  await esc();

  await shot(page, "w10-week-ledger", () => go(page, "/time/2026-10-07?view=week"));
  await shot(page, "w11-week-ledger-tray", () => page.locator("main").getByRole("button", { name: /3(\.5|:30|h 30)/ }).first().click());
  await esc();
  await shot(page, "w12-week-lanes", () => page.getByText("Lanes", { exact: true }).click());
  const card = page.getByRole("button", { name: /Client Atlas/ }).first();
  await shot(page, "w13-week-lanes-selected", () => card.click());
  await shot(page, "w14-week-entry-modal", () => card.dblclick());
  await esc();
  await shot(page, "w15-week-lanes-add", () => page.getByRole("button", { name: "Add" }).first().click());
  await esc();
  await shot(page, "w16-submit-modal", async () => { await go(page, "/time/2026-10-07?view=week"); await page.getByRole("button", { name: /^Submit/ }).first().click(); });
  await esc(); await esc();

  await shot(page, "w20-backlog", () => go(page, "/backlog"));
  await shot(page, "w21-backlog-item", () => page.getByText("Update onboarding docs").first().click());
  await esc();
  await shot(page, "w22-projects", () => go(page, "/projects"));
  await shot(page, "w23-project-detail", () => go(page, "/projects/p1"));
  await shot(page, "w24-projects-archive", () => go(page, "/projects/archive"));
  await shot(page, "w25-projects-command", async () => { await go(page, "/projects/p1"); await page.getByRole("button", { name: "Search projects" }).click(); });
  await esc();

  for (const s of ["general", "plugins", "backlog", "projects", "export", "imports", "debug"]) {
    await shot(page, `w3x-settings-${s}`, () => go(page, `/settings/${s}`));
  }

  // Running timer.
  await setState(page, { running: true });
  await shot(page, "w40-day-running", () => go(page, "/time/2026-10-09"));
  await shot(page, "w41-quick-timer", () => page.locator(".stat-pill-active-clickable").click());
  await esc();
  await shot(page, "w42-running-modal", () => go(page, "/time/2026-10-09?timer=tm1"));
  await esc();
  await shot(page, "w43-week-running", () => go(page, "/time/2026-10-09?view=week"));

  await ctx.close();
}

async function narrow(browser, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await setState(page);
  const p = `n${width}`;
  await shot(page, `${p}-01-day`, () => go(page, "/time/2026-10-07"));
  await shot(page, `${p}-02-day-edit`, () => page.getByText("Checkout refactor").first().click());
  await page.keyboard.press("Escape");
  await go(page, "/time/2026-10-07");
  await shot(page, `${p}-02b-nav-menu`, () => page.getByRole("button", { name: /navigation|menu|Time view|Backlog/i }).first().click());
  await page.keyboard.press("Escape");
  await shot(page, `${p}-03-week-attempt`, () => go(page, "/time/2026-10-07?view=week"));
  await shot(page, `${p}-04-nav-toggle`, () => go(page, "/time/2026-10-07"));
  await shot(page, `${p}-05-backlog`, () => go(page, "/backlog"));
  await shot(page, `${p}-06-projects`, () => go(page, "/projects/p1"));
  await shot(page, `${p}-07-settings`, () => go(page, "/settings/general"));
  await ctx.close();
}

(async () => {
  require("node:fs").mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  await wide(browser);
  await narrow(browser, 800);
  await narrow(browser, 600);
  await browser.close();
  console.log(log.join("\n"));
})();
