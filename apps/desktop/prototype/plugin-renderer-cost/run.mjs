#!/usr/bin/env node
// PROTOTYPE (#230, #260). Throwaway, never merged.
// Drives main.cjs with the repo's Electron, one unique --user-data-dir per run,
// and checks the OS process list. It only kills PIDs it started or their
// descendants, never a process by name.
//
//   node run.mjs --mode all                     full suite, writes results/
//   node run.mjs --mode measure --plugins 4 --runs 5
//   node run.mjs --mode quit|kill|crash --plugins 8 --runs 3
//   extra: --process-limit 1, --shared-partition, --no-throttle
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const isWindows = process.platform === "win32";
const POST_EXIT_WAIT_MS = 5000;
const RUN_TIMEOUT_MS = 120_000;

const cli = process.argv.slice(2);
const option = (name, fallback) => {
  const index = cli.indexOf(`--${name}`);
  return index === -1 ? fallback : cli[index + 1];
};
const has = (name) => cli.includes(`--${name}`);

const execFileText = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(
      file,
      args,
      { maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    ),
  );

const median = (values) => {
  const list = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (list.length === 0) return null;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
};
const round = (value, digits = 1) =>
  value === null || value === undefined
    ? value
    : Math.round(value * 10 ** digits) / 10 ** digits;
const mb = (bytes) => round(bytes / 1024 / 1024, 1);

async function listProcesses() {
  if (isWindows) {
    const script =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress";
    const text = await execFileText("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    return JSON.parse(text).map((entry) => ({
      pid: entry.ProcessId,
      ppid: entry.ParentProcessId,
      name: entry.Name,
      command: entry.CommandLine ?? "",
      rssBytes: Number(entry.WorkingSetSize),
      privateBytes: Number(entry.PrivatePageCount),
    }));
  }
  const text = await execFileText("ps", [
    "-A",
    "-o",
    "pid=,ppid=,rss=,command=",
  ]);
  return text
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      name: path.basename(match[4].split(" -")[0].trim()),
      command: match[4],
      rssBytes: Number(match[3]) * 1024,
      privateBytes: null,
    }));
}

/** Spike processes: a PID we recorded, a child of one, or a command line with our user-data-dir. */
function spikeProcesses(list, run) {
  const dir = run.userDataDir.toLowerCase();
  return list
    .map((entry) => {
      const why = [];
      if (run.knownPids.has(entry.pid)) why.push("recorded-pid");
      if (run.knownPids.has(entry.ppid)) why.push("child-of-recorded-pid");
      if (entry.command.toLowerCase().includes(dir)) why.push("user-data-dir");
      return { ...entry, why };
    })
    .filter((entry) => entry.why.length > 0)
    .map((entry) => ({
      pid: entry.pid,
      ppid: entry.ppid,
      name: entry.name,
      type: (entry.command.match(/--type=([\w-]+)/) ?? [])[1] ?? "browser",
      why: entry.why,
      rssBytes: entry.rssBytes,
      privateBytes: entry.privateBytes,
      command: entry.command.slice(0, 400),
    }));
}

async function snapshot(run, label, since) {
  const startedAt = performance.now();
  const processes = spikeProcesses(await listProcesses(), run);
  return {
    label,
    startedAfterMs: round(startedAt - since),
    finishedAfterMs: round(performance.now() - since),
    count: processes.length,
    processes,
  };
}

