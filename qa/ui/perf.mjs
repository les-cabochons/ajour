// Measures the renderer on the large seeded workspace (600 backlog items,
// 1,800 entries): cold load, a Start click, a store write on the Backlog page
// and the work per second while a timer runs. Run it on the base branch and on
// the change, with `just ui-perf`, and compare the two: the dev server serves
// unbundled modules and React's development build, so the absolute numbers sit
// well above the production figures in the progress tracker. Medians of `RUNS`
// runs; compare runs on the same machine, with nothing else running.
import { chromium } from "playwright";
import { emptyConnectorsOverview, seedScript } from "./seed.mjs";
import { BASE_URL, ensureServer } from "./server.mjs";

const RUNS = Number(process.env.AJOUR_PERF_RUNS ?? 5);
const TIMER_SAMPLE_MS = 5000;

const stopServer = await ensureServer();
const browser = await chromium.launch();

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const fmt = (ms) => `${ms.toFixed(1)} ms`;

async function newContext(seed) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.route("**/api/connectors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(emptyConnectorsOverview),
    }),
  );
  await context.addInitScript(seedScript({ large: true, ...seed }));
  return context;
}

// Two animation frames after an action: the browser has laid out and painted
// the result, so the page's own clock measures what the user waited for.
const settle = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))))`;

async function measureColdLoad(route) {
  const values = [];
  for (let run = 0; run < RUNS; run += 1) {
    const context = await newContext({ running: false });
    const page = await context.newPage();
    await page.goto(BASE_URL + route, { waitUntil: "commit" });
    // The seeded "Atlas platform" rows are on screen: the page has rendered.
    await page.waitForFunction(
      () =>
        document.querySelector("main")?.textContent?.includes("Atlas platform"),
      null,
      { timeout: 30_000 },
    );
    const ms = await page.evaluate(() => performance.now());
    const navigation = await page.evaluate(
      () => performance.getEntriesByType("navigation")[0]?.responseEnd ?? 0,
    );
    values.push(ms - navigation);
    await context.close();
  }
  return median(values);
}

async function measureAction(route, action, seed = {}) {
  const values = [];
  for (let run = 0; run < RUNS; run += 1) {
    const context = await newContext(seed);
    const page = await context.newPage();
    await page.goto(BASE_URL + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    values.push(await page.evaluate(action));
    await context.close();
  }
  return median(values);
}

async function measureTimerRenderer() {
  const context = await newContext({});
  const page = await context.newPage();
  await page.goto(BASE_URL + "/time/today", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");
  const read = async () =>
    Object.fromEntries(
      (await client.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  const before = await read();
  await page.waitForTimeout(TIMER_SAMPLE_MS);
  const after = await read();
  await context.close();
  const perSecond = (name) =>
    ((after[name] - before[name]) * 1000) / (TIMER_SAMPLE_MS / 1000);
  return {
    task: perSecond("TaskDuration"),
    script: perSecond("ScriptDuration"),
    layout: perSecond("LayoutDuration"),
    style: perSecond("RecalcStyleDuration"),
  };
}

const coldLoad = await measureColdLoad("/time/today");
const startClick = await measureAction(
  "/time/today",
  `(async () => {
  const button = document.querySelector('button[aria-label="Start"]');
  const started = performance.now();
  button.click();
  const done = await ${settle};
  return done - started;
})()`,
  { running: false },
);
const storeWrite = await measureAction(
  "/backlog",
  `(async () => {
  const { localStore } = await import("/src/lib/local-store.ts");
  const started = performance.now();
  localStore.snoozeWorkItem("big-0", Date.now() + 3600000);
  const done = await ${settle};
  return done - started;
})()`,
);
const timer = await measureTimerRenderer();

await browser.close();
stopServer();

console.log(
  "Ajour performance on the large workspace (600 items, 1,800 entries), medians of",
  RUNS,
  "runs",
);
console.log(
  `  cold load, Time page until rows render:   ${fmt(coldLoad)}  (budget ~150 ms)`,
);
console.log(
  `  Start click until painted:                ${fmt(startClick)}  (budget ~40 ms)`,
);
console.log(
  `  store write on the Backlog page:          ${fmt(storeWrite)}  (budget ~75 ms)`,
);
console.log(
  `  renderer work per second, timer running:  ${fmt(timer.task)}  (budget ~4 ms; script ${fmt(timer.script)}, style ${fmt(timer.style)}, layout ${fmt(timer.layout)})`,
);
