import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createAutomaticUpdateController, isCandidateCoreAtLeastCurrent } =
  require("./electron/automatic-update.cjs") as {
    createAutomaticUpdateController: (options: Record<string, unknown>) => {
      checkNow: (track?: "stable" | "nightly") => Promise<unknown>;
      configure: (track: "stable" | "nightly") => Promise<unknown>;
      updateAndRestart: (track: string, version: string) => Promise<unknown>;
      getState: () => { status: string };
      dispose: () => void;
    };
    isCandidateCoreAtLeastCurrent: (
      current: string,
      candidate: string,
    ) => boolean;
  };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
  cancellationToken = { cancel: vi.fn() };
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
  const dialog = { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) };
  const prepareToInstall = vi.fn().mockResolvedValue(undefined);
  const resetInstallPreparation = vi.fn();
  const checkForUpdates = vi.fn(async (track: string) => ({
    track,
    currentVersion: "1.0.0",
    latestVersion: "1.0.1",
    latestTag: "v1.0.1",
    releaseName: "Ajour 1.0.1",
    releaseUrl: "https://github.com/les-cabochons/ajour/releases/tag/v1.0.1",
    publishedAt: "2026-10-18T12:00:00Z",
    updateAvailable: true,
    checkedAt: "2026-10-19T12:00:00Z",
  }));
  const scheduled: Array<() => void> = [];
  const controller = createAutomaticUpdateController({
    autoUpdater,
    isEnabled: true,
    dialog,
    getMainWindow: () => null,
    prepareToInstall,
    resetInstallPreparation,
    checkForUpdates,
    logger: { error: vi.fn() },
    setTimeoutImpl: (callback: () => void) => {
      scheduled.push(callback);
      return { unref: vi.fn() };
    },
    clearTimeoutImpl: vi.fn(),
    ...overrides,
  });
  return {
    autoUpdater,
    controller,
    dialog,
    prepareToInstall,
    resetInstallPreparation,
    checkForUpdates,
    scheduled,
  };
}

