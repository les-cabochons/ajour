const {
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
 */
function createLocalLogs({
  settingsPath,
  open,
  events,
  setInterval = globalThis.setInterval,
  clearInterval = globalThis.clearInterval,
}) {
  let settings = loadLocalLogSettings(settingsPath);
  const file = Promise.resolve()
    .then(() => open(settings))
    .catch(() => null);
  let sweepTimer = null;

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
        unit.set({ logs: result });
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
      },
    });
    return { settings: { ...settings }, ...current };
  }

  return {
    file,
    settings: () => ({ ...settings }),
    /** Stores and applies new settings; what it leaves out stays. Sweeps when a limit changed. */
    async configure(value) {
      const unit = events.current();
      const before = settings;
      const logFile = await loaded();
      const changes =
        value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
      settings = saveLocalLogSettings(settingsPath, {
        ...before,
        ...changes,
      });
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
    /** Delete all logs: the folder goes, whether logging is on or off. */
    async deleteAll() {
      const unit = events.current();
      const deleted = await (await loaded()).deleteAll();
      unit?.set({ logs: deleted });
      return status();
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
    /** Resolves once what the file holds is written. Never rejects. */
    flush: () =>
      file.then((logFile) => logFile?.flush()).catch(() => undefined),
  };
}

module.exports = {
  SWEEP_INTERVAL_MS,
  createLocalLogs,
};
