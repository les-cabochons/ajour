// The real-app lifecycle check of "Ajour without its window" (#534, spec
// #525): Ajour keeps answering MCP while its window is closed, and the tray's
// Quit ends every process it started.
//
// It builds the renderer for a free port, starts the real app through
// `lifecycle-check/main.cjs` with a temp user data folder, and then:
//
// 1. turns MCP on and creates an agent client from the page, through the
//    same /api routes Settings › MCP uses, so the window token applies;
// 2. closes the window, which hides it;
// 3. calls start_timer, get_running_timer and stop_timer with the MCP SDK's
//    Streamable HTTP client and the client's token: the hidden window
//    answers each one;
// 4. opens the window from the tray menu and finds the saved entry in the
//    page's local state;
// 5. clicks Quit in the tray menu, and checks that main exits within the
//    local API's 10 s stop budget and every process it started is gone 5 s
//    later, as the plugin sandbox check does.
//
// CI runs it on Windows and macOS (`.github/workflows/desktop-lifecycle.yml`).
// It ends only the processes it started. Exits 1 when anything fails.
//
//   corepack pnpm --filter @ajour/desktop check:keep-running
//   corepack pnpm --filter @ajour/desktop check:keep-running --skip-build
//
// The renderer is built into apps/web/dist-desktop with this port, which
// `start` and the packaging scripts rebuild before they use it. With
// --skip-build, the last build is used, and AJOUR_APP_API_PORT must name the
// port it was built for. --keep keeps the user data folder, and --events
// prints the app's last events, which a failed run always prints.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(desktopRoot, "../..");
const apiRoot = path.join(repoRoot, "apps", "api");
// Playwright is the repository's; the MCP SDK is the local API's.
const { _electron } = require(
  require.resolve("playwright", { paths: [repoRoot] }),
);
const { Client } = require(
  require.resolve("@modelcontextprotocol/sdk/client/index.js", {
    paths: [apiRoot],
  }),
);
const { StreamableHTTPClientTransport } = require(
  require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js", {
    paths: [apiRoot],
  }),
);

const checkMain = path.join(desktopRoot, "lifecycle-check", "main.cjs");
// main.cjs's INTERNAL_APP_API_STOP_TIMEOUT_MS: a quit never waits longer.
const QUIT_BUDGET_MS = 10_000;
// What the plugin sandbox check allows the processes after main exits.
const GONE_AFTER_EXIT_MS = 5_000;
const STEP_TIMEOUT_MS = 30_000;

const failures = [];
function expect(condition, message, detail) {
  process.stdout.write(`${condition ? "ok  " : "FAIL"} ${message}\n`);
  if (!condition) {
    failures.push(message);
    if (detail !== undefined) {
      process.stdout.write(
        `     ${JSON.stringify(detail, null, 1).replace(/\n/g, "\n     ")}\n`,
      );
    }
  }
  return condition;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitGone(pids, ms) {
  const deadline = Date.now() + ms;
  let alive = pids.filter(isAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    alive = alive.filter(isAlive);
  }
  return alive;
}

async function waitFor(read, { timeout = STEP_TIMEOUT_MS, what }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A port nothing listens on, never Ajour's 8787. */
async function freePort() {
  if (process.env.AJOUR_APP_API_PORT) {
    return Number(process.env.AJOUR_APP_API_PORT);
  }
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port: chosen } = server.address();
        server.close(() => resolve(chosen));
      });
    });
    if (port !== 8787) return port;
  }
}

function buildRenderer(baseUrl) {
  process.stdout.write(`Building the renderer for ${baseUrl}…\n`);
  const result = spawnSync(
    process.execPath,
    [path.join(desktopRoot, "scripts", "run-renderer.cjs"), "build"],
    {
      cwd: desktopRoot,
      env: { ...process.env, VITE_APP_API_BASE_URL: baseUrl },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  if (result.status !== 0) {
    throw new Error(`The renderer build failed with ${result.status}.`);
  }
}

/** The tool's structured output, or its refusal as an error. */
async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(
      `${name} refused: ${result.content?.map((part) => part.text).join(" ")}`,
    );
  }
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((part) => part.type === "text")?.text;
  return text ? JSON.parse(text) : {};
}

