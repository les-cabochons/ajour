const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60_000;

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

function createAutomaticUpdateController({
  autoUpdater,
  isEnabled,
  checkForUpdates,
  dialog,
  getMainWindow,
  prepareToInstall,
  resetInstallPreparation = () => {},
  onStateChanged = () => {},
  logger = console,
  checkIntervalMs = DEFAULT_UPDATE_CHECK_INTERVAL_MS,
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
    logger.error("Application update failed.", error);
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
    }
    // The check/download promise reports its own failure. Keep a listener so
    // electron-updater's error event never becomes an unhandled EventEmitter error.
  };
  const handleProgress = (info) => {
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
      return checkNow();
    }
    clearScheduledCheck();
    scheduledCheck = setTimeoutImpl(() => {
      scheduledCheck = null;
      void checkNow();
    }, checkIntervalMs);
    scheduledCheck.unref?.();
  }

  function checkNow(track = currentTrack) {
    const changed = selectTrack(track);
    if (operation) {
      if (changed) checkAfterCurrent = true;
      return operation;
    }
    if (state.status === "installing") return Promise.resolve(state);
    clearScheduledCheck();
    const checkGeneration = generation;
    publish({ status: "checking", error: null });
    operation = Promise.resolve()
      .then(() => checkForUpdates(track))
      .then((result) => {
        if (checkGeneration !== generation) return state;
        return publish({
          status: result.updateAvailable ? "available" : "up-to-date",
          result,
          error: null,
          progress: null,
        });
      })
      .catch((error) => {
        if (checkGeneration === generation) fail(error);
        return state;
      })
      .finally(finishOperation);
    return operation;
  }

  function configure(track) {
    const changed = selectTrack(track);
    if (changed && operation) {
      checkAfterCurrent = true;
      return operation;
    }
    return changed ? checkNow() : (operation ?? Promise.resolve(state));
  }

  function updateAndRestart(track, version) {
    assertUpdateTrack(track);
    if (
      disposed ||
      !isEnabled ||
      operation ||
      state.status === "installing" ||
      track !== currentTrack ||
      !state.result?.updateAvailable ||
      version !== state.result.latestVersion
    )
      return Promise.resolve(state);

    clearScheduledCheck();
    const updateGeneration = generation;
    const isCurrent = () => !disposed && updateGeneration === generation;
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
        if (!isCurrent()) return;
        if (response.response !== 1) {
          publish({ status: "available" });
          return;
        }

        autoUpdater.channel = track === "nightly" ? "nightly" : "latest";
        autoUpdater.allowPrerelease = track === "nightly";
        // Same-core stable -> nightly is a SemVer downgrade. The support
        // callback still rejects releases with an older version core.
        autoUpdater.allowDowngrade = track === "nightly";
        const candidate = await autoUpdater.checkForUpdates();
        if (!isCurrent()) return;
        if (
          !candidate?.isUpdateAvailable ||
          candidate.updateInfo?.version !== version
        ) {
          throw new Error(
            "The available update changed. Check for updates again before installing.",
          );
        }
        cancellationToken = candidate.cancellationToken;
        publish({ status: "downloading", progress: 0 });
        await autoUpdater.downloadUpdate(cancellationToken);
        if (!isCurrent()) return;
        publish({ status: "installing", progress: 100 });
        await prepareToInstall();
        if (!isCurrent()) {
          resetInstallPreparation();
          return;
        }
        autoUpdater.quitAndInstall(false, true);
      })
      .catch((error) => {
        if (isCurrent()) {
          resetInstallPreparation();
          fail(error);
        }
      })
      .finally(finishOperation);
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

  return {
    checkNow,
    configure,
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
