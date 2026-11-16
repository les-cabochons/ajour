// Runs the real-Electron check of the sandboxed plugin runtime (#390) and
// its lifecycle (#391): `sandbox-check/main.cjs`, once as Ajour starts and
// once with --no-sandbox, then `sandbox-check/lifecycle.cjs`, for the start
// modes, limits, crash budget and quit, and for the orphan sweep across a
// forced kill of main and a relaunch, `sandbox-check/view-collection.cjs`,
// the repro of #449, `sandbox-check/broker-pinning.cjs`, the broker's pinned
// requests (#434), a second Ajour started beside the first, and
// `sandbox-check/process-attacks.cjs`, the malicious plugin's attacks on the
// process broker (#725): its gates, text slots against a `.cmd` shim,
// repository folders, links, the child's environment and the command
// modes. Each run
// has a user data folder of its own in the temp folder. It reads the checks'
// `CHECK {json}` lines, holds them to what the tickets ask, and checks that
// no process the app started outlives its
// quit. It ends only the processes it started. Exits 1 when anything fails.
// On a system Ajour doesn't sandbox plugins on, such as Linux, it checks
// only that plugins stay off.
//
// CI runs it on Windows and macOS, and on Linux as informational, and no
// release publishes unless it passes (`.github/workflows/plugin-sandbox.yml`,
// #392).
//
//   corepack pnpm --filter @ajour/desktop check:plugin-sandbox
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electron = require("electron");
const desktopRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const { SANDBOXED_PLATFORMS, launchSandboxRefusal } = require(
  path.join(desktopRoot, "electron", "plugin-sandbox.cjs"),
);
const appMain = path.join(desktopRoot, "electron", "main.cjs");
const checkMain = path.join(desktopRoot, "sandbox-check", "main.cjs");
const lifecycleMain = path.join(desktopRoot, "sandbox-check", "lifecycle.cjs");
const viewCollectionMain = path.join(
  desktopRoot,
  "sandbox-check",
  "view-collection.cjs",
);
const brokerPinningMain = path.join(
  desktopRoot,
  "sandbox-check",
  "broker-pinning.cjs",
);
const processAttacksMain = path.join(
  desktopRoot,
  "sandbox-check",
  "process-attacks.cjs",
);
const TOKEN = "fixture-token-7b1e5c9d2a";

const failures = [];
function expect(condition, message, detail) {
  const line = `${condition ? "ok  " : "FAIL"} ${message}`;
  process.stdout.write(`${line}\n`);
  if (!condition) {
    failures.push(message);
    if (detail !== undefined) {
      process.stdout.write(
        `     ${JSON.stringify(detail, null, 1).replace(/\n/g, "\n     ")}\n`,
      );
    }
  }
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

/**
 * Runs one check in Electron and gathers its findings. `onFinding` sees
 * each as it arrives, with the child, as the orphan check kills it.
 */
async function runCheck(
  name,
  args,
  { main = checkMain, userData: given, env: extra = {}, onFinding, keep } = {},
) {
  const userData =
    given ?? (await mkdtemp(path.join(os.tmpdir(), `ajour-sandbox-${name}-`)));
  const env = {
    ...process.env,
    ...extra,
    AJOUR_USER_DATA_PATH: userData,
    AJOUR_CHECK_NODE: process.execPath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_DISABLE_SANDBOX;
  const child = spawn(electron, [main, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const findings = {};
  let buffered = "";
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("CHECK ")) continue;
      const finding = JSON.parse(line.slice("CHECK ".length));
      findings[finding.event] = finding;
      onFinding?.(finding, child);
    }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4_000);
  });
  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Only the process this script started.
      child.kill("SIGKILL");
      resolve({ code: "timeout" });
    }, 150_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
  const exitedAt = Date.now();
  const quitting = findings.quitting;
  const pids = [
    ...new Set([
      ...(quitting?.appPids ?? []),
      ...(quitting?.rendererPids ?? []),
    ]),
  ].filter((pid) => pid !== child.pid);
  const left = await waitGone(pids, 5_000);
  if (!keep) {
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
  return {
    findings,
    exit,
    stderr,
    left,
    pids,
    goneMs: Date.now() - exitedAt,
    userData,
  };
}

const isWindows = process.platform === "win32";
/**
 * Why plugins are off, as `plugin-sandbox.cjs` words it: asked of the same
 * function the app asks, so the check never keeps a copy of the wording.
 */
const refusalFor = ({ argv = [], platform = process.platform } = {}) =>
  launchSandboxRefusal({
    argv,
    hasSwitch: () => false,
    env: {},
    platform,
    inspectorActive: false,
  });
const NO_SANDBOX_OFF = refusalFor({ argv: ["--no-sandbox"] });
const UNSUPPORTED_OS_OFF = refusalFor({ platform: "linux" });

/**
 * What each way out of the malicious plugin must fail with. A throw alone
 * proves nothing: the fixture gives up on a call that gets no answer after
 * 3 s with `no answer`, and an attempt that hangs is not a refusal.
 */
const FETCH_REFUSED = /^TypeError: Failed to fetch$/;
const IMPORT_REFUSED =
  /^TypeError: Failed to fetch dynamically imported module: /;
