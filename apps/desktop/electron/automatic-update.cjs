const { apiStopOf, triggerOf } = require("./main-events.cjs");

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60_000;
/** The quit's own bound: the installer quits Ajour well within it. */
const INSTALLER_HANDOFF_TIMEOUT_MS = 10_000;

function assertUpdateTrack(track) {
  if (track !== "stable" && track !== "nightly") {
    throw new Error("Update track must be stable or nightly.");
  }
}

function readVersionCore(version) {
  if (
    version &&
    Number.isInteger(version.major) &&
    Number.isInteger(version.minor) &&
    Number.isInteger(version.patch)
  ) {
    return [version.major, version.minor, version.patch];
  }

  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(String(version ?? ""));
  return match ? match.slice(1).map(Number) : null;
}

function isCandidateCoreAtLeastCurrent(currentVersion, candidateVersion) {
  const current = readVersionCore(currentVersion);
  const candidate = readVersionCore(candidateVersion);
  if (!current || !candidate) {
    return false;
  }

  for (let index = 0; index < current.length; index += 1) {
    if (candidate[index] !== current[index]) {
      return candidate[index] > current[index];
    }
  }
  return true;
}

/** A check's state as its update.check event records it. */
function checkResultOf(state) {
  if (state.status === "available") return "available";
  if (state.status === "up-to-date") return "up_to_date";
  if (state.status === "error") return "failed";
  return undefined;
}

/**
 * The application update state, its checks and its installs. Each check
 * emits `update.check` and each install `update.install`: on the IPC event
 * that asked for it when the caller passes its `unit`, or else as its own job.
 */