/** A fast OS memory read for known PIDs, to cross-check getAppMetrics. */
async function memoryOf(pids) {
  const startedAt = performance.now();
  let entries;
  if (isWindows) {
    const script = `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
    const text = await execFileText("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    entries = [JSON.parse(text)].flat().map((entry) => ({
      pid: entry.Id,
      rssBytes: Number(entry.WorkingSet64),
      privateBytes: Number(entry.PrivateMemorySize64),
    }));
  } else {
    const text = await execFileText("ps", [
      "-o",
      "pid=,rss=",
      "-p",
      pids.join(","),
    ]).catch(() => "");
    entries = text
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length === 2)
      .map(([pid, rss]) => ({
        pid: Number(pid),
        rssBytes: Number(rss) * 1024,
        privateBytes: null,
      }));
  }
  return { tookMs: round(performance.now() - startedAt), processes: entries };
}

/** "alive", "eperm" (exists, but this process may not open it) or "dead". */
function probe(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return error.code === "EPERM" ? "eperm" : "dead";
  }
}
const isAlive = (pid) => probe(pid) !== "dead";

/** Polls every recorded PID every 20 ms and notes when each one is first seen dead. */
async function deathWatch(pids, since, maxMs = 10_000) {
  const deadAfterMs = Object.fromEntries(pids.map((pid) => [pid, null]));
  while (performance.now() - since < maxMs) {
    const now = performance.now();
    for (const pid of pids) {
      if (deadAfterMs[pid] === null && !isAlive(pid))
        deadAfterMs[pid] = round(now - since);
    }
    if (Object.values(deadAfterMs).every((value) => value !== null)) break;
    await sleep(20);
  }
  return deadAfterMs;
}

async function killPid(pid) {
  if (isWindows) {
    return execFileText("taskkill", ["/F", "/PID", String(pid)]).then(
      (text) => text.trim(),
      (error) => `taskkill failed: ${String(error.message).trim()}`,
    );
  }
  return execFileText("kill", ["-9", String(pid)]).then(
    () => "kill -9 sent",
    (error) => `kill -9 failed: ${String(error.message).trim()}`,
  );
}

async function runOnce(spec) {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "ajour-spike-renderer-cost-"),
  );
  const args = [
    path.join(here, "main.cjs"),
    `--user-data-dir=${userDataDir}`,
    `--spike-mode=${spec.mode}`,
    `--spike-plugins=${spec.plugins}`,
  ];
  if (spec.processLimit)
    args.push(`--spike-renderer-process-limit=${spec.processLimit}`);
  if (spec.sharedPartition) args.push("--spike-shared-partition");
  if (spec.noThrottle) args.push("--spike-no-background-throttling");
  if (spec.sameSite) args.push("--spike-id-style=same-site");
  // The full OS listing is slow on Windows (WMI took about 4 s here), so the
  // lifecycle cases hold long enough for one listing while the app runs.
  if (spec.mode === "quit" || spec.mode === "crash")
    args.push("--spike-hold-ms=7000");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const spawnedAt = performance.now();
  const child = spawn(electronPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const run = {
    spec,
    userDataDir,
    mainPid: child.pid,
    knownPids: new Set([child.pid]),
    events: {},
    log: [],
    stderr: "",
    checks: {},
  };
  const waiters = new Map();
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) =>
      resolve({ code, signal, at: performance.now() }),
    ),
  );
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.startsWith("SPIKE ")) return;
    const event = JSON.parse(line.slice(6));
    event.harnessMs = round(performance.now() - spawnedAt, 2);
    for (const pid of [...(event.pids ?? []), ...(event.rendererPids ?? [])])
      run.knownPids.add(pid);
    if (
      [
        "console",
        "did-fail-load",
        "load-error",
        "preload-error",
        "error",
        "watchdog",
        "rejected-sender",
        "render-process-gone",
      ].includes(event.event)
    ) {
      run.log.push(event);
    }
    run.events[event.event] = event;
    for (const resolve of waiters.get(event.event) ?? []) resolve(event);
    waiters.delete(event.event);
  });
  child.stderr.on("data", (chunk) => {
    if (run.stderr.length < 20_000) run.stderr += chunk;
  });
  const waitFor = (name) =>
    run.events[name]
      ? Promise.resolve(run.events[name])
      : Promise.race([
          new Promise((resolve) =>
            waiters.set(name, [...(waiters.get(name) ?? []), resolve]),
          ),
          exited.then(() => {
            throw new Error(`Spike exited before "${name}".`);
          }),
        ]);
  const deadline = setTimeout(() => {
    run.log.push({ event: "harness-timeout" });
    void killPid(child.pid);
  }, RUN_TIMEOUT_MS);

  try {
    if (spec.mode === "measure") {
      await waitFor("first-answers");
      const hold = await waitFor("hold");
      run.checks.holdMemory = await memoryOf(hold.pids);
      await waitFor("result");
    } else if (spec.mode === "crash") {
      await waitFor("crashed");
      run.checks.afterCrash = await snapshot(
        run,
        "after renderer crash, app still running",
        spawnedAt,
      );
      await waitFor("restarted");
    } else {
      await waitFor("ready");
      run.checks.whileRunning = await snapshot(run, "while running", spawnedAt);
      for (const entry of run.checks.whileRunning.processes)
        run.knownPids.add(entry.pid);
      run.checks.probeWhileRunning = Object.fromEntries(
        [...run.knownPids].map((pid) => [pid, probe(pid)]),
      );
    }

    // `since` is when main was seen gone. On Windows, taskkill spends seconds
    // in a WMI lookup before it terminates anything, so the watch starts first
    // and the reference point is main's observed death, not the command.
    let since;
    let watch;
    if (spec.mode === "kill") {
      const killStarted = performance.now();
      watch = deathWatch([...run.knownPids], killStarted);
      run.checks.killOutput = await killPid(child.pid);
      run.checks.killCommandMs = round(performance.now() - killStarted);
      since = performance.now();
      watch = watch.then((dead) => {
        const mainDead = dead[child.pid];
        return Object.fromEntries(
          Object.entries(dead).map(([pid, ms]) => [
            pid,
            ms === null ? null : round(ms - mainDead),
          ]),
        );
      });
    } else {
      await waitFor("quitting");
      const exit = await exited;
      since = exit.at;
      run.checks.quitToExitMs = round(
        exit.at - (spawnedAt + run.events.quitting.harnessMs),
      );
      watch = deathWatch([...run.knownPids], since);
    }
    const [deadAfterMs, first] = await Promise.all([
      watch,
      spec.mode === "measure"
        ? null
        : snapshot(run, "right after main ended", since),
    ]);
    // Milliseconds after main was seen gone. 0 or less: gone by then. null: still alive after 10 s.
    run.checks.deadAfterMainMs = deadAfterMs;
    run.checks.afterEnd = first;
    const wait = since + POST_EXIT_WAIT_MS - performance.now();
    if (wait > 0) await sleep(wait);
    run.checks.afterWait = await snapshot(
      run,
      `${POST_EXIT_WAIT_MS / 1000} s after main ended`,
      since,
    );
  } catch (error) {
    run.log.push({
      event: "harness-error",
      error: String(error?.stack ?? error),
    });
  } finally {
    clearTimeout(deadline);
  }

  const exit = await Promise.race([exited, sleep(3000).then(() => null)]);
  run.exit = exit && { code: exit.code, signal: exit.signal };
  const leftovers =
    run.checks.afterWait?.processes ??
    spikeProcesses(await listProcesses(), run);
  run.leftovers = leftovers;
  if (leftovers.length > 0) {
    run.leftoverKills = [];
    for (const entry of leftovers)
      run.leftoverKills.push({
        pid: entry.pid,
        output: await killPid(entry.pid),
      });
    await sleep(1000);
    run.afterLeftoverKill = spikeProcesses(await listProcesses(), run);
  }
  run.knownPids = [...run.knownPids];
  try {
    fs.rmSync(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch (error) {
    run.log.push({ event: "cleanup-error", error: String(error) });
  }
  return run;
}

async function machine() {
  const info = {
    platform: process.platform,
    release: os.release(),
    osVersion: os.version(),
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryGB: round(os.totalmem() / 1024 ** 3, 1),
    nodeArch: process.arch,
    electronBinary: electronPath,
  };
  try {
    if (isWindows) {
      const script =
        "$o=Get-CimInstance Win32_OperatingSystem; $c=Get-CimInstance Win32_Processor; [pscustomobject]@{os=$o.Caption; version=$o.Version; build=$o.BuildNumber; cpu=$c.Name; cores=$c.NumberOfCores; threads=$c.NumberOfLogicalProcessors} | ConvertTo-Json -Compress";
      Object.assign(
        info,
        JSON.parse(
          await execFileText("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
          ]),
        ),
      );
    } else if (process.platform === "darwin") {
      info.cpu = (
        await execFileText("sysctl", ["-n", "machdep.cpu.brand_string"])
      ).trim();
      info.os = (await execFileText("sw_vers", [])).trim().replace(/\s+/g, " ");
      info.hardware = (await execFileText("sysctl", ["-n", "hw.model"])).trim();
    }
  } catch (error) {
    info.machineError = String(error);
  }
  return info;
}

function summarizeMeasure(runs) {
  const ok = runs.filter((run) => run.events.result);
  const perRun = ok.map((run) => {
    const result = run.events.result;
    const rendererPids = new Set(run.events.hold.rendererPids);
    const metrics = result.metricsBefore;
    const renderers = metrics.filter((metric) => rendererPids.has(metric.pid));
    const others = metrics.filter((metric) => !rendererPids.has(metric.pid));
    const osRenderers = (run.checks.holdMemory?.processes ?? []).filter(
      (entry) => rendererPids.has(entry.pid),
    );
    const osAll = run.checks.holdMemory?.processes ?? [];
    return {
      launchToFirstAnswerMs: run.events["first-answers"].harnessMs,
      viewColdMedianMs: median(
        result.plugins.map((plugin) => plugin.firstAnswerMs),
      ),
      viewColdMaxMs: Math.max(
        ...result.plugins.map((plugin) => plugin.firstAnswerMs),
      ),
      firstCallMs: median(result.plugins.map((plugin) => plugin.firstCallMs)),
      warmMedianMs: result.latency.sequentialPooled.medianMs,
      warmP95Ms: result.latency.sequentialPooled.p95Ms,
      concurrentMedianMs: result.latency.concurrentCalls.medianMs,
      concurrentRoundMedianMs: result.latency.concurrentRounds.medianMs,
      rendererWorkingSetMB: median(
        renderers.map((metric) => metric.workingSetKB / 1024),
      ),
      rendererPrivateMB: median(
        renderers.map((metric) =>
          metric.privateKB == null ? null : metric.privateKB / 1024,
        ),
      ),
      osRendererWorkingSetMB: median(
        osRenderers.map((entry) => entry.rssBytes / 1024 / 1024),
      ),
      osRendererPrivateMB: median(
        osRenderers.map((entry) =>
          entry.privateBytes == null ? null : entry.privateBytes / 1024 / 1024,
        ),
      ),
      nonRendererWorkingSetMB:
        others.reduce((sum, metric) => sum + metric.workingSetKB, 0) / 1024,
      totalWorkingSetMB:
        metrics.reduce((sum, metric) => sum + metric.workingSetKB, 0) / 1024,
      osTotalWorkingSetMB:
        osAll.reduce((sum, entry) => sum + entry.rssBytes, 0) / 1024 / 1024,
      processCount: metrics.length,
      processTypes: metrics
        .map((metric) => metric.type)
        .sort()
        .join(","),
      distinctRendererPids: result.sharing.distinctPids,
      sharedPids: result.sharing.shared,
      sandboxed: renderers.every((metric) => metric.sandboxed !== false),
      integrityLevels: [
        ...new Set(renderers.map((metric) => metric.integrityLevel)),
      ].join(","),
      perCallCreateMs: median(
        result.perCallCycles.map((cycle) => cycle.createToFirstAnswerMs),
      ),
      perCallCloseToExitMs: median(
        result.perCallCycles.map((cycle) => cycle.closeToProcessExitMs),
      ),
      quitToExitMs: run.checks.quitToExitMs,
      leftoverAfterWait: run.checks.afterWait?.count ?? null,
    };
  });
  const pick = (key, digits = 2) =>
    round(median(perRun.map((entry) => entry[key])), digits);
  return {
    runs: runs.length,
    succeeded: ok.length,
    launchToFirstAnswerMs: pick("launchToFirstAnswerMs", 0),
    viewColdMedianMs: pick("viewColdMedianMs", 0),
    viewColdMaxMs: pick("viewColdMaxMs", 0),
    firstCallMs: pick("firstCallMs", 2),
    warmMedianMs: pick("warmMedianMs", 3),
    warmP95Ms: pick("warmP95Ms", 3),
    concurrentMedianMs: pick("concurrentMedianMs", 3),
    concurrentRoundMedianMs: pick("concurrentRoundMedianMs", 3),
    rendererWorkingSetMB: pick("rendererWorkingSetMB", 1),
    rendererPrivateMB: pick("rendererPrivateMB", 1),
    osRendererWorkingSetMB: pick("osRendererWorkingSetMB", 1),
    osRendererPrivateMB: pick("osRendererPrivateMB", 1),
    nonRendererWorkingSetMB: pick("nonRendererWorkingSetMB", 1),
    totalWorkingSetMB: pick("totalWorkingSetMB", 1),
    osTotalWorkingSetMB: pick("osTotalWorkingSetMB", 1),
    perCallCreateMs: pick("perCallCreateMs", 0),
    perCallCloseToExitMs: pick("perCallCloseToExitMs", 0),
    quitToExitMs: pick("quitToExitMs", 0),
    distinctRendererPidsEveryRun: perRun.map(
      (entry) => entry.distinctRendererPids,
    ),
    sharedPidsAnyRun: perRun.some((entry) => entry.sharedPids.length > 0),
    sandboxedEveryRun: perRun.every((entry) => entry.sandboxed),
    integrityLevels: [
      ...new Set(perRun.map((entry) => entry.integrityLevels)),
    ].join(" | "),
    processTypes: [...new Set(perRun.map((entry) => entry.processTypes))].join(
      " | ",
    ),
    leftoversAfterQuit: perRun.map((entry) => entry.leftoverAfterWait),
    perRun,
  };
}

function summarizeLifecycle(runs) {
  return runs.map((run) => {
    const types = new Map();
    for (const entry of [
      ...(run.checks.whileRunning?.processes ?? []),
      ...(run.checks.afterCrash?.processes ?? []),
    ])
      types.set(entry.pid, entry.type);
    for (const event of [
      run.events.ready,
      run.events.crashed,
      run.events.restarted,
    ]) {
      for (const metric of event?.metrics ?? [])
        if (!types.has(metric.pid)) types.set(metric.pid, metric.type);
    }
    const dead = Object.entries(run.checks.deadAfterMainMs ?? {});
    const stillAlive = dead
      .filter(([, ms]) => ms === null)
      .map(([pid]) => `${types.get(Number(pid)) ?? "?"}:${pid}`);
    const describeSnapshot = (snap) =>
      snap
        ? {
            count: snap.count,
            takenMs: `${snap.startedAfterMs}-${snap.finishedAfterMs}`,
            types: snap.processes.map((entry) => `${entry.type}:${entry.pid}`),
          }
        : null;
    return {
      mode: run.spec.mode,
      plugins: run.spec.plugins,
      mainPid: run.mainPid,
      knownPids: run.knownPids.length,
      killOutput: run.checks.killOutput,
      quitToExitMs: run.checks.quitToExitMs,
      exit: run.exit,
      whileRunning: describeSnapshot(run.checks.whileRunning),
      whileRunningWhy: [
        ...new Set(
          (run.checks.whileRunning?.processes ?? []).map(
            (entry) => `${entry.type}:${entry.why.join("+")}`,
          ),
        ),
      ],
      killCommandMs: run.checks.killCommandMs,
      probeWhileRunning: [
        ...new Set(Object.values(run.checks.probeWhileRunning ?? {})),
      ],
      lastRecordedPidGoneAfterMainMs: stillAlive.length
        ? `still alive 10 s later: ${stillAlive.join(", ")}`
        : Math.max(...dead.map(([, ms]) => ms)),
      deadAfterMainMs: dead
        .map(([pid, ms]) => `${types.get(Number(pid)) ?? "?"}:${pid}=${ms}`)
        .join(" "),
      afterCrash: describeSnapshot(run.checks.afterCrash),
      afterEnd: describeSnapshot(run.checks.afterEnd),
      afterWait: describeSnapshot(run.checks.afterWait),
      leftovers: run.leftovers.map((entry) => `${entry.type}:${entry.pid}`),
      crash: run.events.crashed
        ? {
            reason: run.events.crashed.reason,
            exitCode: run.events.crashed.exitCode,
            crashToGoneEventMs: run.events.crashed.crashToGoneEventMs,
            crashToProcessExitMs: run.events.crashed.crashToProcessExitMs,
            victimPidInOsList: (run.checks.afterCrash?.processes ?? []).some(
              (entry) => entry.pid === run.events.crashed.victimPid,
            ),
            othersAnswered: run.events.crashed.othersAfterCrash.filter(
              (entry) => entry.answered,
            ).length,
            others: run.events.crashed.othersAfterCrash.length,
            victimCall: run.events.crashed.victimCall,
            restartToFirstAnswerMs:
              run.events.restarted?.restartToFirstAnswerMs,
            restartSharing: run.events.restarted?.sharing,
          }
        : undefined,
      problems: run.log.filter(
        (entry) => !["render-process-gone"].includes(entry.event),
      ),
    };
  });
}

function sharingSummary(runs) {
  return runs.map((run) => ({
    processLimit: run.spec.processLimit ?? null,
    sharedPartition: Boolean(run.spec.sharedPartition),
    sameSiteIds: Boolean(run.spec.sameSite),
    plugins: run.spec.plugins,
    sharing: run.events.result?.sharing ?? run.events.ready?.sharing ?? null,
    problems: run.log,
  }));
}

function markdown(summary) {
  const lines = [
    `# Plugin renderer cost (PROTOTYPE, #230/#260)`,
    ``,
    "```json",
    JSON.stringify(summary.machine, null, 2),
    "```",
    ``,
  ];
  if (summary.measure) {
    const ns = Object.keys(summary.measure);
    const row = (label, key, unit = "") =>
      `| ${label} | ${ns.map((n) => `${summary.measure[n][key]}${unit}`).join(" | ")} |`;
    lines.push(
      `| Measure (median of runs) | ${ns.map((n) => `${n} plugin${n === "1" ? "" : "s"}`).join(" | ")} |`,
      `| --- | ${ns.map(() => "---").join(" | ")} |`,
      row("Runs", "succeeded"),
      row("Launch to all first answers (ms)", "launchToFirstAnswerMs"),
      row(
        "View create to first answer, median plugin (ms)",
        "viewColdMedianMs",
      ),
      row("View create to first answer, slowest plugin (ms)", "viewColdMaxMs"),
      row("First call round trip (ms)", "firstCallMs"),
      row("Warm call, sequential, median (ms)", "warmMedianMs"),
      row("Warm call, sequential, p95 (ms)", "warmP95Ms"),
      row("Warm call, all plugins at once, median (ms)", "concurrentMedianMs"),
      row("Renderer working set, getAppMetrics (MB)", "rendererWorkingSetMB"),
      row("Renderer working set, OS (MB)", "osRendererWorkingSetMB"),
      row("Renderer private bytes, getAppMetrics (MB)", "rendererPrivateMB"),
      row("Renderer private bytes, OS (MB)", "osRendererPrivateMB"),
      row(
        "Browser + GPU + utility working set (MB)",
        "nonRendererWorkingSetMB",
      ),
      row("Whole app working set, getAppMetrics (MB)", "totalWorkingSetMB"),
      row("Whole app working set, OS (MB)", "osTotalWorkingSetMB"),
      row("Per-call renderer: create to first answer (ms)", "perCallCreateMs"),
      row(
        "Per-call renderer: close to process exit (ms)",
        "perCallCloseToExitMs",
      ),
      row("app.quit() to main exit (ms)", "quitToExitMs"),
      row("Distinct renderer PIDs per run", "distinctRendererPidsEveryRun"),
      row("Spike processes left 5 s after quit", "leftoversAfterQuit"),
      ``,
    );
  }
  for (const key of ["quit", "kill", "crash"]) {
    if (!summary[key]) continue;
    lines.push(
      `## ${key}`,
      "```json",
      JSON.stringify(summary[key], null, 2),
      "```",
      ``,
    );
  }
  if (summary.sharing)
    lines.push(
      `## sharing stress`,
      "```json",
      JSON.stringify(summary.sharing, null, 2),
      "```",
      ``,
    );
  if (summary.throttle)
    lines.push(
      `## backgroundThrottling off`,
      "```json",
      JSON.stringify(summary.throttle, null, 2),
      "```",
      ``,
    );
  return lines.join("\n");
}

