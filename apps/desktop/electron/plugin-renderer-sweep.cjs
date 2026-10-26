// @ts-check
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * What keeps a plugin renderer from outliving Ajour (#391, decided in #217).
 * Chromium ends its children when main ends, even on a forced kill, so this
 * is the guard for what that misses. While a plugin renderer runs, its
 * process id and start time are recorded in the user data folder. At the
 * next launch, right after the single-instance lock, the sweep ends each
 * recorded process that still runs, but only once the system says it is
 * the same program, started at the same time: a process that took a freed
 * id is never touched. Only one Ajour holds the lock, so anything recorded
 * and still running is an orphan.
 *
 * The sweep never holds a plugin renderer back. It reads the record before
 * any renderer of this session opens, so a renderer of this session is
 * never in what it sweeps, and a new process can't pass for an old one: the
 * start times differ. The record keeps every entry of the last session in
 * its own file (`hold`) until the sweep has dealt with it (`release`), so
 * an entry the sweep couldn't deal with, because the system took too long
 * to answer, is still in the file at the next launch, whatever this
 * session's renderers write meanwhile.
 */

/** The record's file, in the user data folder. */
const PROCESS_RECORD_FILE = "plugin-renderers.json";
/** Two start times this close apart are the same process's. */
const START_TIME_TOLERANCE_MS = 2_000;
/** How long the sweep waits for what it ended to be gone. */
const SWEEP_WAIT_MS = 3_000;
/** How long asking the system about the recorded processes may take. */
const QUERY_TIMEOUT_MS = 15_000;

/**
 * @typedef {{ pid: number, pluginId?: string, createdAt?: number }} RecordedProcess
 * @typedef {{ pid: number, executablePath: string, createdAt?: number }} RunningProcess
 */

/**
 * The live plugin renderers' processes, written to `filePath` as each opens
 * and closes. The file is gone while none runs, as after a normal quit.
 * `remove` takes the entry `add` was given and forgets only that one, so a
 * renderer still closing can't delete the entry of one that took its id.
 * `hold` keeps the last session's entries in the file next to this
 * session's until `release` lets them go; a process that takes a held
 * entry's id replaces it, which is right, since the held one is gone.
 *
 * @param {string} filePath
 * @param {{ fileSystem?: Pick<typeof fs, "writeFileSync" | "renameSync" | "rmSync"> }} [options]
 */
function createProcessRecord(filePath, { fileSystem = fs } = {}) {
  /** @type {Map<number, RecordedProcess>} */
  const live = new Map();
  function write() {
    try {
      if (live.size === 0) {
        fileSystem.rmSync(filePath, { force: true });
        return;
      }
      const temporary = `${filePath}.tmp`;
      fileSystem.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, processes: [...live.values()] }),
      );
      fileSystem.renameSync(temporary, filePath);
    } catch {
      // The record guards a rare case; a write that fails never stops a plugin.
    }
  }
  return {
    /** @param {RecordedProcess} entry */
    add(entry) {
      live.set(entry.pid, entry);
      write();
    },
    /** @param {RecordedProcess} entry */
    remove(entry) {
      if (live.get(entry.pid) !== entry) return;
      live.delete(entry.pid);
      write();
    },
    /** @param {readonly RecordedProcess[]} entries */
    hold(entries) {
      for (const entry of entries) {
        if (!live.has(entry.pid)) live.set(entry.pid, entry);
      }
      write();
    },
    /** @param {readonly RecordedProcess[]} entries The ones `hold` was given. */
    release(entries) {
      for (const entry of entries) {
        if (live.get(entry.pid) === entry) live.delete(entry.pid);
      }
      write();
    },
  };
}

/** @param {unknown} raw @returns {RecordedProcess[] | undefined} */
function recordedProcesses(raw) {
  if (typeof raw !== "object" || raw === null) return undefined;
  const list = /** @type {{ processes?: unknown }} */ (raw).processes;
  if (!Array.isArray(list)) return undefined;
  return list.flatMap((entry) =>
    Number.isInteger(entry?.pid) && entry.pid > 0
      ? [
          {
            pid: entry.pid,
            ...(typeof entry.pluginId === "string"
              ? { pluginId: entry.pluginId }
              : {}),
            ...(Number.isFinite(entry.createdAt)
              ? { createdAt: entry.createdAt }
              : {}),
          },
        ]
      : [],
  );
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {Record<string, string | undefined>} [env] Absent: Ajour's own.
 * @returns {Promise<string>}
 */
function run(file, args, env) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: QUERY_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        ...(env ? { env } : {}),
      },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  });
}

