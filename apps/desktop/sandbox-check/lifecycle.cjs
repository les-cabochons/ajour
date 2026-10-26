// The real-Electron lifecycle check of the plugin renderer host (#391), part
// of seam 3 (#392). `scripts/check-plugin-sandbox.mjs` starts it in one of
// three modes and reads one `CHECK {json}` line per finding on stdout:
//
//   --lifecycle     the start modes, the 4-calls limit, the timeout, the
//                   memory ceiling, the crash budget, Turn back on and the
//                   quit's drain, through the real runtime and local API;
//   --orphan-spawn  opens a plugin renderer and a stand-in orphan, records
//                   them as Ajour does, and waits for the script to kill it;
//   --orphan-sweep  the next launch: the sweep ends what is left.
//
// It never listens on Ajour's port, and ends only processes it started.
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
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
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
const { PLUGIN_SCHEME } = require(
  path.join(electronRoot, "plugin-renderer-policy.cjs"),
);
const { createPluginRendererRuntime } = require(
  path.join(electronRoot, "plugin-renderer-runtime.cjs"),
);
const { launchSandboxRefusal } = require(
  path.join(electronRoot, "plugin-sandbox.cjs"),
);
const {
  PROCESS_RECORD_FILE,
  createProcessRecord,
  describeProcesses,
  sweepOrphanedRenderers,
} = require(path.join(electronRoot, "plugin-renderer-sweep.cjs"));

const FIXTURES = path.join(__dirname, "fixtures");
const userData = process.env.AJOUR_USER_DATA_PATH;
if (!userData) throw new Error("Set AJOUR_USER_DATA_PATH to a temp folder.");
app.setPath("userData", userData);
const recordPath = path.join(userData, PROCESS_RECORD_FILE);

protocol.registerSchemesAsPrivileged([
  { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true } },
]);

