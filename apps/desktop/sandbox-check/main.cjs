// The real-Electron check of the sandboxed plugin runtime (#390), the seed of
// seam 3 (#392). `scripts/check-plugin-sandbox.mjs` starts it, once as Ajour
// starts and once with --no-sandbox, and reads one `CHECK {json}` line per
// finding on stdout. It runs the real runtime, IPC table, broker and local
// API, with fixture plugins, a fixture service and a catch-all server, and
// never listens on Ajour's port.
"use strict";

const {
  app,
  ipcMain,
  net,
  protocol,
  session,
  WebContentsView,
  webContents,
} = require("electron");
const http = require("node:http");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

const electronRoot = path.resolve(__dirname, "../electron");
const apiRoot = path.resolve(__dirname, "../../api/src");
const { createIpcListeners } = require(
  path.join(electronRoot, "ipc-listeners.cjs"),
);
const { createMainEvents } = require(
  path.join(electronRoot, "main-events.cjs"),
);
const { createBrokerNetwork } = require(
  path.join(electronRoot, "broker-transport.cjs"),
);
const { PLUGIN_SCHEME, pluginOfSender } = require(
  path.join(electronRoot, "plugin-renderer-policy.cjs"),
);
const { createPluginRendererRuntime } = require(
  path.join(electronRoot, "plugin-renderer-runtime.cjs"),
);
const { launchSandboxRefusal } = require(
  path.join(electronRoot, "plugin-sandbox.cjs"),
);

const TOKEN = "fixture-token-7b1e5c9d2a";
const FIXTURES = path.join(__dirname, "fixtures");
const userData = process.env.AJOUR_USER_DATA_PATH;
if (!userData) throw new Error("Set AJOUR_USER_DATA_PATH to a temp folder.");
app.setPath("userData", userData);

protocol.registerSchemesAsPrivileged([
  { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true } },
]);

function report(event, data = {}) {
  process.stdout.write(`CHECK ${JSON.stringify({ event, ...data })}\n`);
}

/** The main process's wide events the check's runtime emitted. */
const emitted = [];

/** Each event in one line: its name, outcome, reason, plugin and message. */
function summarize(list) {
  return list.map((event) =>
    [
      event.name,
      event.outcome,
      event.outcome_reason,
      event.plugin?.id,
      event.plugin_renderer?.message,
      event.blocked?.exit,
    ]
      .filter((part) => part !== undefined)
      .join(" "),
  );
}

const watchdog = setTimeout(() => {
  report("watchdog", { events: summarize(emitted) });
  app.exit(9);
}, 120_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** A service shaped like a tracker's API, which answers only the token. */
async function startService() {
  const service = { received: [], delayMs: 0 };
  service.server = await listen((request, response) => {
    service.received.push({
      url: request.url,
      authorization: request.headers.authorization ?? null,
    });
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.writeHead(401).end();
      return;
    }
    const json = (body) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.url === "/svc/api/me") json({ name: "Ada" });
    else if (request.url === "/svc/api/items") {
      setTimeout(
        () => json({ items: [{ id: "1", key: "T-1", title: "First" }] }),
        service.delayMs,
      );
    } else response.writeHead(404).end();
  });
  service.baseUrl = `http://127.0.0.1:${service.server.address().port}/svc`;
  return service;
}

/** Whatever reaches it got out of a sandbox. */
async function startCatchAll() {
  const catchAll = { hits: [] };
  catchAll.server = await listen((request, response) => {
    catchAll.hits.push(request.url);
    response.writeHead(200, { "access-control-allow-origin": "*" }).end("ok");
  });
  catchAll.server.on("upgrade", (request, socket) => {
    catchAll.hits.push(`upgrade ${request.url}`);
    socket.destroy();
  });
  catchAll.url = `http://127.0.0.1:${catchAll.server.address().port}`;
  return catchAll;
}