const EXIT_REFUSALS = {
  fetch: FETCH_REFUSED,
  "fetch-public": FETCH_REFUSED,
  "fetch-local-api": FETCH_REFUSED,
  "fetch-private-name": FETCH_REFUSED,
  "fetch-private-address": FETCH_REFUSED,
  "fetch-other-plugin": FETCH_REFUSED,
  "fetch-file": FETCH_REFUSED,
  "fetch-file-posix": FETCH_REFUSED,
  "fetch-user-data": FETCH_REFUSED,
  "import-user-data": IMPORT_REFUSED,
  "import-remote": IMPORT_REFUSED,
  "import-other-plugin": IMPORT_REFUSED,
  "import-traversal": IMPORT_REFUSED,
  "import-traversal-backslash": IMPORT_REFUSED,
  websocket: /^Error: WebSocket failed$/,
  xhr: /^Error: XMLHttpRequest failed$/,
  "event-source": /^Error: EventSource failed$/,
  "send-beacon": /^TypeError: navigator\.sendBeacon is not a function$/,
  "service-worker": /^TypeError: Cannot read properties of undefined/,
  "shared-worker": /^ReferenceError: SharedWorker is not defined$/,
  "window-open": /^TypeError: self\.open is not a function$/,
  navigation:
    /^TypeError: Cannot set property href of .* which has only a getter$/,
  webtransport: /^WebTransportError: .*Content Security Policy/,
  rtc: /^ReferenceError: RTCPeerConnection is not defined$/,
  node: /^ReferenceError: require is not defined$/,
  process: /^ReferenceError: process is not defined$/,
};

/**
 * What the broker answers each attack of the malicious plugin with: the
 * layer that refuses it, in the words the SDK hands the plugin. An attack
 * that a deeper layer refuses, after the layer above it gave way, answers
 * differently, and fails here.
 */
const NOT_ALLOWED =
  "AjourRequestError: The plugin's manifest allows no GET request to that path on the connection's address.";
const BROKER_REFUSALS = {
  "other-plugin-connection":
    "AjourRequestError: This plugin has no connection with that id.",
  "absolute-url":
    "AjourRequestError: A request path is relative to the connection's address and starts with /.",
  "scheme-relative-url": NOT_ALLOWED,
  // The manifest allows GET /api/**, so only the rule that a path holds
  // literal segments stops these: the climb check behind it would answer
  // with another message.
  "dot-dot": NOT_ALLOWED,
  "dot-dot-above-address": NOT_ALLOWED,
  "dot-dot-encoded": NOT_ALLOWED,
  "header-authorization":
    "AjourRequestError: A plugin may not set the Authorization header.",
  "header-cookie": "AjourRequestError: A plugin may not set the Cookie header.",
  "header-host": "AjourRequestError: A plugin may not set the Host header.",
  "header-proxy-authorization":
    "AjourRequestError: A plugin may not set the Proxy-Authorization header.",
  // The service answers with a redirect to another origin, handed back as is.
  "cross-origin-redirect": "Error: answered 302",
};