describe("user-controlled desktop updates", () => {
  it("checks on startup, periodically and manually without downloading or prompting", async () => {
    const { autoUpdater, controller, dialog, checkForUpdates, scheduled } =
      createController();
    await controller.configure("stable");
    expect(controller.getState()).toMatchObject({
      status: "available",
      track: "stable",
    });
    scheduled[0]();
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(2));
    await controller.checkNow("stable");
    await controller.configure("nightly");
    expect(checkForUpdates.mock.calls.map(([track]) => track)).toEqual([
      "stable",
      "stable",
      "stable",
      "nightly",
    ]);
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("warns before downloading and leaves a cancelled update available", async () => {
    const { autoUpdater, controller, dialog } = createController();
    await controller.configure("stable");
    await controller.updateAndRestart("stable", "1.0.1");
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "warning",
        buttons: ["Cancel", "Update and restart"],
        defaultId: 0,
        cancelId: 0,
        message: "Update Ajour to 1.0.1?",
        detail: expect.stringContaining("Save your work"),
      }),
    );
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.getState().status).toBe("available");
  });

  it("downloads only the confirmed candidate and waits for shutdown before restarting", async () => {
    const shutdown = deferred<void>();
    const prepareToInstall = vi.fn(() => shutdown.promise);
    const { autoUpdater, controller, dialog } = createController({
      prepareToInstall,
    });
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    await controller.configure("nightly");
    const update = controller.updateAndRestart("nightly", "1.0.1");
    await vi.waitFor(() => expect(prepareToInstall).toHaveBeenCalled());
    expect(autoUpdater).toMatchObject({
      channel: "nightly",
      allowPrerelease: true,
      allowDowngrade: true,
    });
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledWith(
      autoUpdater.cancellationToken,
    );
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    shutdown.resolve();
    await update;
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(controller.getState().status).toBe("installing");
  });

  it("keeps checks available on platforms without in-place installation", async () => {
    const { controller, autoUpdater, dialog } = createController({
      isEnabled: false,
    });
    await controller.configure("stable");
    expect(controller.getState()).toMatchObject({
      status: "available",
      canInstall: false,
    });
    await controller.updateAndRestart("stable", "1.0.1");
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("ignores repeated clicks while confirming and downloading and reports progress", async () => {
    const confirmation = deferred<{ response: number }>();
    const download = deferred<string[]>();
    const { controller, autoUpdater, dialog } = createController();
    dialog.showMessageBox.mockReturnValue(confirmation.promise);
    autoUpdater.downloadUpdate.mockReturnValue(download.promise);
    await controller.configure("stable");
    const update = controller.updateAndRestart("stable", "1.0.1");
    await controller.updateAndRestart("stable", "1.0.1");
    expect(controller.getState().status).toBe("confirming");
    confirmation.resolve({ response: 1 });
    await vi.waitFor(() =>
      expect(autoUpdater.downloadUpdate).toHaveBeenCalled(),
    );
    autoUpdater.emit("download-progress", { percent: 42.2 });
    expect(controller.getState()).toMatchObject({
      status: "downloading",
      progress: 42,
    });
    void controller.checkNow("stable");
    await controller.updateAndRestart("stable", "1.0.1");
    download.resolve(["update.exe"]);
    await update;
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects a different release before downloading", async () => {
    const { controller, autoUpdater, dialog } = createController();
    await controller.configure("stable");
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: "1.0.2" },
    });
    await controller.updateAndRestart("stable", "1.0.1");
    expect(controller.getState()).toMatchObject({
      status: "error",
      error: expect.stringContaining("changed"),
    });
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("invalidates a pending confirmation when the release track changes", async () => {
    const confirmation = deferred<{ response: number }>();
    const { controller, autoUpdater, dialog } = createController();
    dialog.showMessageBox.mockReturnValue(confirmation.promise);
    await controller.configure("nightly");
    const update = controller.updateAndRestart("nightly", "1.0.1");
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled());
    const check = controller.configure("stable");
    confirmation.resolve({ response: 1 });
    await update;
    await check;
    expect(controller.getState()).toMatchObject({
      status: "available",
      track: "stable",
    });
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("cancels a download and ignores its completion after a track change", async () => {
    const download = deferred<string[]>();
    const { controller, autoUpdater, dialog } = createController();
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    autoUpdater.downloadUpdate.mockReturnValue(download.promise);
    await controller.configure("nightly");
    const update = controller.updateAndRestart("nightly", "1.0.1");
    await vi.waitFor(() =>
      expect(autoUpdater.downloadUpdate).toHaveBeenCalled(),
    );
    const check = controller.configure("stable");
    expect(autoUpdater.cancellationToken.cancel).toHaveBeenCalledTimes(1);
    download.resolve(["old.exe"]);
    await update;
    await check;
    expect(controller.getState()).toMatchObject({
      status: "available",
      track: "stable",
    });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("ignores a late availability response after the selected track changes", async () => {
    const { controller, checkForUpdates } = createController();
    const result = await checkForUpdates("nightly");
    const check = deferred<typeof result>();
    checkForUpdates.mockReturnValueOnce(check.promise);
    const nightly = controller.configure("nightly");
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(2));
    const stable = controller.configure("stable");
    check.resolve(result);
    await nightly;
    await stable;
    expect(controller.getState()).toMatchObject({
      track: "stable",
      result: { track: "stable" },
    });
  });

  it("retains a known update after a check failure and permits retry", async () => {
    const { controller, checkForUpdates } = createController();
    await controller.configure("stable");
    checkForUpdates.mockRejectedValueOnce(new Error("Offline"));
    await controller.checkNow();
    expect(controller.getState()).toMatchObject({
      status: "error",
      error: "Offline",
      result: { latestVersion: "1.0.1" },
    });
    await controller.checkNow();
    expect(controller.getState().status).toBe("available");
  });

  it("does not install when the app quits during a confirmed download", async () => {
    const download = deferred<string[]>();
    const { controller, autoUpdater, dialog } = createController();
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    autoUpdater.downloadUpdate.mockReturnValue(download.promise);
    await controller.configure("stable");
    const update = controller.updateAndRestart("stable", "1.0.1");
    await vi.waitFor(() =>
      expect(autoUpdater.downloadUpdate).toHaveBeenCalled(),
    );
    controller.dispose();
    expect(autoUpdater.cancellationToken.cancel).toHaveBeenCalled();
    expect(() =>
      autoUpdater.emit("error", new Error("Download cancelled during quit")),
    ).not.toThrow();
    download.resolve(["cancelled.exe"]);
    await update;
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it("allows retry after a download fails without installing on quit", async () => {
    const { controller, autoUpdater, dialog } = createController();
    await controller.configure("stable");
    dialog.showMessageBox.mockResolvedValue({ response: 1 });
    autoUpdater.downloadUpdate.mockRejectedValueOnce(
      new Error("Download failed"),
    );
    await controller.updateAndRestart("stable", "1.0.1");
    expect(controller.getState()).toMatchObject({
      status: "error",
      error: "Download failed",
    });
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    await controller.updateAndRestart("stable", "1.0.1");
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it.each(["shutdown", "installer"])(
    "restores preparation state after a %s failure",
    async (failure) => {
      const {
        controller,
        autoUpdater,
        dialog,
        prepareToInstall,
        resetInstallPreparation,
      } = createController();
      await controller.configure("stable");
      dialog.showMessageBox.mockResolvedValue({ response: 1 });
      if (failure === "shutdown")
        prepareToInstall.mockRejectedValueOnce(new Error("API stop failed"));
      else
        autoUpdater.quitAndInstall.mockImplementationOnce(() => {
          autoUpdater.emit("error", new Error("Installer launch failed"));
        });
      await controller.updateAndRestart("stable", "1.0.1");
      expect(controller.getState().status).toBe("error");
      expect(resetInstallPreparation).toHaveBeenCalledTimes(1);
    },
  );

  it("retains platform support checks and rejects older version cores", async () => {
    const { autoUpdater } = createController();
    expect(
      await autoUpdater.isUpdateSupported({ version: "1.0.0-nightly.1" }),
    ).toBe(true);
    expect(
      await autoUpdater.isUpdateSupported({ version: "0.9.9-nightly.99" }),
    ).toBe(false);
    autoUpdater.defaultSupportCheck.mockResolvedValueOnce(false);
    expect(await autoUpdater.isUpdateSupported({ version: "1.1.0" })).toBe(
      false,
    );
    expect(isCandidateCoreAtLeastCurrent("2.0.0", "invalid")).toBe(false);
  });
});
