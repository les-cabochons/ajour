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
  dialog,
  getMainWindow,
  prepareToInstall,
  resetInstallPreparation = () => {},
  logger = console,
  checkIntervalMs = DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  let currentTrack = null;
  let trackGeneration = 0;
  let hasConfigured = false;
  let operationPromise = null;
  let activeOperationTrack = null;
  let activeCancellationToken = null;
  let activeDownload = null;
  let checkAfterCurrent = false;
  let scheduledCheck = null;
  let pendingUpdate = null;
  let promptedUpdateKey = null;
  let installingUpdate = false;

  const defaultIsUpdateSupported = autoUpdater.isUpdateSupported;

  // The controller owns both downloading and installation so a track change can
  // invalidate preview content that electron-updater may still have cached.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.isUpdateSupported = async (info) => {
    if (
      typeof defaultIsUpdateSupported === "function" &&
      !(await defaultIsUpdateSupported(info))
    ) {
      return false;
    }
    return isCandidateCoreAtLeastCurrent(autoUpdater.currentVersion, info?.version);
  };

  const handleUpdaterError = (error) => {
    if (installingUpdate) {
      installingUpdate = false;
      resetInstallPreparation();
    }
    logger.error("Automatic update failed.", error);
  };

  const handleUpdateDownloaded = (info) => {
    const version = typeof info?.version === "string" ? info.version : "unknown";
    const download = activeDownload;
    if (
      !download ||
      download.generation !== trackGeneration ||
      download.track !== currentTrack ||
      download.version !== version
    ) {
      logger.info?.(`Ignored stale automatic update download ${version}.`);
      return;
    }

    const update = { ...download };
    pendingUpdate = update;
    const updateKey = `${update.generation}:${update.track}:${update.version}`;
    if (promptedUpdateKey === updateKey || installingUpdate) {
      return;
    }
    promptedUpdateKey = updateKey;
    void promptToRestart(update).catch((error) => {
      logger.error("Unable to show the downloaded update prompt.", error);
    });
  };

  if (isEnabled) {
    autoUpdater.on("error", handleUpdaterError);
    autoUpdater.on("update-downloaded", handleUpdateDownloaded);
  }

  function isCurrentUpdate(update) {
    return Boolean(
      update &&
      pendingUpdate === update &&
      update.generation === trackGeneration &&
      update.track === currentTrack,
    );
  }

  function cancelActiveOperation() {
    try {
      activeCancellationToken?.cancel?.();
    } catch (error) {
      logger.warn?.("Unable to cancel the previous automatic update download.", error);
    }
    activeCancellationToken = null;
    activeDownload = null;
  }

  function selectTrack(track) {
    assertUpdateTrack(track);
    if (currentTrack === track) {
      return false;
    }

    currentTrack = track;
    trackGeneration += 1;
    pendingUpdate = null;
    promptedUpdateKey = null;
    cancelActiveOperation();
    return true;
  }

  function applyTrack(track) {
    assertUpdateTrack(track);
    autoUpdater.channel = track === "nightly" ? "nightly" : "latest";
    autoUpdater.allowPrerelease = track === "nightly";
    // Same-core stable -> nightly is a SemVer downgrade. The composed
    // isUpdateSupported callback above rejects older major/minor/patch cores.
    autoUpdater.allowDowngrade = track === "nightly";
  }

  function configure(track) {
    const trackChanged = selectTrack(track);

    if (!isEnabled) {
      hasConfigured = true;
      return Promise.resolve(null);
    }

    if (!hasConfigured || trackChanged) {
      hasConfigured = true;
      return checkNow();
    }

    return operationPromise ?? Promise.resolve(null);
  }

  function checkNow(track = currentTrack) {
    const trackChanged = selectTrack(track);

    if (!isEnabled) {
      return Promise.resolve(null);
    }

    if (scheduledCheck) {
      clearTimeoutImpl(scheduledCheck);
      scheduledCheck = null;
    }

    if (operationPromise) {
      if (trackChanged || activeOperationTrack !== currentTrack) {
        checkAfterCurrent = true;
      }
      return operationPromise;
    }

    applyTrack(currentTrack);
    const operationTrack = currentTrack;
    const operationGeneration = trackGeneration;
    activeOperationTrack = operationTrack;
    operationPromise = Promise.resolve()
      .then(async () => {
        const result = await autoUpdater.checkForUpdates();
        if (
          operationGeneration !== trackGeneration ||
          operationTrack !== currentTrack ||
          !result?.isUpdateAvailable
        ) {
          return result;
        }

        const version = result.updateInfo?.version;
        if (typeof version !== "string") {
          throw new Error("The update service returned an invalid version.");
        }

        activeCancellationToken = result.cancellationToken ?? null;
        activeDownload = {
          generation: operationGeneration,
          track: operationTrack,
          version,
        };
        await autoUpdater.downloadUpdate(result.cancellationToken);
        return result;
      })
      .catch((error) => {
        if (
          operationGeneration === trackGeneration &&
          operationTrack === currentTrack
        ) {
          logger.error("Automatic update check or download failed.", error);
        }
        return null;
      })
      .finally(() => {
        activeCancellationToken = null;
        activeDownload = null;
        operationPromise = null;
        activeOperationTrack = null;
        if (checkAfterCurrent) {
          checkAfterCurrent = false;
          void checkNow();
        } else {
          scheduleNextCheck();
        }
      });

    return operationPromise;
  }

  function scheduleNextCheck() {
    if (!isEnabled || currentTrack === null) {
      return;
    }
    if (scheduledCheck) {
      clearTimeoutImpl(scheduledCheck);
    }
    scheduledCheck = setTimeoutImpl(() => {
      scheduledCheck = null;
      void checkNow();
    }, checkIntervalMs);
    scheduledCheck.unref?.();
  }

  async function promptToRestart(update) {
    if (!isCurrentUpdate(update)) {
      return;
    }

    const options = {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "HarDay update ready",
      message: `HarDay ${update.version} has been downloaded.`,
      detail: "Restart HarDay to finish installing the update. Choosing Later installs it when you next quit the app.",
      noLink: true,
    };
    const window = getMainWindow();
    const result = window && !window.isDestroyed?.()
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);

    if (result.response !== 0 || installingUpdate || !isCurrentUpdate(update)) {
      return;
    }

    installingUpdate = true;
    try {
      await prepareToInstall();
      if (!isCurrentUpdate(update)) {
        installingUpdate = false;
        resetInstallPreparation();
        return;
      }
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      installingUpdate = false;
      resetInstallPreparation();
      logger.error("Unable to restart HarDay for the downloaded update.", error);
    }
  }

  function installPendingUpdate() {
    const update = pendingUpdate;
    if (!isCurrentUpdate(update) || installingUpdate) {
      return false;
    }

    installingUpdate = true;
    try {
      autoUpdater.quitAndInstall(false, true);
      return true;
    } catch (error) {
      installingUpdate = false;
      resetInstallPreparation();
      logger.error("Unable to install the downloaded update while quitting.", error);
      return false;
    }
  }

  function dispose() {
    trackGeneration += 1;
    pendingUpdate = null;
    cancelActiveOperation();
    if (scheduledCheck) {
      clearTimeoutImpl(scheduledCheck);
      scheduledCheck = null;
    }
    if (isEnabled) {
      autoUpdater.removeListener("error", handleUpdaterError);
      autoUpdater.removeListener("update-downloaded", handleUpdateDownloaded);
    }
    autoUpdater.isUpdateSupported = defaultIsUpdateSupported;
  }

  return {
    checkNow,
    configure,
    dispose,
    installPendingUpdate,
    isInstallingUpdate: () => installingUpdate,
  };
}

module.exports = {
  DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  createAutomaticUpdateController,
  isCandidateCoreAtLeastCurrent,
};