/** 1. As Ajour starts. */
async function checkSandbox() {
  const { findings, exit, stderr, left, pids } = await runCheck(
    "sandboxed",
    [],
  );
  if (findings.error) process.stdout.write(`${findings.error.error}\n`);
  expect(exit.code === 0, "the check ran to the end", { exit, stderr });

  const gates = findings["process-gates"] ?? {};
  expect(
    gates.switchOff?.error ===
      "Process request refused: unsigned_processes_off." &&
      gates.switchOff?.itemCount === 0 &&
      !gates.switchOff?.activity?.lastRunAt &&
      gates.switchOff?.activity?.refusedCount === 1,
    "with the unsigned process switch off, the real worker's declared process is refused with unsigned_processes_off",
    gates.switchOff,
  );
  expect(
    gates.enabledStatus === 200 &&
      gates.acceptanceMissing?.error ===
        "Process request refused: process_acceptance_required." &&
      gates.acceptanceMissing?.itemCount === 0 &&
      !gates.acceptanceMissing?.activity?.lastRunAt &&
      gates.acceptanceMissing?.activity?.refusedCount === 2,
    "with the switch on but no acceptance, the declared process is refused with process_acceptance_required",
    gates,
  );
  expect(
    typeof gates.packageKey === "string" &&
      gates.packageKey.length > 0 &&
      gates.acceptedStatus === 200,
    "the settings API accepts the fixture package key reported by the overview",
    gates,
  );

  const broker = findings.broker ?? {};
  expect(
    broker.saveStatus === 200,
    "a connection saves, its validation run in the plugin's renderer",
    broker.saveError,
  );
  expect(
    broker.itemTitles?.length === 1 &&
      broker.itemTitles[0].startsWith("First |"),
    "a sync returns the fixture service's items",
    broker,
  );
  expect(
    broker.serviceReceived?.length >= 2 &&
      broker.serviceReceived.every(
        (received) => received.authorization === `Bearer ${TOKEN}`,
      ),
    "the service got every request with the token, from the broker",
    broker.serviceReceived,
  );
  expect(broker.pluginSawToken === false, "the plugin never saw the token");
  expect(
    broker.syncStatus === 200 &&
      broker.processActivity?.lastRunAt > 0 &&
      broker.processActivity?.refusedCount >= 1,
    "the real worker runs a declared process, refuses an undeclared one, and records both",
  );

  expect(
    findings["command-ask"]?.denied === 1,
    "the real worker holds an undeclared command, shows the exact ask and honours Deny",
  );

  const where = findings.where?.outcome?.result ?? {};
  expect(
    where.origin === "ajour-plugin://fixture-tracker" &&
      where.hasWindow === false &&
      where.hasRequire === false &&
      where.hasProcess === false &&
      where.hasAjour === true,
    "plugin code runs in a worker on its own origin, with ajour and no Node",
    findings.where,
  );

  const exits = findings.exits ?? {};
  const attempts = exits.outcome?.result ?? [];
  expect(
    JSON.stringify(attempts.map((attempt) => attempt.name).sort()) ===
      JSON.stringify(Object.keys(EXIT_REFUSALS).sort()),
    "the malicious plugin tried exactly the ways out the check names",
    attempts.map((attempt) => attempt.name),
  );
  for (const attempt of attempts) {
    const refusal = EXIT_REFUSALS[attempt.name];
    expect(
      !attempt.escaped &&
        refusal !== undefined &&
        refusal.test(attempt.error ?? ""),
      `blocked: ${attempt.name} (${attempt.error ?? attempt.value})`,
    );
  }
  expect(
    exits.catchAllHits?.length === 0,
    "nothing reached the catch-all server",
    exits.catchAllHits,
  );
  expect(
    (exits.blocked?.directBlockedCount ?? 0) > 0,
    "the blocked attempts are recorded for Access review",
    exits.blocked,
  );

  const attacks = findings["broker-attacks"] ?? {};
  const entries = attacks.entries ?? [];
  const tried = entries
    .filter((entry) => entry.kind === "attempt")
    .map((entry) => entry.result);
  expect(
    attacks.syncStatus === 200 &&
      JSON.stringify(tried.map((attempt) => attempt.name)) ===
        JSON.stringify(["control", ...Object.keys(BROKER_REFUSALS)]),
    "the malicious plugin turned the broker against itself in a sync: every attack the check names",
    { syncStatus: attacks.syncStatus, tried: tried.map(({ name }) => name) },
  );
  expect(
    tried.find((attempt) => attempt.name === "control")?.escaped === true,
    "its own allowed request goes through: the broker answers it",
    tried.find((attempt) => attempt.name === "control"),
  );
  for (const attempt of tried.filter(({ name }) => name !== "control")) {
    expect(
      !attempt.escaped && attempt.error === BROKER_REFUSALS[attempt.name],
      `the broker refused: ${attempt.name} (${attempt.error ?? attempt.value})`,
      { expected: BROKER_REFUSALS[attempt.name] },
    );
  }
  const echo = entries.find((entry) => entry.kind === "echo")?.result ?? "";
  expect(
    echo.startsWith("200 ") && attacks.pluginSawToken === false,
    "a token the service echoes back never reaches the plugin",
    echo,
  );
  expect(
    attacks.serviceReceived?.some(
      (received) => received.url === "/svc/api/me?case=echo",
    ) &&
      attacks.serviceReceived.every(
        (received) =>
          received.url.startsWith("/svc/api/me") &&
          received.authorization === `Bearer ${TOKEN}`,
      ),
    "the service got only the plugin's allowed requests, from the broker",
    attacks.serviceReceived?.map((received) => received.url),
  );
  expect(
    attacks.catchAllHits?.length === 0,
    "nothing reached the catch-all server: no redirect was followed with the token",
    attacks.catchAllHits,
  );

  const processes = findings.processes ?? {};
  const rendererPids = Object.values(processes.pids ?? {});
  expect(
    rendererPids.length === 2 && new Set(rendererPids).size === 2,
    "two plugins run in two distinct OS processes",
    processes,
  );
  expect(
    (processes.metrics ?? []).every(
      (metric) =>
        metric.sandboxed === true &&
        (!isWindows || metric.integrityLevel === "untrusted"),
    ),
    `each plugin renderer reports its sandbox${isWindows ? " at untrusted integrity" : ""}`,
    processes.metrics,
  );

  const typescript = findings.typescript ?? {};
  expect(
    typescript.outcome?.ok === true &&
      typescript.outcome.result?.greeting === "Hello, Ada!" &&
      typescript.outcome.result.origin ===
        "ajour-plugin://fixture-typescript" &&
      typescript.outcome.result.module ===
        "ajour-plugin://fixture-typescript/src/plugin.ts",
    "a .ts entrypoint that imports another .ts file runs and returns its result",
    typescript.outcome,
  );
  expect(
    typescript.enumOutcome?.ok === false &&
      typescript.enumOutcome.failure === "plugin_error" &&
      typescript.enumOutcome.message ===
        "status.ts uses TypeScript that Ajour can't strip: TypeScript enum is not supported in strip-only mode.",
    "a package with an enum fails with a reason naming the file",
    typescript.enumOutcome,
  );
  expect(
    typescript.enumCodeRan === false,
    "no module of that package runs",
    typescript,
  );

  const forged = findings.forged ?? {};
  expect(
    forged.concurrentHold?.ok === true && forged.concurrentHold.ms < 1_000,
    "one plugin runs on while another waits on its service",
    forged.concurrentHold,
  );
  expect(
    (forged.fromOtherPage ?? []).length === 40 &&
      forged.fromOtherPage.every(
        (answer) => answer?.ok === false && answer.error?.code === "refused",
      ),
    "calls another plugin's page makes for the tracker's runs are refused",
    forged.fromOtherPage?.slice(0, 3),
  );
  expect(
    forged.fromWorker?.ok === true,
    "a worker claiming other runs gets nowhere",
    forged.fromWorker,
  );
  expect(
    (forged.fromUnregistered ?? []).length === 2 &&
      forged.fromUnregistered.every((answer) => answer.startsWith("refused:")),
    "a page Ajour didn't register is refused, even on a plugin's origin",
    forged.fromUnregistered,
  );
  expect(
    forged.mainFrameIs === "fixture-identity",
    "a registered page's main frame is its plugin",
    forged.mainFrameIs,
  );
  expect(
    forged.subframeIs === null,
    "a subframe of that page is nobody",
    forged.subframeIs,
  );
  expect(
    forged.slowSyncTitles?.length === 1 && forged.slowSyncTitles[0] === "First",
    "the tracker's sync still ends with its own result",
    forged.slowSyncTitles,
  );
  expect(
    forged.serviceItemsRequests === 1,
    "the service saw only the tracker's own request",
    forged.serviceItemsRequests,
  );

  const lifecycle = findings.lifecycle ?? {};
  expect(
    lifecycle.afterCancel?.outcome?.failure === "terminated" &&
      lifecycle.afterCancel.samePid === true &&
      lifecycle.afterCancel.next?.ok === true,
    "a cancelled run stops its worker, and its renderer serves the next run",
    lifecycle.afterCancel,
  );
  expect(
    lifecycle.afterTimeout?.outcome?.failure === "terminated" &&
      lifecycle.afterTimeout.rendererOpen === false &&
      lifecycle.afterTimeout.oldPidAlive === false &&
      lifecycle.afterTimeout.trackerUntouched === true,
    "a timed-out run closes its plugin's renderer process, and only that one",
    lifecycle.afterTimeout,
  );
  expect(
    lifecycle.afterCrash?.outcome?.failure === "crashed" &&
      ["crashed", "killed"].includes(lifecycle.afterCrash.outcome.cause) &&
      Number.isInteger(lifecycle.afterCrash.crashPid) &&
      lifecycle.afterCrash.oldPidAlive === false &&
      lifecycle.afterCrash.next?.ok === true,
    "a crashed renderer fails its run with the cause, its process ends, and the next run opens a new one",
    lifecycle.afterCrash,
  );

  const dataShape = findings.dataShape ?? {};
  expect(
    dataShape.listed?.some(
      (plugin) => plugin.id === "fixture-shape" && plugin.apiVersion === 4,
    ),
    "the data shape host lists the API 4 data shape",
    dataShape.listed,
  );
  expect(
    dataShape.exportStatus === 200 &&
      JSON.stringify(dataShape.datasets) ===
        JSON.stringify([
          {
            id: "projects",
            rows: [
              { project: "Mercury", hours: 0 },
              { project: "Venus", hours: 1 },
            ],
          },
        ]),
    "a data shape export runs in a renderer and returns its datasets",
    dataShape,
  );
  expect(
    dataShape.importStatus === 200 &&
      JSON.stringify(
        (dataShape.projects ?? []).map((project) => project.name),
      ) === JSON.stringify(["Mercury", "Venus"]),
    "a data shape import runs in a renderer and returns its projects",
    dataShape,
  );
  expect(
    dataShape.rendererOpen === true,
    "the data shape ran in a renderer of its own",
    dataShape,
  );

  const many = findings.many ?? {};
  expect(
    many.runs === 500 &&
      many.completed === many.runs &&
      many.stalled === null &&
      many.samePid === true,
    "a plugin runs 500 operations in a row, each in a new worker of the same page, while main collects its garbage",
    many,
  );

  const events = findings.quitting?.events ?? [];
  expect(
    events.some((line) => line.startsWith("process.gone error fixture-escape")),
    "an event records the plugin renderer's crash",
  );
  for (const [line, meaning] of [
    ["plugin_renderer.open ok fixture-tracker", "a plugin's renderer opening"],
    [
      "plugin_renderer.blocked refused blocked fixture-escape policy",
      "a blocked way out, by its kind",
    ],
    [
      "plugin_renderer.call refused unknown_run fixture-escape http",
      "a call for a run the page doesn't have",
    ],
    [
      "plugin_renderer.call refused foreign_sender",
      "a call from a page Ajour didn't register",
    ],
  ]) {
    expect(events.includes(line), `an event records ${meaning}: ${line}`);
  }
  expect(
    findings.quitting?.pluginPagesLeft === 0,
    "closing every plugin leaves no plugin page",
    findings.quitting?.pluginPagesLeft,
  );
  expect(
    pids.length > 0 && left.length === 0,
    "a normal quit leaves no process behind",
    { pids, left },
  );
}

