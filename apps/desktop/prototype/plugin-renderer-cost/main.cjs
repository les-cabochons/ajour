// PROTOTYPE (#230, #260). Throwaway, never merged.
// Electron main for the spike. It registers `ajour-ext`, creates N hidden
// sandboxed WebContentsViews (never attached to a window), each on its own
// in-memory partition `ext-<id>`, and times calls through `ipcMain.handle`.
// It prints one `SPIKE {json}` line per event on stdout. `run.mjs` reads them.
"use strict";

const {
  app,
  ipcMain,
  protocol,
  session,
  WebContentsView,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const arg = (name, fallback) => {
  const prefix = `--spike-${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit === undefined ? fallback : hit.slice(prefix.length);
};
const flag = (name) => process.argv.includes(`--spike-${name}`);

const MODE = arg("mode", "measure"); // measure | quit | kill | crash
const PLUGINS = Number(arg("plugins", "1"));
const WARMUP_CALLS = 50;
const WARM_CALLS = Number(arg("warm-calls", "500"));
const CONCURRENT_ROUNDS = 200;
const SETTLE_MS = 1000;
const HOLD_MS = Number(arg("hold-ms", "3000"));
const PER_CALL_CYCLES = Number(arg("per-call-cycles", "3"));
const PROCESS_LIMIT = arg("renderer-process-limit", "");
const SHARED_PARTITION = flag("shared-partition");
const NO_THROTTLE = flag("no-background-throttling");
// "same-site" gives ids like plugin-1.vendor.ajour, which all share the site
// vendor.ajour, to test whether site isolation or the partition keeps them apart.
const SAME_SITE = arg("id-style", "plain") === "same-site";
const WATCHDOG_MS = 60_000;
const DEBUG = flag("debug");

const userDataDir = (
  process.argv.find((value) => value.startsWith("--user-data-dir=")) ?? ""
).slice("--user-data-dir=".length);
if (userDataDir) app.setPath("userData", userDataDir);
if (PROCESS_LIMIT) {
  app.commandLine.appendSwitch("renderer-process-limit", PROCESS_LIMIT);
}

const emit = (event, data = {}) => {
  process.stdout.write(
    `SPIKE ${JSON.stringify({ event, t: performance.now(), ...data })}\n`,
  );
};

const watchdog = setTimeout(() => {
  emit("watchdog", { afterMs: WATCHDOG_MS });
  app.exit(9);
}, WATCHDOG_MS);

protocol.registerSchemesAsPrivileged([
  { scheme: "ajour-ext", privileges: { standard: true, secure: true } },
]);

const PRELOAD = path.join(__dirname, "preload.cjs");
const EXT_DIR = path.join(__dirname, "ext");
const FILES = Object.fromEntries(
  [
    ["/host.html", "text/html; charset=utf-8"],
    ["/host.js", "text/javascript; charset=utf-8"],
    ["/plugin.js", "text/javascript; charset=utf-8"],
  ].map(([pathname, type]) => [
    pathname,
    { type, body: fs.readFileSync(path.join(EXT_DIR, pathname.slice(1))) },
  ]),
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`Timed out: ${label}`);
    }),
  ]);
const round = (value, digits = 3) =>
  value === undefined || value === null
    ? value
    : Math.round(value * 10 ** digits) / 10 ** digits;
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    count: sorted.length,
    medianMs: round(at(0.5), 4),
    p95Ms: round(at(0.95), 4),
    minMs: round(sorted[0], 4),
    maxMs: round(sorted[sorted.length - 1], 4),
  };
};

/** webContents.id -> plugin. Identity comes from the IPC sender, never from the payload. */
const pluginsBySender = new Map();
/** session -> ids it may serve. */
const servedIds = new Map();

function serve(ses, id) {
  if (!servedIds.has(ses)) {
    servedIds.set(ses, new Set());
    ses.protocol.handle("ajour-ext", (request) => {
      const url = new URL(request.url);
      if (DEBUG) emit("protocol-request", { url: request.url });
      const file = FILES[url.pathname];
      if (!file || !servedIds.get(ses).has(url.host)) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(file.body, {
        headers: {
          "content-type": file.type,
          "content-security-policy": "default-src 'none'; script-src 'self'",
        },
      });
    });
  }
  servedIds.get(ses).add(id);
}

function createPlugin(id) {
  const plugin = {
    id,
    createdAt: performance.now(),
    pull: null,
    pending: new Map(),
    nextCallId: 1,
    readyWaiters: [],
    readyAt: null,
    selfCheck: null,
    gone: null,
  };
  const partition = SHARED_PARTITION ? "ext-shared" : `ext-${id}`;
  serve(session.fromPartition(partition), id);
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition,
      preload: PRELOAD,
      backgroundThrottling: !NO_THROTTLE,
    },
  });
  plugin.view = view;
  plugin.wc = view.webContents;
  pluginsBySender.set(plugin.wc.id, plugin);
  plugin.wc.on("render-process-gone", (_event, details) => {
    plugin.gone = { ...details, at: performance.now() };
    plugin.pull = null;
    for (const pending of plugin.pending.values()) {
      pending.reject(new Error(`${id} renderer gone: ${details.reason}`));
    }
    plugin.pending.clear();
    emit("render-process-gone", { id, ...details });
  });
  plugin.wc.on("console-message", (event, ...legacy) => {
    emit("console", { id, message: event.message ?? legacy[1] });
  });
  plugin.wc.on("did-fail-load", (_event, code, description, url) => {
    emit("did-fail-load", { id, code, description, url });
  });
  plugin.wc.on("preload-error", (_event, _path, error) => {
    emit("preload-error", { id, error: String(error) });
  });
  if (DEBUG) {
    for (const name of ["did-start-loading", "dom-ready", "did-finish-load"]) {
      plugin.wc.on(name, () => emit(name, { id, pid: pidOf(plugin) }));
    }
  }
  load(plugin);
  return plugin;
}

function load(plugin) {
  plugin.readyAt = null;
  plugin.pull = null;
  plugin.loadStartedAt = performance.now();
  plugin.wc.loadURL(`ajour-ext://${plugin.id}/host.html`).catch((error) => {
    emit("load-error", { id: plugin.id, error: String(error) });
  });
}