async function main() {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  if (!process.argv.includes("--skip-build")) buildRenderer(baseUrl);

  const userData = await mkdtemp(path.join(os.tmpdir(), "ajour-keep-running-"));
  const env = {
    ...process.env,
    AJOUR_USER_DATA_PATH: userData,
    AJOUR_APP_API_PORT: String(port),
    // Main's events on stdout, for the log of a failed run.
    AJOUR_WIDE_EVENTS: "console",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AJOUR_DESKTOP_RENDERER_URL;
  delete env.ELECTRON_DISABLE_SANDBOX;

  const electronApp = await _electron.launch({
    args: [checkMain],
    cwd: desktopRoot,
    env,
    timeout: 60_000,
  });
  const mainProcess = electronApp.process();
  let stderr = "";
  mainProcess.stderr?.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4_000);
  });
  // The last of main's events, one line each, for the log of a failed run.
  const events = [];
  let buffered = "";
  mainProcess.stdout?.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (typeof event?.name !== "string") continue;
        events.push(
          [
            new Date(event.timestamp ?? Date.now()).toISOString().slice(11, 23),
            event.name,
            event.outcome,
            event.outcome_reason,
            event.duration_ms === undefined ? "" : `${event.duration_ms}ms`,
          ]
            .filter(Boolean)
            .join(" "),
        );
        if (events.length > 60) events.shift();
      } catch {
        // Not an event.
      }
    }
  });
  const exited = new Promise((resolve) =>
    mainProcess.once("exit", (code) => resolve({ code, at: Date.now() })),
  );
  let agent;
  let quitClicked = false;

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await waitFor(
      () => page.evaluate(() => document.querySelector("main, nav") !== null),
      { what: "the app shell" },
    );

    const windowState = () =>
      electronApp.evaluate(({ BrowserWindow }) => {
        const [window] = BrowserWindow.getAllWindows();
        return window
          ? { exists: !window.isDestroyed(), visible: window.isVisible() }
          : { exists: false, visible: false };
      });
    const trayClick = (label) =>
      electronApp.evaluate((_electron, wanted) => {
        const menu = globalThis.ajourKeepRunningCheck.trayMenus.at(-1);
        const item = menu?.find((candidate) => candidate.label === wanted);
        if (!item?.click) return false;
        // After the answer: Quit ends the process this call talks to.
        setTimeout(() => item.click(), 0);
        return true;
      }, label);

    // 1. MCP on, and an agent client, as Settings › MCP creates them.
    const created = await page.evaluate(async (api) => {
      const post = async (route, body) => {
        const response = await fetch(`${api}${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      };
      const settings = await post("/api/mcp/settings", { enabled: true });
      const client = await post("/api/mcp/clients", {
        name: "Lifecycle check",
      });
      return { settings, client };
    }, baseUrl);
    expect(
      created.settings.status === 200 &&
        created.client.status === 201 &&
        typeof created.client.body?.token === "string",
      "the page turns MCP on and creates an agent client through /api",
      { settings: created.settings.status, client: created.client.status },
    );
    const token = created.client.body?.token;
    if (!token) throw new Error("No agent client token.");

    // The app reads the MCP setting at launch: a reload opens the bridge.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    agent = new Client({ name: "ajour-lifecycle-check", version: "1.0.0" });
    await agent.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/ajour`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    // The window answers once its bridge is open.
    await waitFor(
      async () => {
        try {
          await callTool(agent, "get_running_timer");
          return true;
        } catch {
          return false;
        }
      },
      { what: "the window's MCP bridge" },
    );

    // 2. Close the window: it hides, and stays loaded.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });
    const hidden = await waitFor(
      async () => {
        const state = await windowState();
        return state.exists && !state.visible ? state : null;
      },
      { what: "the window to hide" },
    ).catch(() => null);
    expect(hidden !== null, "closing the window hides it", await windowState());
    // Playwright keeps the page's visibilityState "visible", so ask main.
    const loaded = await electronApp.evaluate(({ BrowserWindow }) => {
      const { webContents } = BrowserWindow.getAllWindows()[0];
      return !webContents.isDestroyed() && !webContents.isCrashed();
    });
    expect(
      loaded && (await page.evaluate(() => 1 + 1)) === 2,
      "the hidden page stays loaded",
    );

    // 3. The MCP round trip, answered by the hidden window.
    const item = await callTool(agent, "create_work_item", {
      title: "Lifecycle check",
    });
    const started = await callTool(agent, "start_timer", {
      workItemId: item.workItemId,
    });
    expect(
      typeof started.running?.timerId === "string",
      "start_timer starts an entry while the window is hidden",
      started,
    );
    const running = await callTool(agent, "get_running_timer");
    expect(
      running.running?.timerId === started.running?.timerId,
      "get_running_timer reads it while the window is hidden",
      running,
    );
    const stopped = await callTool(agent, "stop_timer");
    expect(
      stopped.stopped === true,
      "stop_timer saves it while the window is hidden",
      stopped,
    );
    expect(
      !(await windowState()).visible,
      "the window stayed hidden through the round trip",
    );

    // 4. Open Ajour from the tray: the page shows the saved entry.
    expect(await trayClick("Open Ajour"), "the tray menu has Open Ajour");
    await waitFor(async () => (await windowState()).visible, {
      what: "the window to show",
    }).catch(() => undefined);
    expect((await windowState()).visible, "Open Ajour shows the window again");
    const saved = await waitFor(
      () =>
        page.evaluate((workItemId) => {
          const state = JSON.parse(
            window.localStorage.getItem("ajour.local-state.v2") ?? "{}",
          );
          const entry = (state.timesheetEntries ?? []).find(
            (candidate) => candidate.workItemId === workItemId,
          );
          return entry
            ? { running: (state.timers ?? []).length, entryId: entry._id }
            : null;
        }, item.workItemId),
      { what: "the saved entry in the page's state" },
    ).catch(() => null);
    expect(
      saved !== null && saved.running === 0,
      "the reopened window holds the saved entry, and nothing runs",
      saved,
    );

    await agent.close().catch(() => undefined);
    agent = undefined;

    // 5. Quit from the tray: every process the app started ends.
    const metrics = await electronApp.evaluate(({ app }) =>
      app.getAppMetrics().map(({ pid, type }) => ({ pid, type })),
    );
    const pids = [
      ...new Set([mainProcess.pid, ...metrics.map((metric) => metric.pid)]),
    ];
    const quitAt = Date.now();
    quitClicked = await trayClick("Quit");
    expect(quitClicked, "the tray menu has Quit");
    const exit = await Promise.race([
      exited,
      new Promise((resolve) =>
        setTimeout(() => resolve(null), QUIT_BUDGET_MS + 1_000),
      ),
    ]);
    expect(
      exit !== null && exit.at - quitAt <= QUIT_BUDGET_MS,
      `main exits within ${QUIT_BUDGET_MS / 1000} s of the tray's Quit`,
      { exit, ms: exit ? exit.at - quitAt : null },
    );
    const left = await waitGone(pids, GONE_AFTER_EXIT_MS);
    expect(
      pids.length >= 3 && left.length === 0,
      `every process it started is gone (${metrics.map((m) => m.type).join(", ")})`,
      { pids, left },
    );
    process.stdout.write(
      `     Quit at ${new Date(quitAt).toISOString().slice(11, 23)}: main exited ${exit ? exit.at - quitAt : "?"} ms after, the last process ${Date.now() - quitAt} ms after
`,
    );
  } catch (error) {
    expect(false, `the check ran to the end: ${error.message}`, {
      stderr: stderr.slice(-1_500),
    });
  } finally {
    await agent?.close().catch(() => undefined);
    if (!quitClicked || isAlive(mainProcess.pid)) {
      // Only the app this script started.
      await electronApp.close().catch(() => mainProcess.kill("SIGKILL"));
    }
    if (process.argv.includes("--keep")) {
      process.stdout.write(`     user data kept in ${userData}
`);
    } else {
      await rm(userData, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  if (failures.length > 0 || process.argv.includes("--events")) {
    process.stdout.write(
      `\nThe app's last events:\n  ${events.join("\n  ")}\n`,
    );
  }
  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} check(s) failed.\n`);
    process.exit(1);
  }
  process.stdout.write("\nAjour keeps running without its window.\n");
}

await main();
