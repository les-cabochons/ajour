const { mkdirSync } = require("node:fs");
const {
  applyLocalLogSettings,
  INVALID_LOCAL_LOG_SETTINGS,
  loadLocalLogSettings,
  saveLocalLogSettings,
} = require("./local-log-settings.cjs");

/** How often the retention sweep runs after the one at launch. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Who started a sweep, from what set it off. */
const SWEEP_TRIGGERS = {
  launch: "boot",
  interval: "schedule",
  settings: "user",
};

/**
 * The local log file in the main process (ADR 0014): its stored settings,
 * its retention sweeps, and what its IPC channels do. `open` loads the
 * wide-events package's local log file with the stored settings, the way
 * main loads its emitter; `file` resolves to it, or to null when it could
 * not load. Each method records its result on the active unit, the IPC
 * call's event.
 *
 * `forward` writes the renderer's batches (#440) with no event of its own:
 * what it took and left out since launch is counted on each `logs.sweep`
 * and `logs.status`, as `logs.forwarded`. `launchId` is this launch's: a
 * forwarded event from another launch is left out. `writing()` is whether
 * main is writing events now, and `onWritingChange` runs each time it may
 * have changed, so the renderer stops building and sending while it is not:
 * logging is off, a write failed and stopped it, or the file is unavailable.
 * `openFolder` shows `directory` through `openPath` (Electron's
 * `shell.openPath`, which answers an error message or an empty string); the
 * path stays in main.
 */
function createLocalLogs({
  settingsPath,
  open,
  events,
  launchId,
  onWritingChange = () => {},
  directory,
  openPath,
  setInterval = globalThis.setInterval,
  clearInterval = globalThis.clearInterval,
}) {
  let settings = loadLocalLogSettings(settingsPath);
  /** The log file once `open` resolved to it, for the quit's synchronous drain. */
  let opened = null;
  /** The file could not be loaded, or this process opens none. */
  let unavailable = false;
  const notify = () => {
    try {
      onWritingChange();
    } catch {
      // Telling the window never reaches the work.
    }
  };
  const file = Promise.resolve()
    .then(() => open(settings))
    .then((logFile) => {
      opened = logFile ?? null;
      unavailable = opened === null;
      opened?.onWritingChange(notify);
      if (unavailable) notify();
      return opened;
    })
    .catch(() => {
      unavailable = true;
      notify();
      return null;
    });
  let sweepTimer = null;
  /** What the renderer forwarded since launch (`logs.forwarded`). */
  const forwarded = {
    batch_count: 0,
    dropped_batch_count: 0,
    rejected_batch_count: 0,
    event_count: 0,
    dropped_event_count: 0,
    rejected_event_count: 0,
    unsent_event_count: 0,
  };

  /** Whether events are written now. Until the file opens, it is the setting. */
  function writing() {
    if (unavailable || !settings.enabled) return false;
    return opened ? opened.writing() : true;
  }

  async function loaded() {
    const logFile = await file;
    if (!logFile) throw new Error("The local log file is unavailable.");
    return logFile;
  }

  /** One retention sweep, as its own `logs.sweep` event. */
  function sweep(trigger) {
    return events.run(
      "logs.sweep",
      { kind: "job", trigger: SWEEP_TRIGGERS[trigger], detached: true },
      async (unit) => {
        unit.set({ logs: { trigger } });
        const result = await (await loaded()).sweep();
        unit.set({ logs: { ...result, forwarded: { ...forwarded } } });
        return result;
      },
    );
  }

  async function status(unit) {
    const current = await (await loaded()).status();
    unit?.set({
      logs: {
        state: current.state,
        warning: current.warning,
        file_count: current.file_count,
        storage_bytes: current.storage_bytes,
        dropped_event_count: current.dropped_event_count,
        forwarded: { ...forwarded },
      },
    });
    return { settings: { ...settings }, ...current };
  }

  return {
    file,
    settings: () => ({ ...settings }),
    writing,
    /**
     * Stores and applies new settings; what it leaves out stays. Sweeps when
     * a limit changed. A value outside its closed set refuses the call, which
     * throws and changes nothing: no setting, no file, no sweep.
     */
    async configure(value) {
      const unit = events.current();
      const before = settings;
      let next;
      try {
        next = applyLocalLogSettings(before, value);
      } catch (error) {
        if (error?.code === INVALID_LOCAL_LOG_SETTINGS) {
          unit?.refuse("invalid_settings");
        }
        throw error;
      }
      const logFile = await loaded();
      settings = saveLocalLogSettings(settingsPath, next);
      logFile.configure(settings);
      unit?.set({
        logs: {
          enabled_before: before.enabled,
          enabled_after: settings.enabled,
          retention_days: settings.retention_days,
          size_limit_mb: settings.size_limit_mb,
          include_sensitive: settings.include_sensitive,
        },
      });
      if (
        before.retention_days !== settings.retention_days ||
        before.size_limit_mb !== settings.size_limit_mb
      ) {
        await sweep("settings");
      }
      return status();
    },
    status: () => status(events.current()),
    /**
     * Opens the log folder in the OS file manager, making it first when
     * logging has not yet written. The path never leaves main.
     */
    async openFolder() {
      if (!directory || !openPath) {
        throw new Error("The log folder is unavailable.");
      }
      mkdirSync(directory, { recursive: true });
      const failure = await openPath(directory);
      if (failure) throw new Error("The log folder could not be opened.");
    },
    /**
     * Delete all logs: every day file goes, whether logging is on or off, and
     * the folder with them when nothing else is in it.
     */
    async deleteAll() {
      const unit = events.current();
      const deleted = await (await loaded()).deleteAll();
      unit?.set({ logs: deleted });
      return status();
    },
    /**
     * Writes a batch of the renderer's events: only those whose envelope is
     * valid for this launch's renderer, through the file's privacy filter.
     * It emits no event and never throws; a batch that arrives before the
     * file loaded, or after it failed to, is dropped and counted.
     */
    forward(batch) {
      try {
        if (!opened) {
          forwarded.dropped_batch_count += 1;
          return;
        }
        const result = opened.forward(batch, {
          runtime: "renderer",
          launch_id: launchId,
        });
        forwarded.batch_count += 1;
        forwarded.rejected_batch_count += result.rejected_batch_count;
        forwarded.event_count += result.accepted_event_count;
        forwarded.dropped_event_count += result.dropped_event_count;
        forwarded.rejected_event_count += result.rejected_event_count;
        forwarded.unsent_event_count += result.unsent_event_count;
      } catch {
        // Forwarding never reaches the work.
      }
    },
    /** Sweeps now, as at launch, and then every hour. */
    startSweeps() {
      if (sweepTimer) return;
      void sweep("launch").catch(() => undefined);
      sweepTimer = setInterval(() => {
        void sweep("interval").catch(() => undefined);
      }, SWEEP_INTERVAL_MS);
      sweepTimer.unref?.();
    },
    stopSweeps() {
      if (sweepTimer) clearInterval(sweepTimer);
      sweepTimer = null;
    },
    /**
     * Writes what is waiting, synchronously, for a process about to exit
     * (see the log file's `drainSync`). Never throws.
     */
    drainSync() {
      try {
        opened?.drainSync();
      } catch {
        // Quitting goes on without the last events.
      }
    },
    /** Resolves once what the file holds is written. Never rejects. */
    flush: () =>
      file.then((logFile) => logFile?.flush()).catch(() => undefined),
  };
}

module.exports = {
  SWEEP_INTERVAL_MS,
  createLocalLogs,
};