ipcMain.handle("ajour-ext:invoke", (event, message) => {
  const at = performance.now();
  const plugin = pluginsBySender.get(event.sender.id);
  const origin = event.senderFrame?.origin;
  if (!plugin || origin !== `ajour-ext://${plugin.id}`) {
    emit("rejected-sender", { senderId: event.sender.id, origin });
    throw new Error("Unknown plugin.");
  }
  if (message?.type === "ready") {
    plugin.readyAt = at;
    plugin.selfCheck = message.selfCheck;
  } else if (message?.type === "result") {
    const pending = plugin.pending.get(message.callId);
    if (pending) {
      plugin.pending.delete(message.callId);
      pending.resolve({ at, value: message.value, ok: message.ok });
    }
  }
  return new Promise((resolve) => {
    plugin.pull = resolve;
    if (message?.type === "ready") {
      for (const waiter of plugin.readyWaiters.splice(0)) waiter();
    }
  });
});

function waitReady(plugin) {
  if (plugin.readyAt !== null && plugin.pull) return Promise.resolve();
  return new Promise((resolve) => plugin.readyWaiters.push(resolve));
}

function call(plugin, method, args) {
  const pull = plugin.pull;
  if (!pull) return Promise.reject(new Error(`${plugin.id} is not waiting.`));
  plugin.pull = null;
  const callId = plugin.nextCallId++;
  return new Promise((resolve, reject) => {
    const sentAt = performance.now();
    plugin.pending.set(callId, {
      resolve: ({ at, value, ok }) =>
        resolve({ ms: at - sentAt, at, value, ok }),
      reject,
    });
    pull({ callId, method, args });
  });
}

const pidOf = (plugin) => plugin.wc.getOSProcessId();