/** Runs one export of a fixture plugin straight on the runtime, with no broker. */
async function runDirect(runtime, pluginId, method, args, entrypoint) {
  const run = runtime.start({
    pluginId,
    packageDirectory: path.join(FIXTURES, pluginId),
    entrypoint,
    apiVersion: 4,
    method,
    args,
  });
  const outcome = await run.settled;
  await run.terminate("settled");
  return outcome;
}

/** A page of the check's own, on `origin`, served on a partition of its own. */
async function harnessView({ partition, preload, pages, subframes = false }) {
  const harnessSession = session.fromPartition(partition);
  harnessSession.protocol.handle(PLUGIN_SCHEME, (request) => {
    const page = pages[new URL(request.url).pathname];
    return page
      ? new Response(page, { headers: { "content-type": "text/html" } })
      : new Response("Not found", { status: 404 });
  });
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: subframes,
      partition,
      preload,
    },
  });
  return view;
}

async function main() {
  const mode = process.argv.includes("--no-sandbox")
    ? "no-sandbox"
    : "sandboxed";
  const events = createMainEvents();
  // The main process's events, as Ajour would emit them: the check reads them.
  const wideEvents = await import(
    pathToFileURL(
      path.resolve(__dirname, "../../../packages/wide-events/index.ts"),
    ).href
  );
  const { catalog } = await import(
    pathToFileURL(
      path.resolve(__dirname, "../../../packages/wide-events/catalog.ts"),
    ).href
  );
  events.attach((clock, scope) =>
    wideEvents.createEmitter({
      catalog,
      context: {
        runtime: "main",
        launch_id: "sandbox-check",
        app: { version: "0.0.0", channel: "dev", packaged: false },
        device: { platform: process.platform, arch: process.arch },
      },
      sink: { emit: (event) => emitted.push(event) },
      scope,
      scrub: { homeDirectory: app.getPath("home"), userDataPath: userData },
      now: clock,
    }),
  );
  const ipcListeners = createIpcListeners(ipcMain, { events });
  const runtime = createPluginRendererRuntime({
    app,
    session,
    WebContentsView,
    ipcListeners,
    events,
    hostDirectory: path.join(electronRoot, "plugin-host"),
    preloadPath: path.join(electronRoot, "plugin-host", "preload.cjs"),
    platform: process.platform,
    devTools: false,
    launchRefusal: launchSandboxRefusal({
      argv: process.argv,
      hasSwitch: (name) => app.commandLine.hasSwitch(name),
      env: process.env,
      platform: process.platform,
      inspectorActive: require("node:inspector").url() !== undefined,
    }),
  });
  const api = await import(pathToFileURL(path.join(apiRoot, "server.ts")).href);
  const { MemorySecretVault } = await import(
    pathToFileURL(path.join(apiRoot, "test-support/memory-secret-vault.ts"))
      .href
  );
  const { dispatchJsonRequest } = await import(
    pathToFileURL(path.join(apiRoot, "test-support/dispatch-json-request.ts"))
      .href
  );
  const { windowServerOptions } = await import(
    pathToFileURL(path.join(apiRoot, "test-support/window-token.ts")).href
  );
  const service = await startService();
  const catchAll = await startCatchAll();
  const network = createBrokerNetwork({ net, session, randomUUID });
  const statePath = path.join(userData, "app-api-state.json");
  const server = api.createAppApiServer({
    ...windowServerOptions,
    statePath,
    vault: new MemorySecretVault(),
    brokerTransport: network.transport,
    brokerResolver: network.resolver,
    installedPluginDirectory: path.join(userData, "plugins"),
    developmentPluginDirectories: [
      path.join(FIXTURES, "fixture-tracker"),
      path.join(FIXTURES, "fixture-escape"),
    ],
    projectDataShapePluginDirectories: [path.join(FIXTURES, "fixture-shape")],
    allowDevelopmentPlugins: true,
    pluginApi4Runtime: runtime,
    brokerActivityWindowMs: 0,
  });
  const request = (method, url, body) =>
    dispatchJsonRequest(server, {
      method,
      path: url,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const saveConnection = (pluginId) =>
    request("POST", `/api/plugins/${pluginId}/connections`, {
      values: {
        label: "Work",
        tenantLabel: "Acme",
        autoSync: true,
        autoSyncIntervalMinutes: 15,
        baseUrl: service.baseUrl,
        token: TOKEN,
        onPremises: true,
      },
    });
  const pluginPages = () =>
    webContents
      .getAllWebContents()
      .filter((contents) => contents.getURL().startsWith(`${PLUGIN_SCHEME}:`));

  report("start", {
    mode,
    pid: process.pid,
    electron: process.versions.electron,
    platform: process.platform,
  });

  if (mode === "no-sandbox") {
    const saved = await saveConnection("fixture-tracker");
    const overview = await request("GET", "/api/plugins");
    report("no-sandbox", {
      unavailableReason: runtime.unavailableReason() ?? null,
      sandbox: overview.body.sandbox ?? null,
      groupsEnabled: overview.body.connectionGroups.map(
        (group) => group.enabled,
      ),
      saveStatus: saved.status,
      saveError: saved.body?.error ?? null,
      pluginPages: pluginPages().length,
      serviceRequests: service.received.length,
    });
  } else {
    // 1. A sync through the broker, in the plugin's own renderer.
    const saved = await saveConnection("fixture-tracker");
    const connectionId = saved.body?.connection?.id;
    const synced = await request(
      "POST",
      `/api/plugins/fixture-tracker/connections/${connectionId}/sync`,
      { trigger: "auto", workItems: [] },
    );
    const syncText = JSON.stringify(synced.body);
    report("broker", {
      saveStatus: saved.status,
      saveError: saved.body?.error ?? null,
      syncStatus: synced.status,
      itemTitles: (synced.body?.items ?? []).map((item) => item.title),
      syncError:
        synced.body?.connection?.lastError ?? synced.body?.error ?? null,
      pluginSawToken: syncText.includes(TOKEN),
      serviceReceived: service.received,
    });

    // 2. Where the plugin's code runs.
    report("where", {
      outcome: await runDirect(
        runtime,
        "fixture-tracker",
        "whoAmI",
        [],
        "lib/plugin.mjs",
      ),
    });

    // 3. Every way out, from the malicious plugin.
    const exits = await runDirect(
      runtime,
      "fixture-escape",
      "tryExits",
      [
        {
          catchAll: catchAll.url,
          localApi: `http://localhost:${catchAll.server.address().port}`,
          otherPlugin: `${PLUGIN_SCHEME}://fixture-tracker`,
        },
      ],
      "plugin.mjs",
    );
    await sleep(500);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    report("exits", {
      outcome: exits,
      catchAllHits: catchAll.hits,
      blocked: state.pluginBrokerActivity?.["fixture-escape"] ?? null,
    });

    // 4. Two plugins, two processes, both sandboxed.
    const pids = runtime.rendererProcessIds();
    const metrics = app.getAppMetrics();
    report("processes", {
      pids,
      metrics: Object.values(pids).map((pid) => {
        const metric = metrics.find((candidate) => candidate.pid === pid);
        return {
          pid,
          type: metric?.type,
          sandboxed: metric?.sandboxed,
          integrityLevel: metric?.integrityLevel ?? null,
        };
      }),
    });

    // 5. Forged calls while the tracker's sync runs: from the other plugin's
    //    page, from its worker, from a page Ajour didn't register, and from a
    //    subframe.
    service.delayMs = 1_500;
    const receivedBefore = service.received.length;
    const slowSync = request(
      "POST",
      `/api/plugins/fixture-tracker/connections/${connectionId}/sync`,
      { trigger: "auto", workItems: [] },
    );
    await sleep(400);
    const runIds = Array.from({ length: 40 }, (_, index) => String(index + 1));
    const escapePage = pluginPages().find((contents) =>
      contents.getURL().startsWith(`${PLUGIN_SCHEME}://fixture-escape/`),
    );
    // The other plugin keeps running while the tracker waits on its service.
    const holdStartedAt = Date.now();
    const held = await runDirect(
      runtime,
      "fixture-escape",
      "hold",
      [{ ms: 10 }],
      "plugin.mjs",
    );
    const concurrentHold = { ok: held.ok, ms: Date.now() - holdStartedAt };
    const fromOtherPage = await escapePage.executeJavaScript(`
      Promise.all(${JSON.stringify(runIds)}.map((runId) => Promise.all([
        window.ajourPlugin.invoke({ type: "http", runId, callId: 1, request: { connectionId: ${JSON.stringify(connectionId)}, method: "GET", path: "/api/items" } }),
        window.ajourPlugin.invoke({ type: "settled", runId, outcome: { ok: true, result: { items: [] } } }),
      ]).then((answers) => answers[0], (error) => ({ rejected: String(error) }))))
    `);
    const fromWorker = await runDirect(
      runtime,
      "fixture-escape",
      "claimOtherRuns",
      [{ runIds, connectionId }],
      "plugin.mjs",
    );
    const spoof = await harnessView({
      partition: "ajour-check-spoof",
      preload: path.join(electronRoot, "plugin-host", "preload.cjs"),
      pages: {
        "/spoof.html":
          "<script>window.answers = Promise.all(['ready', 'next'].map((type) => window.ajourPlugin.invoke({ type }).then(() => 'answered', (error) => 'refused: ' + error.message)))</script>",
      },
    });
    await spoof.webContents.loadURL(
      `${PLUGIN_SCHEME}://fixture-tracker/spoof.html`,
    );
    const fromUnregistered =
      await spoof.webContents.executeJavaScript("window.answers");
    spoof.webContents.close();

    ipcMain.handle(
      "ajour-check:identity",
      (event) =>
        pluginOfSender(event, (id) =>
          id === identity.webContents.id ? "fixture-identity" : undefined,
        ) ?? null,
    );
    const identity = await harnessView({
      partition: "ajour-check-identity",
      preload: path.join(__dirname, "identity-preload.cjs"),
      subframes: true,
      pages: {
        "/main.html": "<iframe src='/frame.html'></iframe>",
        "/frame.html": "<p>frame</p>",
      },
    });
    await identity.webContents.loadURL(
      `${PLUGIN_SCHEME}://fixture-identity/main.html`,
    );
    await sleep(300);
    const mainFrameIs = await identity.webContents.executeJavaScript(
      "window.identity.who()",
    );
    const subframe = identity.webContents.mainFrame.frames[0];
    const subframeIs = subframe
      ? await subframe.executeJavaScript("window.identity.who()")
      : "no subframe";
    identity.webContents.close();

    const slow = await slowSync;
    report("forged", {
      concurrentHold,
      fromOtherPage,
      fromWorker,
      fromUnregistered,
      mainFrameIs,
      subframeIs,
      slowSyncTitles: (slow.body?.items ?? []).map(
        (item) => item.title.split(" | ")[0],
      ),
      serviceItemsRequests: service.received
        .slice(receivedBefore)
        .filter((received) => received.url === "/svc/api/items").length,
    });

    // 6. How a run ends: a cancel stops its worker and keeps the renderer, a
    //    timeout closes the renderer, and a crash fails the run with its cause.
    const startHold = (pluginId, entrypoint) =>
      runtime.start({
        pluginId,
        packageDirectory: path.join(FIXTURES, pluginId),
        entrypoint,
        apiVersion: 4,
        method: "hold",
        args: [{ ms: 60_000 }],
      });
    const trackerPid = runtime.rendererProcessIds()["fixture-tracker"];
    const cancelled = startHold("fixture-escape", "plugin.mjs");
    await sleep(300);
    const escapePid = runtime.rendererProcessIds()["fixture-escape"];
    await cancelled.terminate("cancelled");
    const afterCancel = {
      outcome: await cancelled.settled,
      samePid: runtime.rendererProcessIds()["fixture-escape"] === escapePid,
      next: await runDirect(
        runtime,
        "fixture-escape",
        "hold",
        [{ ms: 10 }],
        "plugin.mjs",
      ),
    };
    const timedOut = startHold("fixture-escape", "plugin.mjs");
    await sleep(300);
    await timedOut.terminate("timeout");
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error.code === "EPERM";
      }
    };
    for (let wait = 0; alive(escapePid) && wait < 60; wait += 1)
      await sleep(50);
    const afterTimeout = {
      outcome: await timedOut.settled,
      rendererOpen: "fixture-escape" in runtime.rendererProcessIds(),
      oldPidAlive: alive(escapePid),
      trackerUntouched:
        runtime.rendererProcessIds()["fixture-tracker"] === trackerPid,
    };
    const crashing = startHold("fixture-escape", "plugin.mjs");
    for (
      let wait = 0;
      !runtime.rendererProcessIds()["fixture-escape"] && wait < 100;
      wait += 1
    ) {
      await sleep(50);
    }
    await sleep(300);
    // The page of the renderer open now, not the one the timeout closed.
    const crashPid = runtime.rendererProcessIds()["fixture-escape"];
    pluginPages()
      .find(
        (contents) =>
          !contents.isDestroyed() && contents.getOSProcessId() === crashPid,
      )
      ?.forcefullyCrashRenderer();
    const afterCrash = {
      outcome: await Promise.race([
        crashing.settled,
        sleep(10_000).then(() => "no answer"),
      ]),
      next: await runDirect(
        runtime,
        "fixture-escape",
        "hold",
        [{ ms: 10 }],
        "plugin.mjs",
      ),
    };
    report("lifecycle", { afterCancel, afterTimeout, afterCrash, escapePid });

    // 7. A project data shape, an API 4 package without network or
    //    connection fields, exports and imports in a renderer of its own.
    const shapeProjects = [
      { name: "Mercury", color: "#123456", status: "active", tasks: [] },
      {
        name: "Venus",
        color: "#654321",
        status: "archived",
        tasks: [{ name: "Task", status: "active", billable: true }],
      },
    ];
    const listed = await request("GET", "/api/project-data-shapes");
    const exported = await request(
      "POST",
      "/api/project-data-shapes/fixture-shape/export",
      { projects: shapeProjects },
    );
    const imported = await request(
      "POST",
      "/api/project-data-shapes/fixture-shape/import",
      { datasets: exported.body?.datasets ?? [] },
    );
    report("dataShape", {
      listed: (listed.body?.plugins ?? []).map((plugin) => ({
        id: plugin.id,
        apiVersion: plugin.apiVersion,
      })),
      exportStatus: exported.status,
      datasets: exported.body?.datasets ?? null,
      importStatus: imported.status,
      projects: imported.body?.projects ?? null,
      error: exported.body?.error ?? imported.body?.error ?? null,
      rendererOpen: "fixture-shape" in runtime.rendererProcessIds(),
    });
  }

  const appPids = app.getAppMetrics().map((metric) => metric.pid);
  const rendererPids = Object.values(runtime.rendererProcessIds());
  await runtime.closeAll();
  report("quitting", {
    appPids,
    rendererPids,
    pluginPagesLeft: pluginPages().length,
    events: summarize(emitted),
  });
  clearTimeout(watchdog);
  service.server.close();
  catchAll.server.close();
  app.quit();
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    report("error", { error: String(error?.stack ?? error) });
    app.exit(2);
  });