function createAutomaticUpdateController({
  autoUpdater,
  isEnabled,
  checkForUpdates,
  dialog,
  getMainWindow,
  prepareToInstall,
  resetInstallPreparation = () => {},
  onStateChanged = (_state) => {},
  events,
  now = Date.now,
  checkIntervalMs = DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  /** How long an install's event waits, after the handoff, for the app to quit. */
  handoffTimeoutMs = INSTALLER_HANDOFF_TIMEOUT_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  let currentTrack = null;
  let generation = 0;
  let operation = null;
  let scheduledCheck = null;
  let cancellationToken = null;
  let checkAfterCurrent = false;
  let disposed = false;
  /** The error the last check failed with, for the checks that joined it. */
  let lastCheckError = null;
  /**
   * The install in progress, until its operation settles, so an updater error
   * lands on its event. electron-updater reports an installer that cannot
   * start from inside quitAndInstall.
   */
  let activeInstall = null;
  /** Ends the wait after the handoff: the app quits, or the installer failed. */
  let settleHandoff = null;
  /** The total size of the update being downloaded, from its progress. */
  let downloadBytes;
  let state = {
    status: "idle",
    track: null,
    result: null,
    progress: null,
    error: null,
    canInstall: isEnabled,
  };

  const defaultIsUpdateSupported = autoUpdater.isUpdateSupported;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.isUpdateSupported = async (info) =>
    (typeof defaultIsUpdateSupported !== "function" ||
      (await defaultIsUpdateSupported(info))) &&
    isCandidateCoreAtLeastCurrent(autoUpdater.currentVersion, info?.version);

  function publish(patch) {
    state = { ...state, ...patch };
    onStateChanged(state);
    return state;
  }

  function fail(error) {
    return publish({
      status: "error",
      progress: null,
      error: error instanceof Error ? error.message : "The update failed.",
    });
  }

  const handleUpdaterError = (error) => {
    if (disposed) return;
    if (state.status === "installing") {
      generation += 1;
      resetInstallPreparation();
      fail(error);
      // The install's one event takes the error, where the install was.
      activeInstall?.fail(error);
    }
    // The check/download promise reports its own failure. Keep a listener so
    // electron-updater's error event never becomes an unhandled EventEmitter error.
  };
  const handleProgress = (info) => {
    if (Number.isFinite(info?.total)) downloadBytes = info.total;
    if (state.status === "downloading" && Number.isFinite(info?.percent)) {
      const progress = Math.max(0, Math.min(100, Math.round(info.percent)));
      if (progress !== state.progress) publish({ progress });
    }
  };
  autoUpdater.on("error", handleUpdaterError);
  autoUpdater.on("download-progress", handleProgress);

  function clearScheduledCheck() {
    if (scheduledCheck) clearTimeoutImpl(scheduledCheck);
    scheduledCheck = null;
  }

  function selectTrack(track) {
    assertUpdateTrack(track);
    if (disposed) throw new Error("Application updates have stopped.");
    // Shutdown preparation may already have stopped the internal API.
    // Keep the confirmed installation current through restart.
    if (state.status === "installing") return false;
    if (track === currentTrack) return false;
    currentTrack = track;
    generation += 1;
    cancellationToken?.cancel();
    cancellationToken = null;
    publish({
      status: "idle",
      track,
      result: null,
      progress: null,
      error: null,
    });
    return true;
  }

  function finishOperation() {
    operation = null;
    cancellationToken = null;
    if (disposed || state.status === "installing") return;
    if (checkAfterCurrent) {
      checkAfterCurrent = false;
      return checkNow(currentTrack, { trigger: "track_change" });
    }
    clearScheduledCheck();
    scheduledCheck = setTimeoutImpl(() => {
      scheduledCheck = null;
      void checkNow(currentTrack, { trigger: "schedule" });
    }, checkIntervalMs);
    scheduledCheck.unref?.();
  }

  /**
   * The unit a check or install records on: the caller's, or its own job,
   * which never folds into a unit that happens to be active, such as the IPC
   * call whose check finished just before.
   */
  function unitFor(name, unit, trigger) {
    if (unit) return { unit, own: false };
    return {
      unit: events.start(name, {
        kind: "job",
        trigger: triggerOf(trigger),
        detached: true,
      }),
      own: true,
    };
  }

  /** Records how a check ended, once its operation settled. */
  function recordCheck(unit, own, settled, superseded) {
    if (superseded) {
      unit.set({ update: { result: "superseded" } }).cancel("superseded");
    } else {
      const result = checkResultOf(settled);
      unit.set({
        update: {
          ...(result ? { result } : {}),
          ...(settled.result
            ? {
                current_version: settled.result.currentVersion,
                latest_version: settled.result.latestVersion ?? undefined,
                available: settled.result.updateAvailable,
              }
            : {}),
        },
      });
      if (result === "failed") unit.fail(lastCheckError);
    }
    if (own) unit.end();
    return settled;
  }

  /**
   * Checks the track now. `unit` is the event of the IPC call that asked for
   * it; `trigger` says why the check runs.
   */
  /**
   * @param {string} [track]
   * @param {{ unit?: any, trigger?: string }} [options]
   */
  function checkNow(track = currentTrack, { unit, trigger = "manual" } = {}) {
    const changed = selectTrack(track);
    const check = unitFor("update.check", unit, trigger);
    check.unit.set({ update: { trigger, track } });
    if (operation) {
      if (changed) checkAfterCurrent = true;
      check.unit.set({ update: { cache: "joined" } });
      // The running operation may be an install, which resolves nothing.
      return operation.then((settled) => {
        recordCheck(check.unit, check.own, state, false);
        return settled;
      });
    }
    if (state.status === "installing") {
      check.unit.set({ update: { result: "unchanged" } }).end("noop");
      return Promise.resolve(state);
    }
    clearScheduledCheck();
    const checkGeneration = generation;
    const report = {};
    let superseded = false;
    publish({ status: "checking", error: null });
    operation = Promise.resolve()
      .then(() => checkForUpdates(track, report))
      .then((result) => {
        if (checkGeneration !== generation) {
          superseded = true;
          return state;
        }
        return publish({
          status: result.updateAvailable ? "available" : "up-to-date",
          result,
          error: null,
          progress: null,
        });
      })
      .catch((error) => {
        if (checkGeneration === generation) {
          lastCheckError = error;
          fail(error);
        } else {
          superseded = true;
        }
        return state;
      })
      .finally(() => {
        check.unit.set({ update: report });
        return finishOperation();
      });
    return operation.then((settled) =>
      recordCheck(check.unit, check.own, settled, superseded),
    );
  }

  /**
   * @param {string} track
   * @param {{ unit?: any }} [options]
   */
  function configure(track, { unit } = {}) {
    const changed = selectTrack(track);
    if (changed && operation) {
      checkAfterCurrent = true;
      unit?.set({
        update: { trigger: "track_change", track, cache: "joined" },
      });
      return operation;
    }
    if (changed) return checkNow(track, { unit, trigger: "track_change" });
    unit?.set({
      update: { trigger: "track_change", track, result: "unchanged" },
    });
    unit?.end("noop");
    return operation ?? Promise.resolve(state);
  }

  /**
   * Asks to confirm, downloads, stops the local API and hands over to the
   * installer. `unit` is the event of the IPC call that asked for it. It
   * ends in the task that hands over, since the process quits right after.
   * Only the offered release's version enters it, never the one the
   * renderer named.
   */
  /**
   * @param {string} track
   * @param {string} version
   * @param {{ unit?: any }} [options]
   */
  function updateAndRestart(track, version, { unit } = {}) {
    assertUpdateTrack(track);
    const install = unitFor("update.install", unit, "manual");
    install.unit.set({
      update: {
        track,
        ...(state.result?.currentVersion
          ? { from_version: state.result.currentVersion }
          : {}),
      },
    });
    if (
      disposed ||
      !isEnabled ||
      operation ||
      state.status === "installing" ||
      track !== currentTrack ||
      !state.result?.updateAvailable ||
      version !== state.result.latestVersion
    ) {
      install.unit.set({ update: { stopped_at: "not_ready" } }).end("noop");
      return Promise.resolve(state);
    }
    install.unit.set({ update: { to_version: state.result.latestVersion } });

    clearScheduledCheck();
    const updateGeneration = generation;
    const isCurrent = () => !disposed && updateGeneration === generation;
    let step = "confirm";
    const active = {
      fail(error) {
        install.unit.set({ update: { stopped_at: step } }).fail(error);
        settleHandoff?.();
      },
    };
    activeInstall = active;
    const stoppedBy = (outcome) => {
      // An updater error already recorded where the install stopped.
      if (install.unit.outcome === "error") return;
      install.unit.set({ update: { stopped_at: step } });
      if (outcome === "superseded") install.unit.cancel("superseded");
      else if (outcome) install.unit.cancel();
    };
    publish({ status: "confirming", error: null, progress: null });
    operation = Promise.resolve()
      .then(async () => {
        const options = {
          type: "warning",
          buttons: ["Cancel", "Update and restart"],
          defaultId: 0,
          cancelId: 0,
          title: "Update Ajour",
          message: `Update Ajour to ${version}?`,
          detail:
            "Ajour will download the update and restart to install it. Save your work before continuing.",
          noLink: true,
        };
        const window = getMainWindow();
        const response =
          window && !window.isDestroyed?.()
            ? await dialog.showMessageBox(window, options)
            : await dialog.showMessageBox(options);
        if (!isCurrent()) return stoppedBy("superseded");
        if (response.response !== 1) {
          install.unit.set({ update: { confirm: "cancel" } });
          stoppedBy("cancelled");
          publish({ status: "available" });
          return;
        }
        install.unit.set({ update: { confirm: "update" } });

        step = "recheck";
        autoUpdater.channel = track === "nightly" ? "nightly" : "latest";
        autoUpdater.allowPrerelease = track === "nightly";
        // Same-core stable -> nightly is a SemVer downgrade. The support
        // callback still rejects releases with an older version core.
        autoUpdater.allowDowngrade = track === "nightly";
        const candidate = await autoUpdater.checkForUpdates();
        if (!isCurrent()) return stoppedBy("superseded");
        if (
          !candidate?.isUpdateAvailable ||
          candidate.updateInfo?.version !== version
        ) {
          throw new Error(
            "The available update changed. Check for updates again before installing.",
          );
        }
        step = "download";
        cancellationToken = candidate.cancellationToken;
        publish({ status: "downloading", progress: 0 });
        downloadBytes = undefined;
        const downloadStartedAt = now();
        await autoUpdater.downloadUpdate(cancellationToken);
        install.unit.set({
          update: {
            download_ms: now() - downloadStartedAt,
            ...(downloadBytes !== undefined
              ? { download_bytes: downloadBytes }
              : {}),
          },
        });
        if (!isCurrent()) return stoppedBy("superseded");
        step = "prepare";
        publish({ status: "installing", progress: 100 });
        const stopStartedAt = now();
        const stop = await prepareToInstall();
        install.unit.set({
          update: {
            api_stop_ms: now() - stopStartedAt,
            ...(apiStopOf(stop) ? { api_stop: apiStopOf(stop) } : {}),
          },
        });
        if (!isCurrent()) {
          resetInstallPreparation();
          return stoppedBy("superseded");
        }
        step = "install";
        install.unit.set({ update: { stopped_at: "install" } });
        autoUpdater.quitAndInstall(false, true);
        // electron-updater reports an installer that fails to start later,
        // so the event waits for the app to quit for it, within the quit's
        // time, and an updater error meanwhile lands on it.
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, handoffTimeoutMs);
          timer.unref?.();
          settleHandoff = () => {
            clearTimeout(timer);
            resolve();
          };
          if (install.unit.outcome === "error") settleHandoff();
        });
        settleHandoff = null;
        install.unit.end();
      })
      .catch((error) => {
        if (isCurrent()) {
          resetInstallPreparation();
          fail(error);
          active.fail(error);
        } else {
          stoppedBy("superseded");
        }
      })
      .finally(() => {
        if (activeInstall === active) activeInstall = null;
        if (install.own) install.unit.end();
        return finishOperation();
      });
    return operation.then(() => state);
  }

  function dispose() {
    disposed = true;
    generation += 1;
    cancellationToken?.cancel();
    clearScheduledCheck();
    // A cancelled download can emit an error before its promise settles.
    // Keep the listener until that operation has finished during shutdown.
    const removeErrorListener = () =>
      autoUpdater.removeListener("error", handleUpdaterError);
    if (operation)
      void operation.then(removeErrorListener, removeErrorListener);
    else removeErrorListener();
    autoUpdater.removeListener("download-progress", handleProgress);
    autoUpdater.isUpdateSupported = defaultIsUpdateSupported;
  }

  /** The app is quitting for the installer: the install's event ends. */
  function installerQuitting() {
    settleHandoff?.();
  }

  return {
    checkNow,
    configure,
    installerQuitting,
    updateAndRestart,
    getState: () => state,
    dispose,
  };
}

module.exports = {
  DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  createAutomaticUpdateController,
  isCandidateCoreAtLeastCurrent,
};