/**
 * What the system says of each of `pids` still running: its executable and
 * when it started. Windows asks CIM, through PowerShell, run by its absolute
 * path: a bare name would search the working folder first. macOS asks `ps`
 * in the C locale, which prints the start time in English whatever the
 * user's language is.
 *
 * @param {number[]} pids
 * @param {string} platform
 * @param {{
 *   run?: typeof run,
 *   env?: Record<string, string | undefined>,
 * }} [options] Where the system is asked, and which environment names `SystemRoot`. Tests set them.
 * @returns {Promise<RunningProcess[]>}
 */
async function describeProcesses(
  pids,
  platform,
  { run: ask = run, env = process.env } = {},
) {
  if (pids.length === 0) return [];
  if (platform === "win32") {
    // Each id is an integer: nothing else reaches the script.
    const ids = pids.filter((pid) => Number.isInteger(pid)).join(",");
    const script = [
      `$found = @(Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object {`,
      "[pscustomobject]@{ pid = $_.Id; path = $_.Path; created = if ($_.StartTime)",
      "{ ([DateTimeOffset]$_.StartTime).ToUnixTimeMilliseconds() } else { $null } } });",
      "ConvertTo-Json -InputObject $found -Compress",
    ].join(" ");
    const output = await ask(
      path.win32.join(
        env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      undefined,
    );
    const parsed = JSON.parse(output.trim() || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) =>
      Number.isInteger(entry?.pid) && typeof entry.path === "string"
        ? [
            {
              pid: entry.pid,
              executablePath: entry.path,
              ...(Number.isFinite(entry.created)
                ? { createdAt: entry.created }
                : {}),
            },
          ]
        : [],
    );
  }
  if (platform === "darwin") {
    // `ps` exits 1 when none of them runs.
    const output = await ask(
      "/bin/ps",
      ["-o", "pid=,lstart=,comm=", "-p", pids.join(",")],
      { ...env, LC_ALL: "C" },
    ).catch((error) => (error?.code === 1 ? "" : Promise.reject(error)));
    return output.split("\n").flatMap((line) => {
      // pid, then "Sun Oct 25 15:39:17 2026", then the executable's path.
      const match =
        /^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/u.exec(line);
      if (!match) return [];
      const createdAt = Date.parse(match[2]);
      return [
        {
          pid: Number(match[1]),
          executablePath: match[3].trim(),
          ...(Number.isFinite(createdAt) ? { createdAt } : {}),
        },
      ];
    });
  }
  return [];
}

/**
 * Whether `running` is the plugin renderer `recorded` names: Ajour's own
 * binary (on macOS, a helper inside Ajour's app bundle), started when the
 * record says. A start time missing on either side says no.
 *
 * @param {RecordedProcess} recorded
 * @param {RunningProcess} running
 * @param {{ execPath: string, platform: string }} self
 */
function isOurRenderer(recorded, running, { execPath, platform }) {
  const fold = (value) =>
    platform === "win32" ? path.win32.normalize(value).toLowerCase() : value;
  const executable = fold(running.executablePath);
  let sameProgram = executable === fold(execPath);
  if (!sameProgram && platform === "darwin") {
    const bundle = /^(.*?\.app)\//u.exec(execPath)?.[1];
    sameProgram = bundle !== undefined && executable.startsWith(`${bundle}/`);
  }
  if (!sameProgram) return false;
  // The program alone proves nothing: Ajour's binary runs many processes,
  // and a freed id may now belong to one of them. Without both start times
  // there is no telling, and nothing is ended on a guess.
  if (recorded.createdAt === undefined || running.createdAt === undefined) {
    return false;
  }
  return (
    Math.abs(recorded.createdAt - running.createdAt) <= START_TIME_TOLERANCE_MS
  );
}

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {{ code?: string }} */ (error).code === "EPERM";
  }
}

