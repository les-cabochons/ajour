import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createAutomaticUpdateController,
  isCandidateCoreAtLeastCurrent,
} = require("./electron/automatic-update.cjs") as {
  createAutomaticUpdateController: (options: Record<string, unknown>) => {
    checkNow: (track?: "stable" | "nightly") => Promise<unknown>;
    configure: (track: "stable" | "nightly") => Promise<unknown>;
    dispose: () => void;
    installPendingUpdate: () => boolean;
    isInstallingUpdate: () => boolean;
  };
  isCandidateCoreAtLeastCurrent: (
    currentVersion: string | { major: number; minor: number; patch: number },
    candidateVersion: string,
  ) => boolean;
};

function createCancellationToken() {
  return { cancel: vi.fn() };
}

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  disableWebInstaller = false;
  channel: string | null = null;
  allowPrerelease = false;
  allowDowngrade = false;
  currentVersion = { major: 1, minor: 0, patch: 0 };
  defaultSupportCheck = vi.fn().mockResolvedValue(true);
  isUpdateSupported = this.defaultSupportCheck;
  cancellationToken = createCancellationToken();
  checkForUpdates = vi.fn().mockImplementation(async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: "1.0.1" },
    cancellationToken: this.cancellationToken,
  }));
  downloadUpdate = vi.fn().mockResolvedValue(["update.exe"]);
  quitAndInstall = vi.fn();
}

function createController(overrides: Record<string, unknown> = {}) {
  const autoUpdater = new FakeUpdater();
  const dialog = {
    showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
  };
  const prepareToInstall = vi.fn().mockResolvedValue(undefined);
  const resetInstallPreparation = vi.fn();
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const controller = createAutomaticUpdateController({
    autoUpdater,
    isEnabled: true,
    dialog,
    getMainWindow: () => null,
    prepareToInstall,
    resetInstallPreparation,
    logger,
    setTimeoutImpl: vi.fn(() => ({ unref: vi.fn() })),
    clearTimeoutImpl: vi.fn(),
    ...overrides,
  });

  return {
    autoUpdater,
    controller,
    dialog,
    logger,
    prepareToInstall,
    resetInstallPreparation,
  };
}

function emitDownloadedUpdate(autoUpdater: FakeUpdater) {
  autoUpdater.downloadUpdate.mockImplementationOnce(async () => {
    autoUpdater.emit("update-downloaded", { version: "1.0.1" });
    return ["update.exe"];
  });
}

describe("desktop automatic updates", () => {
  it("manually downloads from the selected stable or nightly channel", async () => {
    const { autoUpdater, controller } = createController();

    await controller.configure("stable");
    expect(autoUpdater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      disableWebInstaller: true,
      channel: "latest",
      allowPrerelease: false,
      allowDowngrade: false,
    });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledWith(
      autoUpdater.cancellationToken,
    );

    autoUpdater.cancellationToken = createCancellationToken();
    await controller.configure("nightly");
    expect(autoUpdater).toMatchObject({
      channel: "nightly",
      allowPrerelease: true,
      allowDowngrade: true,
    });
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it("does not contact the update service when automatic installation is disabled", async () => {
    const { autoUpdater, controller } = createController({ isEnabled: false });

    await controller.configure("stable");
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("asks before restarting and installs the current-track downloaded update", async () => {
    const { autoUpdater, controller, dialog, prepareToInstall } = createController();
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
    emitDownloadedUpdate(autoUpdater);

    await controller.configure("stable");
    await vi.waitFor(() => expect(prepareToInstall).toHaveBeenCalledTimes(1));

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ["Restart now", "Later"],
        message: "HarDay 1.0.1 has been downloaded.",
      }),
    );
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(controller.isInstallingUpdate()).toBe(true);
  });

  it("installs a current-track Later update only when the main process quits", async () => {
    const { autoUpdater, controller, dialog, prepareToInstall } = createController();
    emitDownloadedUpdate(autoUpdater);

    await controller.configure("stable");
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1));

    expect(prepareToInstall).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.installPendingUpdate()).toBe(true);
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("invalidates a downloaded nightly update when the user switches to stable", async () => {
    const { autoUpdater, controller, dialog } = createController();
    emitDownloadedUpdate(autoUpdater);

    await controller.configure("nightly");
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1));

    autoUpdater.cancellationToken = createCancellationToken();
    await controller.configure("stable");

    expect(controller.installPendingUpdate()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("cancels an in-progress download and ignores its completion after a track switch", async () => {
    const { autoUpdater, controller, dialog } = createController();
    let resolveDownload!: (value: string[]) => void;
    const downloadPromise = new Promise<string[]>((resolve) => {
      resolveDownload = resolve;
    });
    autoUpdater.downloadUpdate.mockReturnValueOnce(downloadPromise);

    const nightlyCheck = controller.configure("nightly");
    await vi.waitFor(() => expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1));
    const nightlyToken = autoUpdater.cancellationToken;
    autoUpdater.cancellationToken = createCancellationToken();
    const stableCheck = controller.configure("stable");

    expect(nightlyToken.cancel).toHaveBeenCalledTimes(1);
    autoUpdater.emit("update-downloaded", { version: "1.0.1" });
    resolveDownload(["nightly.exe"]);
    await nightlyCheck;
    await stableCheck;
    await vi.waitFor(() => expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2));

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(controller.installPendingUpdate()).toBe(false);
  });

  it("restores install preparation state when shutdown preparation fails", async () => {
    const { autoUpdater, controller, dialog, resetInstallPreparation } =
      createController({
        prepareToInstall: vi.fn().mockRejectedValue(new Error("API stop failed")),
      });
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
    emitDownloadedUpdate(autoUpdater);

    await controller.configure("stable");
    await vi.waitFor(() => expect(resetInstallPreparation).toHaveBeenCalledTimes(1));

    expect(controller.isInstallingUpdate()).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("restores install preparation state when the updater reports an install error", async () => {
    const { autoUpdater, controller, dialog, resetInstallPreparation } =
      createController();
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
    emitDownloadedUpdate(autoUpdater);

    await controller.configure("stable");
    await vi.waitFor(() => expect(controller.isInstallingUpdate()).toBe(true));
    autoUpdater.emit("error", new Error("installer launch failed"));

    expect(controller.isInstallingUpdate()).toBe(false);
    expect(resetInstallPreparation).toHaveBeenCalledTimes(1);
  });

  it("retains default platform support checks and rejects lower version cores", async () => {
    const { autoUpdater, controller } = createController();

    await controller.configure("nightly");

    expect(await autoUpdater.isUpdateSupported({ version: "1.0.0-nightly.1" })).toBe(true);
    expect(await autoUpdater.isUpdateSupported({ version: "0.9.9-nightly.99" })).toBe(false);
    expect(await autoUpdater.isUpdateSupported({ version: "1.1.0-nightly.1" })).toBe(true);
    expect(autoUpdater.defaultSupportCheck).toHaveBeenCalledTimes(3);
  });
});

describe("automatic update version-core guard", () => {
  it("accepts the same or a newer core and rejects an older core", () => {
    expect(isCandidateCoreAtLeastCurrent("2.0.0", "2.0.0-nightly.1")).toBe(true);
    expect(isCandidateCoreAtLeastCurrent("2.0.0", "2.1.0-nightly.1")).toBe(true);
    expect(isCandidateCoreAtLeastCurrent("2.0.0", "1.99.99-nightly.99")).toBe(false);
    expect(isCandidateCoreAtLeastCurrent("2.0.0", "invalid")).toBe(false);
  });
});