function metrics() {
  return app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    serviceName: metric.serviceName,
    name: metric.name,
    sandboxed: metric.sandboxed,
    integrityLevel: metric.integrityLevel,
    workingSetKB: metric.memory.workingSetSize,
    peakWorkingSetKB: metric.memory.peakWorkingSetSize,
    privateKB: metric.memory.privateBytes,
  }));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitPidGone(pid, timeoutMs = 5000) {
  const start = performance.now();
  while (isAlive(pid)) {
    if (performance.now() - start > timeoutMs) return null;
    await sleep(5);
  }
  return performance.now() - start;
}

async function startPlugins(count, prefix = "plugin") {
  const list = [];
  for (let index = 1; index <= count; index += 1) {
    list.push(
      createPlugin(`${prefix}-${index}${SAME_SITE ? ".vendor.ajour" : ""}`),
    );
  }
  await Promise.all(
    list.map(async (plugin) => {
      await withTimeout(waitReady(plugin), 20_000, `${plugin.id} ready`);
      const first = await call(plugin, "ping", [0]);
      plugin.firstAnswerAt = first.at;
      plugin.firstCallMs = first.ms;
    }),
  );
  return list;
}

function describe(list) {
  return list.map((plugin) => ({
    id: plugin.id,
    pid: pidOf(plugin),
    readyMs: round(plugin.readyAt - plugin.createdAt),
    firstAnswerMs: round(plugin.firstAnswerAt - plugin.createdAt),
    firstCallMs: round(plugin.firstCallMs, 4),
    selfCheck: plugin.selfCheck,
  }));
}

function processSharing(list) {
  const byPid = new Map();
  for (const plugin of list) {
    const pid = pidOf(plugin);
    byPid.set(pid, [...(byPid.get(pid) ?? []), plugin.id]);
  }
  return {
    distinctPids: byPid.size,
    plugins: list.length,
    shared: [...byPid.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([pid, ids]) => ({ pid, ids })),
  };
}

async function warm(list) {
  const sequential = {};
  const pooled = [];
  for (const plugin of list) {
    for (let index = 0; index < WARMUP_CALLS; index += 1) {
      await call(plugin, "ping", [index]);
    }
    const latencies = [];
    for (let index = 0; index < WARM_CALLS; index += 1) {
      latencies.push((await call(plugin, "ping", [index])).ms);
    }
    sequential[plugin.id] = stats(latencies);
    pooled.push(...latencies);
  }
  const concurrentCalls = [];
  const concurrentRounds = [];
  for (let index = 0; index < CONCURRENT_ROUNDS; index += 1) {
    const start = performance.now();
    const results = await Promise.all(
      list.map((plugin) => call(plugin, "ping", [index])),
    );
    concurrentRounds.push(performance.now() - start);
    concurrentCalls.push(...results.map((result) => result.ms));
  }
  return {
    sequentialPooled: stats(pooled),
    sequential,
    concurrentCalls: stats(concurrentCalls),
    concurrentRounds: stats(concurrentRounds),
  };
}

async function perCallCycles() {
  const cycles = [];
  for (let index = 1; index <= PER_CALL_CYCLES; index += 1) {
    const start = performance.now();
    const plugin = createPlugin(`fresh-${index}`);
    await withTimeout(waitReady(plugin), 20_000, `${plugin.id} ready`);
    const first = await call(plugin, "ping", [0]);
    const pid = pidOf(plugin);
    const closeAt = performance.now();
    plugin.wc.close();
    const exitMs = await waitPidGone(pid);
    pluginsBySender.delete(plugin.wc.id);
    cycles.push({
      id: plugin.id,
      pid,
      createToFirstAnswerMs: round(first.at - start),
      closeToProcessExitMs: round(exitMs),
      closeCallMs: round(performance.now() - closeAt),
    });
  }
  return cycles;
}

function quit() {
  emit("quitting");
  clearTimeout(watchdog);
  app.quit();
}