function report(event, data = {}) {
  process.stdout.write(`CHECK ${JSON.stringify({ event, ...data })}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
async function until(condition, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!(await condition()) && Date.now() < deadline) await sleep(50);
  return Boolean(await condition());
}

/** The main process's wide events, one line each: name, outcome, reason, plugin, close reason. */
const emitted = [];
function summarize() {
  return emitted.map((event) =>
    [
      event.name,
      event.outcome,
      event.outcome_reason,
      event.plugin?.id,
      event.plugin_renderer?.close_reason,
    ]
      .filter((part) => part !== undefined)
      .join(" "),
  );
}

async function mainEvents() {
  const events = createMainEvents();
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
        launch_id: "lifecycle-check",
        app: { version: "0.0.0", channel: "dev", packaged: false },
        device: { platform: process.platform, arch: process.arch },
      },
      sink: { emit: (event) => emitted.push(event) },
      scope,
      scrub: { homeDirectory: app.getPath("home"), userDataPath: userData },
      now: clock,
    }),
  );
  return events;
}

function makeRuntime(events, extra = {}) {
  return createPluginRendererRuntime({
    app,
    session,
    WebContentsView,
    ipcListeners: createIpcListeners(ipcMain, { events }),
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
    processRecord: createProcessRecord(recordPath),
    ...extra,
  });
}

const pluginPages = (pluginId) =>
  webContents
    .getAllWebContents()
    .filter(
      (contents) =>
        !contents.isDestroyed() &&
        contents.getURL().startsWith(`${PLUGIN_SCHEME}://${pluginId}/`),
    );

/** Starts `hold` on the plugin straight on the runtime, with no broker. */
const startHold = (runtime, pluginId, ms) =>
  runtime.start({
    pluginId,
    packageDirectory: path.join(FIXTURES, pluginId),
    entrypoint: "plugin.mjs",
    apiVersion: 4,
    method: "hold",
    args: [{ ms }],
  });

/** Crashes the plugin's open renderer, once its page runs a call. */
async function crash(runtime, pluginId) {
  const hold = startHold(runtime, pluginId, 60_000);
  await until(() => runtime.rendererProcessIds()[pluginId] !== undefined);
  await sleep(300);
  const pid = runtime.rendererProcessIds()[pluginId];
  pluginPages(pluginId)
    .find((contents) => contents.getOSProcessId() === pid)
    ?.forcefullyCrashRenderer();
  const outcome = await Promise.race([hold.settled, sleep(10_000)]);
  return { pid, outcome: outcome ?? "no answer" };
}

async function lifecycle() {
  const events = await mainEvents();
  const runtime = makeRuntime(events, {
    idleCloseMs: 400,
    memorySampleMs: 200,
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
  const network = createBrokerNetwork({ net, session, randomUUID });
  const server = await api.startAppApiServer({
    ...windowServerOptions,
    host: "127.0.0.1",
    port: 0,
    statePath: path.join(userData, "app-api-state.json"),
    vault: new MemorySecretVault(),
    brokerTransport: network.transport,
    brokerResolver: network.resolver,
    installedPluginDirectory: path.join(userData, "plugins"),
    developmentPluginDirectories: [
      path.join(FIXTURES, "fixture-lifecycle"),
      path.join(FIXTURES, "fixture-resident"),
    ],
    projectDataShapePluginDirectories: [],
    allowDevelopmentPlugins: true,
    pluginApi4Runtime: runtime,
    pluginRequestTimeoutMs: 3_000,
    pluginDrainMs: 5_000,
    brokerActivityWindowMs: 0,
  });
  const request = (method, url, body) =>
    dispatchJsonRequest(server, {
      method,
      path: url,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const group = async (pluginId) =>
    (await request("GET", "/api/plugins")).body.connectionGroups.find(
      (candidate) => candidate.plugin.id === pluginId,
    );
  const connect = async (mode) => {
    const saved = await request(
      "POST",
      "/api/plugins/fixture-lifecycle/connections",
      {
        values: {
          label: mode,
          tenantLabel: "Check",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          mode,
        },
      },
    );
    const id = saved.body?.connection?.id;
    return async () => {
      const startedAt = Date.now();
      const synced = await request(
        "POST",
        `/api/plugins/fixture-lifecycle/connections/${id}/sync`,
        { trigger: "manual", workItems: [] },
      );
      return {
        status: synced.status,
        error: synced.body?.connection?.lastError ?? synced.body?.error ?? null,
        ms: Date.now() - startedAt,
      };
    };
  };

  // 1. "Always ready": its renderer opens with the API, without a call.
  const residentOpened = await until(
    () => runtime.rendererProcessIds()["fixture-resident"] !== undefined,
  );
  const residentPid = runtime.rendererProcessIds()["fixture-resident"];

  // 2. The Advanced section, saved before the plugin's first start.
  const advanced = await request(
    "POST",
    "/api/plugins/fixture-lifecycle/runtime",
    { start: "plugin", memoryCeilingMb: 160 },
  );
  const advancedRuntime = advanced.body?.connectionGroups?.find(
    (candidate) => candidate.plugin.id === "fixture-lifecycle",
  )?.runtime;

  const slow = await connect("slow");
  const hang = await connect("hang");
  const balloon = await connect("balloon");
  const ok = await connect("ok");

  // 3. Five calls at once: four run, the fifth is refused at once.
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => slow()));
  const concurrentPid = runtime.rendererProcessIds()["fixture-lifecycle"];

  // 4. Idle: "Load when needed" closes after its idle time; "Always ready" stays.
  const idleClosed = await until(
    () =>
      runtime.rendererProcessIds()["fixture-lifecycle"] === undefined &&
      !isAlive(concurrentPid),
    5_000,
  );
  report("start-modes", {
    residentOpened,
    residentStillOpen:
      runtime.rendererProcessIds()["fixture-resident"] === residentPid &&
      isAlive(residentPid),
    advancedStatus: advanced.status,
    advancedRuntime,
    concurrent,
    idleClosed,
  });

  // 5. A call past its time closes the renderer: the first stop.
  const timedOut = await hang();
  await sleep(100);
  const afterTimeoutOpen =
    runtime.rendererProcessIds()["fixture-lifecycle"] !== undefined;

  // 6. Above the user's ceiling, 160 MB, the renderer closes: the second.
  const ballooned = await balloon();
  await sleep(100);
  const afterMemoryOpen =
    runtime.rendererProcessIds()["fixture-lifecycle"] !== undefined;
  const memoryClose = emitted.find(
    (event) =>
      event.name === "plugin_renderer.close" &&
      event.plugin_renderer?.close_reason === "memory",
  );

  // 7. A crash, the third within 10 minutes: the plugin is suspended.
  const crashed = await crash(runtime, "fixture-lifecycle");
  await sleep(200);
  const suspended = (await group("fixture-lifecycle"))?.suspended ?? null;
  const pagesBefore = pluginPages("fixture-lifecycle").length;
  const refused = await ok();
  const pagesAfter = pluginPages("fixture-lifecycle").length;

  // 8. Turn back on: it runs again.
  const resumed = await request(
    "POST",
    "/api/plugins/fixture-lifecycle/resume",
  );
  const afterResume = await ok();
  report("crash-budget", {
    timedOut,
    afterTimeoutOpen,
    ballooned,
    afterMemoryOpen,
    memoryClose: memoryClose
      ? {
          outcome: memoryClose.outcome,
          ceiling: memoryClose.plugin_renderer?.memory_ceiling_mb,
          memory: memoryClose.plugin_renderer?.memory_mb,
        }
      : null,
    crashed,
    suspended,
    refused,
    pagesBefore,
    pagesAfter,
    resumedStatus: resumed.status,
    resumedSuspended:
      resumed.body?.connectionGroups?.find(
        (candidate) => candidate.plugin.id === "fixture-lifecycle",
      )?.suspended ?? null,
    afterResume,
  });

  // 9. Suspension wins over "Always ready", and Turn back on starts it again.
  const residentCrashes = [];
  for (let index = 0; index < 3; index += 1) {
    residentCrashes.push(await crash(runtime, "fixture-resident"));
    await sleep(100);
  }
  await sleep(300);
  const residentSuspended =
    (await group("fixture-resident"))?.suspended ?? null;
  const residentOpenWhileSuspended =
    runtime.rendererProcessIds()["fixture-resident"] !== undefined;
  await request("POST", "/api/plugins/fixture-resident/resume");
  const residentReopened = await until(
    () => runtime.rendererProcessIds()["fixture-resident"] !== undefined,
  );
  report("always-ready-suspended", {
    residentCrashes,
    residentSuspended,
    residentOpenWhileSuspended,
    residentReopened,
  });

  // 10. Quit: a running call finishes within the drain, then every renderer closes.
  const draining = slow();
  await sleep(200);
  const stopStartedAt = Date.now();
  await api.stopAppApiServer(server);
  const stopMs = Date.now() - stopStartedAt;
  const drained = await draining;
  const pidsBeforeClose = Object.values(runtime.rendererProcessIds());
  await runtime.closeAll();
  const goneAfterClose = await until(
    () => pidsBeforeClose.every((pid) => !isAlive(pid)),
    5_000,
  );
  report("quit", {
    drained,
    stopMs,
    pidsBeforeClose,
    goneAfterClose,
    pluginPagesLeft: webContents
      .getAllWebContents()
      .filter((contents) => contents.getURL().startsWith(`${PLUGIN_SCHEME}:`))
      .length,
    recordLeft: existsSync(recordPath),
    events: summarize(),
  });
  report("quitting", {
    appPids: app.getAppMetrics().map((metric) => metric.pid),
  });
  app.quit();
}

/** The session the script kills: a plugin renderer, and a stand-in orphan. */
async function orphanSpawn() {
  const events = await mainEvents();
  const runtime = makeRuntime(events);
  startHold(runtime, "fixture-lifecycle", 120_000);
  await until(
    () => runtime.rendererProcessIds()["fixture-lifecycle"] !== undefined,
  );
  const rendererPid = runtime.rendererProcessIds()["fixture-lifecycle"];
  // What Chromium can't end: a process of Ajour's binary it didn't start.
  const standIn = spawn(
    process.execPath,
    [path.join(__dirname, "stand-in-orphan.cjs")],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        AJOUR_USER_DATA_PATH: path.join(userData, "stand-in"),
      },
    },
  );
  standIn.unref();
  await sleep(1_000);
  const decoyPid = Number(process.env.AJOUR_CHECK_DECOY_PID);
  const described = await describeProcesses(
    [rendererPid, standIn.pid, decoyPid],
    process.platform,
  );
  const startOf = (pid) =>
    described.find((entry) => entry.pid === pid)?.createdAt;
  const record = createProcessRecord(recordPath);
  // The runtime recorded its renderer; this one records the stand-in and a
  // decoy that isn't Ajour's, as if they were plugin renderers too.
  const recorded = JSON.parse(readFileSync(recordPath, "utf8")).processes;
  for (const entry of recorded) record.add(entry);
  record.add({
    pid: standIn.pid,
    pluginId: "stand-in",
    createdAt: startOf(standIn.pid),
  });
  record.add({
    pid: decoyPid,
    pluginId: "decoy",
    createdAt: startOf(decoyPid),
  });
  report("orphan-spawned", {
    mainPid: process.pid,
    rendererPid,
    standInPid: standIn.pid,
    decoyPid,
    rendererRecordedAt: recorded.find((entry) => entry.pid === rendererPid)
      ?.createdAt,
    rendererStartedAt: startOf(rendererPid),
    described,
  });
  // The script kills this process now.
  setTimeout(() => app.exit(3), 60_000);
}

/** The next launch: the sweep, as main.cjs runs it after the lock. */
async function orphanSweep() {
  const events = await mainEvents();
  const hadLock = app.requestSingleInstanceLock();
  const recordBefore = existsSync(recordPath)
    ? JSON.parse(readFileSync(recordPath, "utf8"))
    : null;
  const startedAt = Date.now();
  const result = await sweepOrphanedRenderers({
    filePath: recordPath,
    platform: process.platform,
    execPath: process.execPath,
    events,
  });
  report("orphan-swept", {
    hadLock,
    recordBefore,
    result,
    sweepMs: Date.now() - startedAt,
    recordLeft: existsSync(recordPath),
    events: summarize(),
    sweepEvent: emitted.find((event) => event.name === "plugin_renderer.sweep")
      ?.sweep,
  });
  // The script checks that none of these outlives the quit.
  report("quitting", {
    appPids: app.getAppMetrics().map((metric) => metric.pid),
  });
  app.quit();
}

const watchdog = setTimeout(() => {
  report("watchdog", { events: summarize() });
  app.exit(9);
}, 150_000);
watchdog.unref();

app
  .whenReady()
  .then(() => {
    if (process.argv.includes("--orphan-spawn")) return orphanSpawn();
    if (process.argv.includes("--orphan-sweep")) return orphanSweep();
    return lifecycle();
  })
  .catch((error) => {
    report("error", { error: String(error?.stack ?? error) });
    app.exit(2);
  });
