import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/** Matches an `ipcMain.handle("channel", ...)` registration however the call is wrapped. */
function ipcHandler(channel: string) {
  return new RegExp(`ipcMain\\.handle\\(\\s*"${channel}"`);
}

describe("desktop plugin lifecycle", () => {
  it("acquires the single-instance lock before starting application services", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    const lockIndex = source.indexOf("app.requestSingleInstanceLock()");
    const readyIndex = source.indexOf(".whenReady()");

    expect(lockIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(lockIndex);
    expect(source).toContain('app.on("second-instance"');
  });

  it("clears the main window even when it closes during renderer loading", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    const assignmentIndex = source.indexOf("mainWindow = window;");
    const closedListenerIndex = source.indexOf('window.once("closed"');
    const loadIndex = source.indexOf("await recovery.load();");

    expect(assignmentIndex).toBeGreaterThan(-1);
    expect(closedListenerIndex).toBeGreaterThan(assignmentIndex);
    expect(loadIndex).toBeGreaterThan(closedListenerIndex);
  });

  it("uses archive-only production plugins and shuts the API down before quitting", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    expect(source).toContain("allowDevelopmentPlugins: !app.isPackaged");
    expect(source).toContain("bundledPluginArchives: []");
    expect(source).not.toContain("resolveBundledPluginArchives()");
    expect(source).toContain("installedPluginDirectory:");
    expect(source).not.toContain("installPendingUpdate");
    // main-process-errors.test.ts runs the quit and update preparation: a stop
    // that hangs or fails still ends the process, and a cancelled update
    // leaves the next quit stopping the API again.
    expect(source).toContain("prepareToInstall: prepareToInstallUpdate");
    expect(source).toContain(
      "resetInstallPreparation: cancelUpdateInstallPreparation",
    );
  });

  it("keeps plugin installation behind the active desktop window IPC bridge", async () => {
    const [mainSource, preloadSource] = await Promise.all([
      readFile(new URL("./electron/main.cjs", import.meta.url), "utf8"),
      readFile(new URL("./electron/preload.cjs", import.meta.url), "utf8"),
    ]);

    expect(preloadSource).toContain(
      'ipcRenderer.invoke("ajour:install-plugin")',
    );
    expect(mainSource).toMatch(ipcHandler("ajour:install-plugin"));
    expect(mainSource).toContain("event.sender !== mainWindow.webContents");
    expect(mainSource).toContain("selectPluginArchive(");
    expect(mainSource).toContain("installPluginForServer(");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("ajour:uninstall-plugin"',
    );
    expect(mainSource).toMatch(ipcHandler("ajour:uninstall-plugin"));
    expect(mainSource).toContain("uninstallPluginForServer(");
  });

  it("keeps GitHub update checks behind the active desktop window IPC bridge", async () => {
    const [mainSource, preloadSource] = await Promise.all([
      readFile(new URL("./electron/main.cjs", import.meta.url), "utf8"),
      readFile(new URL("./electron/preload.cjs", import.meta.url), "utf8"),
    ]);

    expect(preloadSource).toContain(
      'ipcRenderer.invoke("ajour:check-for-updates", track)',
    );
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("ajour:configure-automatic-updates", track)',
    );
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("ajour:open-update-release", releaseUrl)',
    );
    expect(mainSource).toMatch(ipcHandler("ajour:check-for-updates"));
    expect(mainSource).toMatch(ipcHandler("ajour:configure-automatic-updates"));
    expect(mainSource).toContain("createAutomaticUpdateController({");
    expect(mainSource).toContain(
      'app.isPackaged && process.platform === "win32"',
    );
    expect(mainSource).toContain("automaticUpdatesEnabled,");
    expect(mainSource).toContain("assertActiveDesktopWindow(event");
    expect(mainSource).toContain("currentVersion: app.getVersion()");
    expect(mainSource).toContain("fetchImpl: net.fetch");
    expect(mainSource).toContain("isAllowedReleaseUrl(releaseUrl)");
  });

  it("refreshes the parent-owned plugin catalog on a configurable interval", async () => {
    const [mainSource, preloadSource] = await Promise.all([
      readFile(new URL("./electron/main.cjs", import.meta.url), "utf8"),
      readFile(new URL("./electron/preload.cjs", import.meta.url), "utf8"),
    ]);

    expect(mainSource).toContain("createPluginCatalogService({");
    expect(mainSource).toContain(
      "pluginCatalogSettings.refreshMinutes * 60 * 1000",
    );
    expect(mainSource).toMatch(ipcHandler("ajour:get-plugin-catalog"));
    expect(mainSource).toMatch(ipcHandler("ajour:download-catalog-plugin"));
    expect(mainSource).toContain("{ enableAfterInstall: false }");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("ajour:configure-plugin-catalog", settings)',
    );
    expect(preloadSource).toContain(
      'ipcRenderer.on("ajour:plugin-catalog-updated", listener)',
    );
  });

  it("keeps development directory configuration out of production builds", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "Development plugin directories are unavailable in production builds.",
    );
    expect(source).toContain("selectDevelopmentPluginDirectory(");
    expect(source).toContain("applyDevelopmentPluginDirectories(");
    expect(source).toContain("await stopInternalAppApi()");
    expect(source).toContain("await ensureInternalAppApiRunning()");
  });

  it("replaces the default menu before opening the window", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    const readyIndex = source.indexOf(".whenReady()");
    const menuIndex = source.indexOf("Menu.setApplicationMenu(", readyIndex);
    const windowIndex = source.indexOf("await createMainWindow();", readyIndex);

    expect(readyIndex).toBeGreaterThan(-1);
    expect(menuIndex).toBeGreaterThan(readyIndex);
    expect(windowIndex).toBeGreaterThan(menuIndex);
    expect(source).toContain("developmentBuild: !app.isPackaged");
  });
});