/**
 * 2. Plugins stay off: started with --no-sandbox, or on a system Ajour
 * doesn't sandbox them on.
 */
async function checkPluginsOff(name, args, { reason, cause }) {
  const { findings, exit, stderr, left, pids } = await runCheck(name, args);
  if (findings.error) process.stdout.write(`${findings.error.error}\n`);
  expect(exit.code === 0, "the check ran to the end", { exit, stderr });
  const off = findings["plugins-off"] ?? {};
  expect(
    off.unavailableReason === reason,
    "the runtime turns plugins off, with the reason",
    off,
  );
  expect(
    off.sandbox?.state === "off" && off.sandbox.reason === reason,
    "the plugins overview says so",
    off.sandbox,
  );
  expect(
    off.groupsEnabled?.every((enabled) => enabled === false),
    "every plugin shows as off",
    off.groupsEnabled,
  );
  expect(
    off.saveStatus !== 200 &&
      String(off.saveError).startsWith(
        "Plugins are turned off: this computer can't run them in a sandbox.",
      ),
    "no plugin code runs: a validation is refused with the notice",
    off,
  );
  expect(
    off.pluginPages === 0 && off.serviceRequests === 0,
    "no plugin page opened, no request left",
    off,
  );
  expect(
    (findings.quitting?.events ?? []).includes(
      `plugin_sandbox.off refused ${cause}`,
    ),
    "an event records why plugins are off",
    findings.quitting?.events,
  );
  expect(left.length === 0, "a normal quit leaves no process behind", {
    pids,
    left,
  });
}

