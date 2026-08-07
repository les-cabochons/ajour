import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("desktop connector lifecycle", () => {
  it("acquires the single-instance lock before starting application services", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    const lockIndex = source.indexOf("app.requestSingleInstanceLock()");
    const readyIndex = source.indexOf("app.whenReady()");

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
    const loadIndex = source.indexOf("await window.loadURL(rendererUrl);");

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
    expect(source).toContain('app.on("before-quit"');
    expect(source).toContain("automaticUpdateController.installPendingUpdate()");
    expect(source).toContain("stopInternalAppApi().finally(() => {");
  });

  it("does not poison graceful quit state when update preparation fails", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    const preparationStart = source.indexOf("prepareToInstall: async () => {");
    const stopIndex = source.indexOf("await stopInternalAppApi();", preparationStart);
    const quitFlagIndex = source.indexOf(
      "gracefulQuitStarted = true;",
      preparationStart,
    );
    const preparationEnd = source.indexOf("},", preparationStart);

    expect(preparationStart).toBeGreaterThan(-1);
    expect(stopIndex).toBeGreaterThan(preparationStart);
    expect(quitFlagIndex).toBeGreaterThan(stopIndex);
    expect(quitFlagIndex).toBeLessThan(preparationEnd);
    expect(source).toContain("resetInstallPreparation: () => {");
    expect(source).toContain("gracefulQuitStarted = false;");
  });

  it("keeps connector installation behind the active desktop window IPC bridge", async () => {
    const [mainSource, preloadSource] = await Promise.all([
      readFile(new URL("./electron/main.cjs", import.meta.url), "utf8"),
      readFile(new URL("./electron/preload.cjs", import.meta.url), "utf8"),
    ]);

    expect(preloadSource).toContain(
      'ipcRenderer.invoke("timetracker:install-connector-plugin")',
    );
    expect(mainSource).toContain(
      'ipcMain.handle("timetracker:install-connector-plugin"',
    );
    expect(mainSource).toContain("event.sender !== mainWindow.webContents");
    expect(mainSource).toContain("selectConnectorPluginArchive(");
    expect(mainSource).toContain("installConnectorPluginForServer(");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("timetracker:uninstall-connector-plugin"',
    );
    expect(mainSource).toContain(
      'ipcMain.handle("timetracker:uninstall-connector-plugin"',
    );
    expect(mainSource).toContain("uninstallConnectorPluginForServer(");
  });

  it("keeps GitHub update checks behind the active desktop window IPC bridge", async () => {
    const [mainSource, preloadSource] = await Promise.all([
      readFile(new URL("./electron/main.cjs", import.meta.url), "utf8"),
      readFile(new URL("./electron/preload.cjs", import.meta.url), "utf8"),
    ]);

    expect(preloadSource).toContain(
      'ipcRenderer.invoke("timetracker:check-for-updates", track)',
    );
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("timetracker:configure-automatic-updates", track)',
    );
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("timetracker:open-update-release", releaseUrl)',
    );
    expect(mainSource).toContain(
      'ipcMain.handle("timetracker:check-for-updates"',
    );
    expect(mainSource).toContain(
      'ipcMain.handle("timetracker:configure-automatic-updates"',
    );
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
    expect(mainSource).toContain("pluginCatalogSettings.refreshMinutes * 60 * 1000");
    expect(mainSource).toContain('ipcMain.handle("timetracker:get-plugin-catalog"');
    expect(mainSource).toContain('ipcMain.handle("timetracker:download-catalog-plugin"');
    expect(mainSource).toContain("{ enableAfterInstall: false }");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke("timetracker:configure-plugin-catalog", settings)',
    );
    expect(preloadSource).toContain(
      'ipcRenderer.on("timetracker:plugin-catalog-updated", listener)',
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
});