async function main() {
  const mode = option("mode", "measure");
  const runsPerCase = Number(option("runs", mode === "all" ? "5" : "1"));
  const lifecycleRuns = Number(option("lifecycle-runs", "3"));
  const base = {
    processLimit: option("process-limit", undefined),
    sharedPartition: has("shared-partition"),
    noThrottle: has("no-throttle"),
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(
    here,
    "results",
    `${process.platform}-${process.arch}-${stamp}`,
  );
  fs.mkdirSync(outDir, { recursive: true });
  const all = [];
  const runCase = async (spec, count) => {
    const runs = [];
    for (let index = 0; index < count; index += 1) {
      process.stderr.write(
        `run ${spec.mode} plugins=${spec.plugins} ${JSON.stringify({ ...spec, mode: undefined, plugins: undefined })} #${index + 1}/${count}\n`,
      );
      const run = await runOnce(spec);
      runs.push(run);
      all.push(run);
      fs.writeFileSync(
        path.join(
          outDir,
          `run-${String(all.length).padStart(2, "0")}-${spec.mode}-n${spec.plugins}.json`,
        ),
        JSON.stringify(run, null, 2),
      );
      const problems = run.log.filter(
        (entry) => entry.event !== "render-process-gone",
      );
      if (problems.length)
        process.stderr.write(
          `  problems: ${JSON.stringify(problems).slice(0, 800)}\n`,
        );
      if (run.leftovers.length)
        process.stderr.write(
          `  LEFTOVERS: ${JSON.stringify(run.leftovers.map((entry) => [entry.pid, entry.type]))}\n`,
        );
    }
    return runs;
  };

  const summary = { machine: await machine(), electron: null };
  if (mode === "all" || mode === "measure") {
    const counts =
      mode === "all" ? [1, 4, 8] : [Number(option("plugins", "1"))];
    summary.measure = {};
    for (const plugins of counts) {
      summary.measure[plugins] = summarizeMeasure(
        await runCase({ ...base, mode: "measure", plugins }, runsPerCase),
      );
    }
  }
  for (const lifecycle of ["quit", "kill", "crash"]) {
    if (mode === "all" || mode === lifecycle) {
      const plugins = Number(option("plugins", "8"));
      summary[lifecycle] = summarizeLifecycle(
        await runCase(
          { ...base, mode: lifecycle, plugins },
          mode === "all" ? lifecycleRuns : runsPerCase,
        ),
      );
    }
  }
  if (mode === "all" || mode === "sharing") {
    const runs = [];
    for (const sameSite of [false, true]) {
      for (const sharedPartition of [false, true]) {
        runs.push(
          ...(await runCase(
            {
              mode: "measure",
              plugins: 8,
              processLimit: "1",
              sharedPartition,
              sameSite,
            },
            1,
          )),
        );
      }
    }
    summary.sharing = sharingSummary(runs);
  }
  if (mode === "throttle") {
    summary.throttle = {
      on: summarizeMeasure(
        await runCase({ mode: "measure", plugins: 4 }, runsPerCase),
      ),
      off: summarizeMeasure(
        await runCase(
          { mode: "measure", plugins: 4, noThrottle: true },
          runsPerCase,
        ),
      ),
    };
    for (const key of ["on", "off"]) delete summary.throttle[key].perRun;
  }
  summary.electron =
    all.find((run) => run.events["app-ready"])?.events["app-ready"] ?? null;
  summary.leftoversAnyRun = all.flatMap((run) =>
    run.leftovers.map((entry) => ({
      mode: run.spec.mode,
      pid: entry.pid,
      type: entry.type,
    })),
  );
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  const text = markdown(summary);
  fs.writeFileSync(path.join(outDir, "summary.md"), text);
  process.stdout.write(`${text}\nResults: ${outDir}\n`);
}

await main();