/** 3. The renderer host's lifecycle (#391). */
async function checkLifecycle() {
  const { findings, exit, stderr, left, pids } = await runCheck(
    "lifecycle",
    ["--lifecycle"],
    { main: lifecycleMain },
  );
  if (findings.error) process.stdout.write(`${findings.error.error}\n`);
  expect(exit.code === 0, "the check ran to the end", { exit, stderr });

  const modes = findings["start-modes"] ?? {};
  expect(
    modes.residentOpened === true,
    'an "Always ready" plugin starts with the API, without a call',
    modes,
  );
  expect(
    modes.residentStillOpen === true,
    'an "Always ready" plugin stays open while idle',
    modes,
  );
  expect(
    modes.advancedStatus === 200 &&
      modes.advancedRuntime?.settings?.memoryCeilingMb === 160,
    "the Advanced section saves the memory ceiling",
    modes.advancedRuntime,
  );
  const concurrent = modes.concurrent ?? [];
  expect(
    concurrent.filter((call) => call.status === 200 && call.error === null)
      .length === 4 &&
      concurrent.some(
        (call) =>
          call.error ===
            'Too many operations of plugin "fixture-lifecycle" are already running.' &&
          call.ms < 500,
      ),
    "4 calls of a plugin run at once, and a fifth is refused at once",
    concurrent,
  );
  expect(
    modes.idleClosed === true,
    'a "Load when needed" renderer closes once idle, and its process ends',
    modes,
  );

  const budget = findings["crash-budget"] ?? {};
  expect(
    budget.timedOut?.error ===
      'Plugin "fixture-lifecycle" timed out while handling syncConnection.' &&
      budget.afterTimeoutOpen === false,
    "a call past its time fails, and its renderer closes",
    budget.timedOut,
  );
  expect(
    String(budget.ballooned?.error).endsWith(
      "its process went over its memory ceiling.",
    ) &&
      budget.afterMemoryOpen === false &&
      Number.isInteger(budget.balloonedProcess?.pid) &&
      budget.balloonedProcess.gone === true &&
      budget.memoryClose?.ceiling === 160 &&
      // Its last sample, rounded to the MB, at the ceiling or above.
      budget.memoryClose.memory >= 160,
    "a renderer above the user's memory ceiling closes with its process, and its call says so",
    {
      ballooned: budget.ballooned,
      process: budget.balloonedProcess,
      close: budget.memoryClose,
    },
  );
  expect(
    Number.isInteger(budget.timedOutProcess?.pid) &&
      budget.timedOutProcess.gone === true,
    "a call past its time ends its renderer's process",
    budget.timedOutProcess,
  );
  expect(
    budget.crashed?.outcome?.failure === "crashed" &&
      Number.isInteger(budget.crashed.pid) &&
      budget.crashed.gone === true &&
      ["crashed", "killed"].includes(budget.suspended?.cause),
    "a timeout, a memory kill and a crash in 10 minutes suspend the plugin, and the crashed renderer's process ends",
    { crashed: budget.crashed, suspended: budget.suspended },
  );
  expect(
    budget.refused?.error ===
      'Plugin "fixture-lifecycle" keeps stopping, so Ajour turned it off. Turn it back on from its page in Settings.' &&
      budget.refused.ms < 500 &&
      budget.pagesAfter === 0,
    "a suspended plugin's call fails at once, and opens no renderer",
    budget,
  );
  expect(
    budget.resumedStatus === 200 &&
      budget.resumedSuspended === null &&
      budget.afterResume?.status === 200 &&
      budget.afterResume.error === null,
    "Turn back on runs the plugin again",
    budget,
  );

  const hostile = findings.hostile ?? {};
  const timedOut =
    'Plugin "fixture-hostile" timed out while handling syncConnection.';
  const overCeiling =
    'Plugin "fixture-hostile" stopped before returning a result: its process went over its memory ceiling.';
  const endedWithItsProcess = (run, errors) =>
    errors.includes(run?.outcome?.error) &&
    Number.isInteger(run.pid) &&
    run.rendererOpen === false &&
    run.gone === true;
  expect(
    endedWithItsProcess(hostile.spun, [timedOut]),
    "an infinite loop ends at its time, with its renderer's process",
    hostile.spun,
  );
  expect(
    endedWithItsProcess(hostile.forkBombed, [timedOut, overCeiling]),
    "a fork bomb of workers ends at its memory ceiling or its time, with its renderer's process",
    hostile.forkBombed,
  );
  expect(
    hostile.spun?.addedProcesses <= 1 &&
      hostile.forkBombed?.addedProcesses <= 1,
    "and neither gets a process beyond its plugin's one renderer",
    hostile,
  );

  const resident = findings["always-ready-suspended"] ?? {};
  expect(
    resident.residentSuspended !== null &&
      resident.residentSuspended !== undefined &&
      resident.residentOpenWhileSuspended === false,
    'suspension wins over "Always ready": nothing reopens it',
    resident,
  );
  expect(
    resident.residentReopened === true,
    'Turn back on starts an "Always ready" plugin again',
    resident,
  );

  const quit = findings.quit ?? {};
  expect(
    quit.drained?.status === 200 &&
      quit.drained.error === null &&
      quit.stopMs >= 500 &&
      quit.stopMs < 5_000,
    "a quit lets a running call finish within its 5 s drain",
    { drained: quit.drained, stopMs: quit.stopMs },
  );
  expect(
    quit.goneAfterClose === true &&
      quit.pluginPagesLeft === 0 &&
      quit.recordLeft === false,
    "then every renderer closes, its process ends, and the record is gone",
    quit,
  );
  for (const [line, meaning] of [
    ["plugin_renderer.close ok fixture-lifecycle idle", "an idle close"],
    [
      "plugin_renderer.close timeout fixture-lifecycle timeout",
      "a close at a timeout",
    ],
    [
      "plugin_renderer.close error fixture-lifecycle memory",
      "a close above the memory ceiling",
    ],
  ]) {
    expect(
      (quit.events ?? []).includes(line),
      `an event records ${meaning}: ${line}`,
    );
  }
  expect(
    pids.length > 0 && left.length === 0,
    "a normal quit leaves no process behind",
    { pids, left },
  );
}