async function measure() {
  const list = await startPlugins(PLUGINS);
  emit("first-answers", {
    plugins: describe(list),
    sharing: processSharing(list),
  });
  const latency = await warm(list);
  await sleep(SETTLE_MS);
  const before = metrics();
  emit("hold", {
    pids: before.map((metric) => metric.pid),
    rendererPids: list.map(pidOf),
    metrics: before,
  });
  await sleep(HOLD_MS);
  const after = metrics();
  const cycles = await perCallCycles();
  emit("result", {
    plugins: describe(list),
    sharing: processSharing(list),
    latency,
    metricsBefore: before,
    metricsAfter: after,
    perCallCycles: cycles,
  });
  quit();
}

async function lifecycleReady() {
  const list = await startPlugins(PLUGINS);
  const current = metrics();
  emit("ready", {
    plugins: describe(list),
    sharing: processSharing(list),
    pids: current.map((metric) => metric.pid),
    rendererPids: list.map(pidOf),
    metrics: current,
  });
  return list;
}

async function quitCase() {
  await lifecycleReady();
  // Give run.mjs time to list every spike process while the app runs.
  await sleep(HOLD_MS);
  quit();
}

async function killCase() {
  await lifecycleReady();
  // Wait for run.mjs to kill this process. The watchdog ends it otherwise.
}

async function crashCase() {
  const list = await lifecycleReady();
  const [victim, ...others] = list;
  const victimPid = pidOf(victim);
  const gone = new Promise((resolve) =>
    victim.wc.once("render-process-gone", (_event, details) =>
      resolve({ ...details, at: performance.now() }),
    ),
  );
  const crashAt = performance.now();
  victim.wc.forcefullyCrashRenderer();
  const details = await withTimeout(gone, 10_000, "render-process-gone");
  const exitWaitAt = performance.now();
  const exitMs = await waitPidGone(victimPid);
  const othersAfterCrash = await Promise.all(
    others.map((plugin) =>
      call(plugin, "ping", [1]).then(
        (result) => ({
          id: plugin.id,
          answered: true,
          ms: round(result.ms, 4),
        }),
        (error) => ({ id: plugin.id, answered: false, error: String(error) }),
      ),
    ),
  );
  const victimCall = await call(victim, "ping", [1]).then(
    () => "answered",
    (error) => String(error),
  );
  emit("crashed", {
    victim: victim.id,
    victimPid,
    reason: details.reason,
    exitCode: details.exitCode,
    crashToGoneEventMs: round(details.at - crashAt),
    crashToProcessExitMs:
      exitMs === null ? null : round(exitWaitAt + exitMs - crashAt),
    victimPidAliveInMain: isAlive(victimPid),
    victimCall,
    othersAfterCrash,
    pids: metrics().map((metric) => metric.pid),
    metrics: metrics(),
  });
  await sleep(HOLD_MS);
  const restartAt = performance.now();
  load(victim);
  await withTimeout(waitReady(victim), 20_000, "restart ready");
  const first = await call(victim, "ping", [2]);
  emit("restarted", {
    victim: victim.id,
    oldPid: victimPid,
    newPid: pidOf(victim),
    restartToFirstAnswerMs: round(first.at - restartAt),
    sharing: processSharing(list),
    pids: metrics().map((metric) => metric.pid),
  });
  await sleep(500);
  quit();
}

app.whenReady().then(async () => {
  emit("app-ready", {
    mode: MODE,
    plugins: PLUGINS,
    pid: process.pid,
    uptimeMs: round(process.uptime() * 1000),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    arch: process.arch,
    runningUnderARM64Translation: app.runningUnderARM64Translation,
    userData: app.getPath("userData"),
    rendererProcessLimit: PROCESS_LIMIT || null,
    sharedPartition: SHARED_PARTITION,
    sameSite: SAME_SITE,
    backgroundThrottling: !NO_THROTTLE,
  });
  const cases = {
    measure,
    quit: quitCase,
    kill: killCase,
    crash: crashCase,
  };
  try {
    await cases[MODE]();
  } catch (error) {
    emit("error", { error: String(error?.stack ?? error) });
    app.exit(2);
  }
});
