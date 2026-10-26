// Runs the real-Electron check of the sandboxed plugin runtime (#390) and
// its lifecycle (#391): `sandbox-check/main.cjs`, once as Ajour starts and
// once with --no-sandbox, then `sandbox-check/lifecycle.cjs`, for the start
// modes, limits, crash budget and quit, and for the orphan sweep across a
// forced kill of main and a relaunch. Each run has a user data folder of its
// own in the temp folder. It reads the checks' `CHECK {json}` lines, holds
// them to what the tickets ask, and checks that no process the app started
// outlives its quit. It ends only the processes it started. Exits 1 when
// anything fails.
//
//   corepack pnpm --filter @ajour/desktop check:plugin-sandbox
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
const checkMain = path.join(desktopRoot, "sandbox-check", "main.cjs");
const lifecycleMain = path.join(desktopRoot, "sandbox-check", "lifecycle.cjs");
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
  const env = { ...process.env, ...extra, AJOUR_USER_DATA_PATH: userData };
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

// 1. As Ajour starts.
{
  process.stdout.write("\n== Plugins in their sandbox\n");
  const { findings, exit, stderr, left, pids } = await runCheck(
    "sandboxed",
    [],
  );
  if (findings.error) process.stdout.write(`${findings.error.error}\n`);
  expect(exit.code === 0, "the check ran to the end", { exit, stderr });

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
    attempts.length >= 15,
    "the malicious plugin tried every way out",
    exits.outcome,
  );
  for (const attempt of attempts) {
    expect(
      !attempt.escaped,
      `blocked: ${attempt.name} (${attempt.error ?? attempt.value})`,
    );
  }
  expect(
    exits.catchAllHits?.length === 0,
    "nothing reached the catch-all server",
    exits.catchAllHits,
  );
  expect(
    (exits.blocked?.blockedCount ?? 0) > 0,
    "the blocked attempts are recorded for Access review",
    exits.blocked,
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
      lifecycle.afterCrash.next?.ok === true,
    "a crashed renderer fails its run with the cause, and the next run opens a new one",
    lifecycle.afterCrash,
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

// 2. With --no-sandbox.
{
  process.stdout.write("\n== Started with --no-sandbox\n");
  const { findings, exit, stderr, left, pids } = await runCheck("no-sandbox", [
    "--no-sandbox",
  ]);
  if (findings.error) process.stdout.write(`${findings.error.error}\n`);
  expect(exit.code === 0, "the check ran to the end", { exit, stderr });
  const off = findings["no-sandbox"] ?? {};
  expect(
    off.unavailableReason === "Ajour was started with --no-sandbox.",
    "the runtime turns plugins off, with the reason",
    off,
  );
  expect(
    off.sandbox?.state === "off" &&
      off.sandbox.reason === "Ajour was started with --no-sandbox.",
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
      "plugin_sandbox.off refused launch_flag",
    ),
    "an event records why plugins are off",
    findings.quitting?.events,
  );
  expect(left.length === 0, "a normal quit leaves no process behind", {
    pids,
    left,
  });
}

// 3. The renderer host's lifecycle (#391).
{
  process.stdout.write("\n== The renderer host's lifecycle\n");
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
      budget.memoryClose?.ceiling === 160 &&
      // Its last sample, rounded to the MB, at the ceiling or above.
      budget.memoryClose.memory >= 160,
    "a renderer above the user's memory ceiling closes, and its call says so",
    { ballooned: budget.ballooned, close: budget.memoryClose },
  );
  expect(
    budget.crashed?.outcome?.failure === "crashed" &&
      ["crashed", "killed"].includes(budget.suspended?.cause),
    "a timeout, a memory kill and a crash in 10 minutes suspend the plugin",
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

// 4. The orphan sweep: main is killed with a renderer open, then relaunched.
{
  process.stdout.write("\n== Orphans after a forced kill of main\n");
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

process.stdout.write(
  failures.length === 0
    ? "\nThe plugin sandbox check passed.\n"
    : `\nThe plugin sandbox check failed ${failures.length} time(s).\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