/** 4. The orphan sweep: main is killed with a renderer open, then relaunched. */
async function checkOrphanSweep() {
  // A process that isn't Ajour's, recorded as if it were: never ended.
  const decoy = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 120000)"],
    { stdio: "ignore" },
  );
  const spawned = await runCheck("orphans", ["--orphan-spawn"], {
    main: lifecycleMain,
    env: { AJOUR_CHECK_DECOY_PID: String(decoy.pid) },
    keep: true,
    onFinding: (finding, child) => {
      // Abruptly: TerminateProcess on Windows, SIGKILL elsewhere.
      if (finding.event === "orphan-spawned") child.kill("SIGKILL");
    },
  });
  const orphan = spawned.findings["orphan-spawned"] ?? {};
  if (spawned.findings.error) {
    process.stdout.write(`${spawned.findings.error.error}\n`);
  }
  expect(
    Number.isInteger(orphan.rendererPid) && Number.isInteger(orphan.standInPid),
    "a plugin renderer and a stand-in orphan ran, recorded",
    orphan,
  );
  expect(
    typeof orphan.rendererRecordedAt === "number" &&
      typeof orphan.rendererStartedAt === "number" &&
      Math.abs(orphan.rendererRecordedAt - orphan.rendererStartedAt) < 2_000,
    "the recorded start time is the one the system reports",
    orphan,
  );
  const rendererLeft = await waitGone([orphan.rendererPid], 5_000);
  expect(
    rendererLeft.length === 0,
    "Chromium ended the plugin renderer with main",
    rendererLeft,
  );
  expect(
    isAlive(orphan.standInPid) && isAlive(decoy.pid),
    "the stand-in orphan and the decoy outlived main",
  );

  const swept = await runCheck("orphans", ["--orphan-sweep"], {
    main: lifecycleMain,
    userData: spawned.userData,
  });
  const sweep = swept.findings["orphan-swept"] ?? {};
  if (swept.findings.error) {
    process.stdout.write(`${swept.findings.error.error}\n`);
  }
  expect(swept.exit.code === 0, "the relaunch ran to the end", {
    exit: swept.exit,
    stderr: swept.stderr,
  });
  expect(sweep.hadLock === true, "the relaunch took the single-instance lock");
  const standInLeft = await waitGone([orphan.standInPid], 5_000);
  expect(
    standInLeft.length === 0 && sweep.result?.ended === 1,
    "the sweep ended the orphan it recorded",
    sweep,
  );
  expect(
    isAlive(decoy.pid) && sweep.result?.notOurs === 1,
    "and left alone a process that isn't Ajour's",
    sweep.result,
  );
  expect(
    sweep.recordLeft === false &&
      (sweep.events ?? []).includes("plugin_renderer.sweep ok"),
    "the sweep forgets the record, and an event says what it ended",
    sweep,
  );
  // It opens no renderer, so it may have no process but main's to check.
  expect(
    swept.left.length === 0,
    "the relaunch's quit leaves no process behind",
    { pids: swept.pids, left: swept.left },
  );
  // Only what this script started.
  decoy.kill();
  for (const pid of standInLeft) {
    try {
      process.kill(pid);
    } catch {
      // Gone already.
    }
  }
  await rm(spawned.userData, { recursive: true, force: true }).catch(
    () => undefined,
  );
}

/**
 * 5. Why each plugin's view is held (#449): a view main doesn't hold is
 * collected, and its page closes with it.
 */
async function checkViewCollection() {
  const { findings, exit, stderr, left, pids } = await runCheck(
    "view-collection",
    [],
    { main: viewCollectionMain },
  );
  if (findings.error) process.stdout.write(`${findings.error.error}\n`);
  expect(exit.code === 0, "the check ran to the end", { exit, stderr });
  expect(
    findings.held?.completed === findings.held?.workers &&
      findings.held?.pageClosed === false,
    "a page whose view main holds runs 500 module workers in a row, each importing a module",
    findings.held,
  );
  expect(
    findings.unheld?.pageClosed === true,
    "a page whose view main doesn't hold closes once main collects the view",
    findings.unheld,
  );
  expect(left.length === 0, "a normal quit leaves no process behind", {
    pids,
    left,
  });
}

/**
 * 6. A second Ajour while the first runs: it loses the single-instance lock
 * and quits, and its launch's sweep never runs, because the first's live
 * renderers are in the record and would pass for orphans. The second is the
 * real `electron/main.cjs`; the first is the lifecycle check, holding the
 * lock with a plugin renderer open.
 */
async function checkSecondInstance() {
  const userData = await mkdtemp(
    path.join(os.tmpdir(), "ajour-sandbox-second-instance-"),
  );
  let second;
  const first = await runCheck("second-instance", ["--hold-instance"], {
    main: lifecycleMain,
    userData,
    keep: true,
    onFinding: (finding, child) => {
      if (finding.event !== "instance-running") return;
      second = (async () => {
        const result = await runSecondAjour(userData);
        // The first keeps running after the second is gone.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        result.rendererAlive = isAlive(finding.rendererPid);
        result.recordHeld = await recordLists(userData, finding.rendererPid);
        // Only the process this script started.
        child.kill("SIGKILL");
        return result;
      })();
    },
  });
  if (first.findings.error) {
    process.stdout.write(`${first.findings.error.error}\n`);
  }
  const running = first.findings["instance-running"] ?? {};
  expect(
    running.hadLock === true &&
      Number.isInteger(running.rendererPid) &&
      running.rendererOpen === true &&
      running.recorded === true,
    "the first Ajour holds the lock, with a plugin renderer open and recorded",
    running,
  );
  const outcome = (await second) ?? {};
  expect(
    outcome.exit?.code === 0,
    "the second Ajour quits by itself",
    outcome.exit,
  );
  expect(
    outcome.stdout?.includes('"app.lock_refused"') &&
      !outcome.stdout.includes("plugin_renderer.sweep"),
    "it says it lost the lock, and runs no sweep",
    { stdout: outcome.stdout, stderr: outcome.stderr },
  );
  expect(
    outcome.rendererAlive === true && outcome.recordHeld === true,
    "the first Ajour's renderer still runs after that, and is still in the record",
    outcome,
  );
  const heartbeat = first.findings["instance-heartbeat"] ?? {};
  expect(
    heartbeat.rendererOpen === true && heartbeat.recorded === true,
    "the first Ajour still has its renderer open",
    heartbeat,
  );
  const left = await waitGone([running.rendererPid], 5_000);
  expect(
    left.length === 0,
    "ending the first Ajour takes its renderer with it",
    left,
  );
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
}