/**
 * Ends the plugin renderers a previous session left running, by the
 * processes it recorded. Never rejects. Its `plugin_renderer.sweep` event
 * says what it found, only when there was a record.
 *
 * The record's entries stay in the file, held by `record`, while the sweep
 * asks the system about them, and each is let go once dealt with: ended,
 * gone, or not Ajour's. An entry the sweep couldn't deal with stays held,
 * for the next launch to try again: the system's answer didn't come
 * (`query_failed`, as on a cold computer whose antivirus is scanning
 * PowerShell), or an ended process is still running (`still_running`). An
 * unreadable record is deleted.
 *
 * @param {{
 *   filePath: string,
 *   record: { hold(entries: RecordedProcess[]): void, release(entries: RecordedProcess[]): void },
 *   platform: string,
 *   execPath: string,
 *   events: any,
 *   describe?: (pids: number[], platform: string) => Promise<RunningProcess[]>,
 *   kill?: (pid: number) => void,
 *   alive?: (pid: number) => boolean,
 *   waitMs?: number,
 *   readFile?: (filePath: string) => string,
 *   removeFile?: (filePath: string) => void,
 * }} options
 */
async function sweepOrphanedRenderers({
  filePath,
  record,
  platform,
  execPath,
  events,
  describe = describeProcesses,
  kill = (pid) => process.kill(pid, "SIGKILL"),
  alive = isAlive,
  waitMs = SWEEP_WAIT_MS,
  readFile = (file) => fs.readFileSync(file, "utf8"),
  removeFile = (file) => fs.rmSync(file, { force: true }),
}) {
  let text;
  try {
    text = readFile(filePath);
  } catch {
    // No record: the last session closed every renderer.
    return { recorded: 0, ended: 0, gone: 0, notOurs: 0, stillRunning: 0 };
  }
  const startedAt = Date.now();
  const unit = events.start("plugin_renderer.sweep", {
    kind: "lifecycle",
    trigger: "boot",
    detached: true,
  });
  const counts = {
    recorded: 0,
    ended: 0,
    gone: 0,
    notOurs: 0,
    stillRunning: 0,
  };
  const finish = (outcome, reason) => {
    unit
      .set({
        sweep: {
          recorded: counts.recorded,
          ended: counts.ended,
          gone: counts.gone,
          not_ours: counts.notOurs,
          still_running: counts.stillRunning,
          sweep_ms: Date.now() - startedAt,
        },
      })
      .end(outcome, reason);
    return counts;
  };
  let recorded;
  try {
    recorded = recordedProcesses(JSON.parse(text));
  } catch {
    recorded = undefined;
  }
  if (!recorded) {
    try {
      removeFile(filePath);
    } catch {
      // This session's first renderer writes it over.
    }
    return finish("refused", "unreadable_record");
  }
  recorded = recorded.filter((entry) => entry.pid !== process.pid);
  counts.recorded = recorded.length;
  // Held before anything awaits: this session's renderers write the file
  // too, and the entries must survive that and a quit during the query.
  record.hold(recorded);
  let running;
  try {
    running = await describe(
      recorded.map((entry) => entry.pid),
      platform,
    );
  } catch {
    // Nothing is ended on a guess, and every entry stays for the next launch.
    return finish("error", "query_failed");
  }
  const byPid = new Map(running.map((entry) => [entry.pid, entry]));
  /** @type {RecordedProcess[]} */
  const ended = [];
  /** @type {RecordedProcess[]} */
  const dealtWith = [];
  for (const entry of recorded) {
    const found = byPid.get(entry.pid);
    if (!found) {
      counts.gone += 1;
      dealtWith.push(entry);
    } else if (!isOurRenderer(entry, found, { execPath, platform })) {
      counts.notOurs += 1;
      dealtWith.push(entry);
    } else {
      try {
        kill(entry.pid);
        ended.push(entry);
      } catch {
        // Gone between the query and the kill.
        counts.gone += 1;
        dealtWith.push(entry);
      }
    }
  }
  // A process that is ending may linger a moment: wait on the recorded ids.
  const deadline = Date.now() + waitMs;
  let left = ended.filter((entry) => alive(entry.pid));
  while (left.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    left = left.filter((entry) => alive(entry.pid));
  }
  counts.ended = ended.length - left.length;
  counts.stillRunning = left.length;
  // What still runs stays held, to be ended at the next launch.
  record.release([
    ...dealtWith,
    ...ended.filter((entry) => !left.includes(entry)),
  ]);
  return left.length > 0 ? finish("error", "still_running") : finish("ok");
}

module.exports = {
  PROCESS_RECORD_FILE,
  createProcessRecord,
  describeProcesses,
  isAlive,
  isOurRenderer,
  sweepOrphanedRenderers,
};