/** Whether the record in `userData` lists the process. */
async function recordLists(userData, pid) {
  try {
    const record = JSON.parse(
      await readFile(path.join(userData, "plugin-renderers.json"), "utf8"),
    );
    return record.processes.some((entry) => entry.pid === pid);
  } catch {
    return false;
  }
}

/** Runs `electron/main.cjs` on `userData`, and waits for it to quit. */
async function runSecondAjour(userData) {
  const env = {
    ...process.env,
    AJOUR_USER_DATA_PATH: userData,
    AJOUR_WIDE_EVENTS: "console",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_DISABLE_SANDBOX;
  const child = spawn(electron, [appMain], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk).slice(-20_000);
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4_000);
  });
  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Only the process this script started.
      child.kill("SIGKILL");
      resolve({ code: "timeout" });
    }, 20_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
  return { exit, stdout, stderr };
}

/**
 * 7. The broker's pinned requests (#434): they connect only where the
 * tunnel's pin leads, with TLS on the name, and never straight out.
 */
async function checkBrokerPinning() {
  const { findings, exit, stderr, left, pids } = await runCheck(
    "broker-pinning",
    [],
    { main: brokerPinningMain },
  );
  if (findings.error) process.stdout.write(`${findings.error.error}\n`);
  expect(exit.code === 0, "the check ran to the end", { exit, stderr });
  const named = findings.name ?? {};
  expect(
    named.hellos?.length > 0 &&
      named.hellos.every(
        (hello) => hello.serverName === "pinned.ajour-check.invalid",
      ) &&
      named.dials?.every((dial) => dial.startsWith("127.0.0.1:")),
    "a pinned request to a name no DNS holds reaches the pinned address, with TLS on the name",
    named,
  );
  const literal = findings.literal ?? {};
  expect(
    literal.dials?.length > (named.dials?.length ?? 0) &&
      literal.hellos?.length > (named.hellos?.length ?? 0),
    "a pinned request to a loopback address goes through the tunnel too",
    literal,
  );
  const unpinned = findings.unpinned ?? {};
  expect(
    unpinned.newDials === 0 &&
      unpinned.newHellos === 0 &&
      /ERR_TUNNEL_CONNECTION_FAILED/.test(unpinned.outcome ?? ""),
    "a request with no live pin is refused and connects nowhere",
    unpinned,
  );
  expect(left.length === 0, "a normal quit leaves no process behind", {
    pids,
    left,
  });
}

/**
 * 8. The process broker under attack (#725, ADR 0019): the malicious
 * plugin's hand offs, against the gates, the argument rules, repository
 * folders, links, the child's environment and the command modes.
 */
async function checkProcessAttacks() {
  const canary = `canary-${process.pid}-7f3a91`;
  const { findings, exit, stderr, left, pids } = await runCheck(
    "process-attacks",
    [],
    { main: processAttacksMain, env: { AJOUR_CHECK_CANARY: canary } },
  );
  if (findings.error) process.stdout.write(`${findings.error.error}\n`);
  expect(exit.code === 0, "the check ran to the end", { exit, stderr });
  const same = (actual, expected) =>
    JSON.stringify(actual) === JSON.stringify(expected);
  const refusedAll = (phase, code) =>
    phase?.status === 200 &&
    same(phase.attempts, {
      declared: `!${code}`,
      undeclared: `!${code}`,
      "open-declared-scheme": `!${code}`,
    });

  const gates = findings["process-gates"] ?? {};
  expect(
    refusedAll(gates.switchOff, "unsigned_processes_off"),
    "an unsigned plugin's declared command, undeclared command and declared link are refused while the unsigned process switch is off",
    gates.switchOff,
  );
  expect(
    refusedAll(gates.acceptanceMissing, "process_acceptance_required"),
    "with the switch on, each is refused until the user accepts the plugin",
    gates.acceptanceMissing,
  );
  expect(
    gates.flagOff?.status === 200 &&
      same(gates.flagOff.attempts, {
        declared: { argv: ["text", "hello"], env: [] },
        undeclared: "!undeclared",
        "open-declared-scheme": "opened",
      }),
    "accepted, its declared command runs and its link opens, but an undeclared command is refused without processes.undeclaredCommands",
    gates.flagOff,
  );
  // The host refuses the whole operation before the broker sees a call.
  expect(
    gates.widenedWithoutConsent?.status === 409 &&
      gates.widenedWithoutConsent.error === "Allow the new access first." &&
      same(gates.widenedWithoutConsent.attempts, {}) &&
      gates.widenedWithoutConsent.processCalls === 0 &&
      gates.packageKeyChanged === true,
    "a package that adds undeclaredCommands without new consent runs nothing, and its acceptance lapses",
    gates,
  );

  const attacks = findings["process-attacks"] ?? {};
  const values = attacks.values ?? [];
  const inject = attacks.inject ?? {};
  expect(
    inject.status === 200 &&
      values.length > 0 &&
      values.every((value, index) =>
        same(inject.attempts[`text-${index}`], {
          argv: ["text", value],
          env: [],
        }),
      ),
    `shell metacharacters in a text slot reach ${attacks.windows ? "the .cmd shim's script" : "the tool"} as one argument, unchanged`,
    inject,
  );
  for (const name of [
    "leading-dash",
    "leading-dash-short",
    "line-feed",
    "carriage-return",
    "nul",
  ]) {
    expect(
      inject.attempts?.[name] === "!invalid_request",
      `a text slot refuses: ${name}`,
      inject.attempts?.[name],
    );
  }
  if (attacks.windows) {
    expect(
      inject.attempts?.["unknown-shim"] === "!spawn_refused",
      "a .cmd launcher the broker doesn't recognise is refused, never run through cmd.exe",
      inject.attempts?.["unknown-shim"],
    );
  }
  expect(
    same(attacks.markers, []),
    "no injection, inline code or unknown launcher wrote its marker",
    attacks.markers,
  );

  const reach = attacks.reach?.attempts ?? {};
  expect(
    same(reach["own-folder"], {
      argv: ["folder", attacks.ownFolder],
      env: [],
    }),
    "a folder slot with the hand off project's folder id gets its real path",
    { got: reach["own-folder"], expected: attacks.ownFolder },
  );
  for (const [name, meaning] of [
    ["other-project-folder", "another project's folder id"],
    [
      "data-folder-junction",
      "a folder that became a junction to Ajour's data folder",
    ],
    ["folder-path", "a path in place of a folder id"],
    ["folder-unknown-id", "a folder id Ajour never saved"],
    [
      "undeclared-in-other-project-folder",
      "an undeclared command in another project's folder",
    ],
  ]) {
    expect(
      reach[name] === "!folder_refused",
      `refused with folder_refused: ${meaning}`,
      reach[name],
    );
  }
  expect(
    String(attacks.dataFolderAdd).startsWith(
      "Ajour's data and install folders and their parents cannot be repository folders.",
    ),
    "the chooser refuses Ajour's data folder as a repository folder",
    attacks.dataFolderAdd,
  );
  expect(
    same(reach.environment, { argv: ["text", "environment"], env: [] }),
    "a command's output shows no AJOUR_ variable: the child's environment has none",
    reach.environment,
  );
  expect(
    attacks.eventsHoldCanary === false && attacks.eventsHoldValues === false,
    "no event holds an argument value or an AJOUR_ value",
    attacks,
  );
  expect(
    reach["undeclared-command-id"] === "!undeclared",
    "a command id the manifest doesn't declare is refused",
    reach["undeclared-command-id"],
  );
  for (const name of [
    "open-undeclared-scheme",
    "open-file",
    "open-file-posix",
    "open-javascript",
  ]) {
    expect(
      reach[name] === "!undeclared",
      `a link is refused as undeclared: ${name}`,
      reach[name],
    );
  }
  expect(
    reach["open-https-credentials"] === "!invalid_request",
    "an https link with credentials is refused",
    reach["open-https-credentials"],
  );
  expect(
    reach["open-declared-scheme"] === "opened" &&
      same(attacks.opened, ["escape-check://probe", "escape-check://reach"]),
    "only the declared scheme's links reached main's open, through its own check",
    attacks.opened,
  );

  const unicode = attacks.unicode?.attempts ?? {};
  expect(
    attacks.unicode?.status === 200 &&
      Object.keys(unicode).length === 9 &&
      Object.values(unicode).every((outcome) => outcome === "!invalid_request"),
    "an undeclared command with Unicode format, control or separator characters in its argv or name is refused",
    unicode,
  );

  expect(
    attacks.modeBefore === "always-ask" &&
      same(attacks.askAlways?.attempts, {
        allowlisted: "!no_window",
        "inline-code": "!no_window",
        unknown: "!no_window",
      }),
    "Always ask, the unsigned plugin's default, asks even for an allowlisted command, and no window denies each",
    { mode: attacks.modeBefore, phase: attacks.askAlways },
  );
  expect(
    same(attacks.askAuto?.attempts, {
      allowlisted: 0,
      "inline-code": "!user_denied",
      unknown: "!no_window",
    }),
    "in Auto, an allowlisted command runs without asking, inline code is denied by the user, and a command off the allowlist that gets no answer is denied",
    attacks.askAuto,
  );
  const asks = attacks.asks ?? [];
  expect(
    asks.length === 2 &&
      asks.every(
        (ask) =>
          ask.executable === "node" &&
          ask.risky === true &&
          typeof ask.reason === "string" &&
          ask.reason.length > 0 &&
          ask.signed === false,
      ) &&
      asks[0].argv[0] === "-e" &&
      same(asks[1].argv, ["--version"]),
    "in Auto, inline code and a command off the allowlist each reach the window as a risky ask with its reason and exact argv",
    asks,
  );
  expect(
    findings.quitting?.pluginPagesLeft === 0 && left.length === 0,
    "a normal quit leaves no plugin page and no process behind",
    { pagesLeft: findings.quitting?.pluginPagesLeft, pids, left },
  );
}

// Windows and macOS run every section. Elsewhere plugins stay off (#381), so
// the check proves only that.
const sections = SANDBOXED_PLATFORMS.has(process.platform)
  ? [
      ["Plugins in their sandbox", checkSandbox],
      [
        "Started with --no-sandbox",
        () => checkPluginsOff("no-sandbox", ["--no-sandbox"], NO_SANDBOX_OFF),
      ],
      ["The renderer host's lifecycle", checkLifecycle],
      ["Orphans after a forced kill of main", checkOrphanSweep],
      ["A plugin's page and its view", checkViewCollection],
      ["A second Ajour beside the first", checkSecondInstance],
      ["The broker's pinned requests", checkBrokerPinning],
      ["The process broker under attack", checkProcessAttacks],
    ]
  : [
      [
        `Plugins stay off on ${process.platform}`,
        () => checkPluginsOff("unsupported-os", [], UNSUPPORTED_OS_OFF),
      ],
      [
        "Started with --no-sandbox",
        () => checkPluginsOff("no-sandbox", ["--no-sandbox"], NO_SANDBOX_OFF),
      ],
    ];
const timings = [];
for (const [title, check] of sections) {
  process.stdout.write(`\n== ${title}\n`);
  const startedAt = Date.now();
  await check();
  timings.push(`${title}: ${((Date.now() - startedAt) / 1_000).toFixed(1)} s`);
}
process.stdout.write(`\n${timings.join("\n")}\n`);

process.stdout.write(
  failures.length === 0
    ? "\nThe plugin sandbox check passed.\n"
    : `\nThe plugin sandbox check failed ${failures.length} time(s).\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
