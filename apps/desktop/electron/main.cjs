const { existsSync, readdirSync } = require("node:fs");
const { stat } = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const {
  buildAppMenuTemplate,
  findAppMenuRoleItem,
  getAppMenuModel,
} = require("./app-menu.cjs");
const { createAutomaticUpdateController } = require("./automatic-update.cjs");
const {
  MAC_ICON_SYMBOLS,
  buildContextMenuTemplate,
  buildEditContextMenuTemplate,
  getPopupPosition,
  normalizeContextMenuItems,
} = require("./context-menu.cjs");
const { selectPluginArchive } = require("./plugin-install.cjs");
const { createPluginCatalogService } = require("./plugin-catalog.cjs");
const {
  loadPluginCatalogSettings,
  savePluginCatalogSettings,
} = require("./plugin-catalog-settings.cjs");
const {
  clearDevelopmentPluginDirectories,
  loadDevelopmentPluginDirectories,
  saveDevelopmentPluginDirectories,
  selectDevelopmentPluginDirectory,
} = require("./development-plugin-settings.cjs");
const { createIpcListeners } = require("./ipc-listeners.cjs");
const {
  loadDesktopBootstrapLocalState,
} = require("./local-state-bootstrap.cjs");
const { classifyNavigation } = require("./navigation.cjs");
const { stopWithin } = require("./stop-within.cjs");
const {
  getPlatformWindowChromeOptions,
  getWindowsTitleBarOverlay,
} = require("./window-chrome.cjs");
const { watchWindow } = require("./window-recovery.cjs");
const {
  createUpdateCheckCoordinator,
  isAllowedReleaseUrl,
} = require("./update-check.cjs");

const DESKTOP_USER_DATA_DIRNAME = "Ajour";
const stableUserDataPath =
  process.env.AJOUR_USER_DATA_PATH ??
  path.join(app.getPath("appData"), DESKTOP_USER_DATA_DIRNAME);
if (app.getPath("userData") !== stableUserDataPath) {
  app.setPath("userData", stableUserDataPath);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const staticRoot = app.isPackaged
  ? path.join(process.resourcesPath, "dist-desktop")
  : path.resolve(__dirname, "../../web/dist-desktop");
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, "assets", "ajour-icon.png")
  : path.resolve(__dirname, "../../../assets/ajour-icon.png");
const preloadPath = path.resolve(__dirname, "preload.cjs");
const INTERNAL_APP_API_HOST = process.env.AJOUR_APP_API_HOST ?? "127.0.0.1";
const INTERNAL_APP_API_PORT = Number(process.env.AJOUR_APP_API_PORT ?? 8787);
const internalAppApiRuntimeRoot = app.isPackaged
  ? path.join(process.resourcesPath, "internal-app-runtime")
  : path.resolve(__dirname, "../../..");
const internalAppApiEntryPath = app.isPackaged
  ? path.join(internalAppApiRuntimeRoot, "apps/api/src/server.ts")
  : path.resolve(__dirname, "../../api/src/server.ts");

let internalAppApiServer = null;
let internalAppApiStartPromise = null;
let internalAppApiStopPromise = null;
let internalAppApiModulePromise = null;
let desktopBootstrapLocalState = null;
let developmentPluginDirectoriesOverride;
let mainWindow = null;
let gracefulQuitStarted = false;
let pluginCatalogRefreshPromise = null;
let pluginCatalogRefreshTimer = null;
const automaticUpdatesEnabled = app.isPackaged && process.platform === "win32";
const appMenuModel = getAppMenuModel({
  platform: process.platform,
  developmentBuild: !app.isPackaged,
  appName: app.name,
});
const checkForUpdatesCoordinated = createUpdateCheckCoordinator();
const automaticUpdateController = createAutomaticUpdateController({
  autoUpdater,
  isEnabled: automaticUpdatesEnabled,
  checkForUpdates: (track) =>
    checkForUpdatesCoordinated({
      track,
      currentVersion: app.getVersion(),
      fetchImpl: net.fetch,
    }),
  onStateChanged: (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("ajour:update-state-changed", state);
    }
  },
  dialog,
  getMainWindow: () => mainWindow,
  prepareToInstall: async () => {
    await stopInternalAppApiWithinTimeout();
    gracefulQuitStarted = true;
  },
  resetInstallPreparation: () => {
    gracefulQuitStarted = false;
  },
});

const developmentPluginSettingsPath = path.join(
  app.getPath("userData"),
  "development-plugins.json",
);
const pluginCatalogSettingsPath = path.join(
  app.getPath("userData"),
  "plugin-catalog-settings.json",
);
let pluginCatalogSettings = loadPluginCatalogSettings(
  pluginCatalogSettingsPath,
);
const pluginCatalogService = createPluginCatalogService({
  cacheDirectory: path.join(app.getPath("userData"), "plugin-catalog"),
  fetchImpl: net.fetch,
});

function refreshPluginCatalog() {
  pluginCatalogRefreshPromise ??= pluginCatalogService
    .refresh()
    .then((catalog) => {
      mainWindow?.webContents.send("ajour:plugin-catalog-updated", catalog);
      return catalog;
    })
    .finally(() => {
      pluginCatalogRefreshPromise = null;
    });
  return pluginCatalogRefreshPromise;
}

function schedulePluginCatalogRefresh() {
  if (pluginCatalogRefreshTimer) {
    clearInterval(pluginCatalogRefreshTimer);
    pluginCatalogRefreshTimer = null;
  }
  if (pluginCatalogSettings.refreshMinutes === 0) {
    return;
  }
  pluginCatalogRefreshTimer = setInterval(
    () => {
      void refreshPluginCatalog().catch((error) => {
        console.error("Unable to refresh the plugin catalog.", error);
      });
    },
    pluginCatalogSettings.refreshMinutes * 60 * 1000,
  );
  pluginCatalogRefreshTimer.unref?.();
}

// Every `ipcMain.on` listener registers through `ipc`, so none can throw into
// the main process. A failed synchronous request answers null.
const ipc = createIpcListeners(ipcMain);

ipc.answerSync("ajour:get-bootstrap-local-state", () => {
  desktopBootstrapLocalState ??= loadDesktopBootstrapLocalState({
    appDataPath: app.getPath("appData"),
    currentUserDataPath: app.getPath("userData"),
  });
  return desktopBootstrapLocalState;
});

ipc.answerSync("ajour:get-runtime-info", () => ({
  automaticUpdatesEnabled,
  developmentBuild: !app.isPackaged,
  platform: process.platform,
  version: app.getVersion(),
}));

ipc.answerSync("ajour:get-app-menu", () => appMenuModel);

// The Windows title bar menus run role items (Copy, Zoom in, Exit) through the
// hidden native menu, so they behave like the macOS menu bar.
ipc.onMessage("ajour:run-menu-item", (event, itemId) => {
  assertActiveDesktopWindow(event, "run a menu item");
  if (!findAppMenuRoleItem(appMenuModel, itemId)) {
    return;
  }

  Menu.getApplicationMenu()
    ?.getMenuItemById(itemId)
    ?.click(undefined, mainWindow, mainWindow.webContents);
});

// Object right-click menus. Resolves with the picked item's id, or null when
// the menu closes without a pick.
ipcMain.handle("ajour:show-context-menu", (event, items, position) => {
  assertActiveDesktopWindow(event, "show a context menu");
  const menuItems = normalizeContextMenuItems(items);
  if (menuItems.length === 0) {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (id) => {
      if (!settled) {
        settled = true;
        resolve(id);
      }
    };
    const menu = Menu.buildFromTemplate(
      buildContextMenuTemplate(menuItems, {
        platform: process.platform,
        onSelect: settle,
        getIcon: getContextMenuIcon,
      }),
    );
    menu.popup({
      window: mainWindow,
      ...getPopupPosition(position, event.sender.getZoomFactor()),
      // Let a click that closed the menu report its pick first.
      callback: () => setTimeout(() => settle(null)),
    });
  });
});

// Cut and Copy from an object menu run the page's own commands, which fire
// the cut and copy events the renderer listens to, as the Edit menu does.
ipc.onMessage("ajour:run-edit-command", (event, command) => {
  assertActiveDesktopWindow(event, "run an edit command");
  if (command === "cut") {
    event.sender.cut();
  } else if (command === "copy") {
    event.sender.copy();
  }
});

// Native menus and macOS window chrome follow the app's theme, not only the
// system's.
ipc.onMessage("ajour:set-theme-source", (event, mode) => {
  assertActiveDesktopWindow(event, "update the theme");
  if (mode === "system" || mode === "dark" || mode === "light") {
    nativeTheme.themeSource = mode;
  }
});

ipc.onMessage("ajour:set-window-chrome-theme", (event, theme) => {
  assertActiveDesktopWindow(event, "update the window chrome theme");
  if (process.platform !== "win32") {
    return;
  }
  if (theme !== "dark" && theme !== "light") {
    return;
  }

  mainWindow.setTitleBarOverlay(getWindowsTitleBarOverlay(theme));
});

ipcMain.handle("ajour:check-for-updates", async (event, track) => {
  assertActiveDesktopWindow(event, "check for application updates");
  return await automaticUpdateController.checkNow(track);
});

ipcMain.handle("ajour:get-update-state", (event) => {
  assertActiveDesktopWindow(event, "read application update state");
  return automaticUpdateController.getState();
});

ipcMain.handle("ajour:update-and-restart", async (event, track, version) => {
  assertActiveDesktopWindow(event, "update and restart the application");
  return await automaticUpdateController.updateAndRestart(track, version);
});

ipcMain.handle("ajour:configure-automatic-updates", async (event, track) => {
  assertActiveDesktopWindow(event, "configure automatic application updates");
  await automaticUpdateController.configure(track);
});

ipcMain.handle("ajour:open-update-release", async (event, releaseUrl) => {
  assertActiveDesktopWindow(event, "open an application update release");
  if (!isAllowedReleaseUrl(releaseUrl)) {
    throw new Error("The update release URL is not allowed.");
  }
  await shell.openExternal(releaseUrl);
});

ipcMain.handle("ajour:install-plugin", async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error(
      "Plugins can only be installed by the active Ajour window.",
    );
  }
  if (!app.isPackaged) {
    throw new Error(
      "Packaged plugin installation is only available in production builds.",
    );
  }

  const selectedArchive = await selectPluginArchive(dialog, mainWindow);
  if (!selectedArchive) {
    return null;
  }

  await ensureInternalAppApiRunning();
  if (!internalAppApiServer || !internalAppApiModulePromise) {
    throw new Error("Internal app API unavailable. Restart the app.");
  }

  const { installPluginForServer } = await internalAppApiModulePromise;
  if (typeof installPluginForServer !== "function") {
    throw new Error("Internal app API does not support plugin installation.");
  }

  return await installPluginForServer(
    internalAppApiServer,
    selectedArchive.archiveBytes,
    selectedArchive.archiveFilename,
  );
});

ipcMain.handle("ajour:get-plugin-catalog", async (event) => {
  assertActiveDesktopWindow(event, "read the plugin catalog");
  return (
    pluginCatalogService.getCurrentCatalog() ?? (await refreshPluginCatalog())
  );
});

ipcMain.handle("ajour:get-plugin-catalog-settings", async (event) => {
  assertActiveDesktopWindow(event, "read plugin catalog settings");
  return pluginCatalogSettings;
});

ipcMain.handle("ajour:configure-plugin-catalog", async (event, settings) => {
  assertActiveDesktopWindow(event, "configure the plugin catalog");
  pluginCatalogSettings = savePluginCatalogSettings(
    pluginCatalogSettingsPath,
    settings,
  );
  schedulePluginCatalogRefresh();
  return pluginCatalogSettings;
});

ipcMain.handle("ajour:download-catalog-plugin", async (event, pluginId) => {
  assertActiveDesktopWindow(event, "download a plugin");
  if (!app.isPackaged) {
    throw new Error(
      "Catalog plugin downloads are only available in production builds.",
    );
  }
  if (
    typeof pluginId !== "string" ||
    pluginId.length < 2 ||
    pluginId.length > 64
  ) {
    throw new Error("The catalog plugin identifier is invalid.");
  }

  const downloaded = await pluginCatalogService.downloadPluginArchive(pluginId);
  await ensureInternalAppApiRunning();
  if (!internalAppApiServer || !internalAppApiModulePromise) {
    throw new Error("Internal app API unavailable. Restart the app.");
  }
  const { installPluginForServer } = await internalAppApiModulePromise;
  if (typeof installPluginForServer !== "function") {
    throw new Error("Internal app API does not support plugin installation.");
  }
  const result = await installPluginForServer(
    internalAppApiServer,
    downloaded.archiveBytes,
    downloaded.archiveFilename,
    { enableAfterInstall: false },
  );
  return { type: "plugin", result };
});

ipcMain.handle("ajour:uninstall-plugin", async (event, pluginId) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error(
      "Plugins can only be uninstalled by the active Ajour window.",
    );
  }
  if (!app.isPackaged) {
    throw new Error(
      "Development directory plugins cannot be uninstalled by the app.",
    );
  }

  await ensureInternalAppApiRunning();
  if (!internalAppApiServer || !internalAppApiModulePromise) {
    throw new Error("Internal app API unavailable. Restart the app.");
  }

  const { uninstallPluginForServer } = await internalAppApiModulePromise;
  if (typeof uninstallPluginForServer !== "function") {
    throw new Error("Internal app API does not support plugin uninstall.");
  }

  return await uninstallPluginForServer(internalAppApiServer, pluginId);
});

ipcMain.handle("ajour:get-development-plugin-settings", async (event) => {
  assertActiveDesktopWindow(event, "read development plugin settings");
  return getDevelopmentPluginSettings();
});

ipcMain.handle("ajour:select-development-plugin-directory", async (event) => {
  assertDevelopmentBuild(event, "configure development plugin directories");
  const directory = await selectDevelopmentPluginDirectory(dialog, mainWindow);
  if (!directory) {
    return null;
  }

  await applyDevelopmentPluginDirectories([directory]);
  return getDevelopmentPluginSettings();
});

ipcMain.handle("ajour:clear-development-plugin-directories", async (event) => {
  assertDevelopmentBuild(event, "reset development plugin directories");
  await applyDevelopmentPluginDirectories(null);
  return getDevelopmentPluginSettings();
});

/** Runs a registry action in the renderer, such as "time.day-view". */
function sendMenuAction(action) {
  mainWindow?.webContents.send("ajour:menu-action", action);
}

const contextMenuIcons = new Map();

/** The macOS menu icon for `icon`, or undefined where it cannot load. */
function getContextMenuIcon(icon) {
  if (process.platform !== "darwin") {
    return undefined;
  }
  if (!contextMenuIcons.has(icon)) {
    let image;
    try {
      image = nativeImage
        .createFromNamedImage(MAC_ICON_SYMBOLS[icon])
        .resize({ height: 14 });
      image.setTemplateImage(true);
    } catch {
      image = undefined;
    }
    contextMenuIcons.set(icon, image && !image.isEmpty() ? image : undefined);
  }
  return contextMenuIcons.get(icon);
}

/**
 * Shows the edit menu on a right-click that no object menu claimed. Object
 * menus cancel the page's contextmenu event, so Electron only reports the
 * right-clicks they leave alone.
 */
function showEditContextMenu(window, params) {
  const { webContents } = window;
  const template = buildEditContextMenuTemplate(params, {
    replaceMisspelling: (word) => webContents.replaceMisspelling(word),
    addToDictionary: (word) =>
      webContents.session.addWordToSpellCheckerDictionary(word),
    copyText: (text) => clipboard.writeText(text),
    copySelection: () => webContents.send("ajour:copy-selection"),
  });
  if (template.length > 0) {
    Menu.buildFromTemplate(template).popup({
      window,
      // Where the page asked for the menu: the pointer, or the caret when
      // Shift+F10 or the menu key opened it.
      x: params.x,
      y: params.y,
      // macOS features such as Writing Tools need the frame.
      ...(params.frame ? { frame: params.frame } : {}),
    });
  }
}

function assertActiveDesktopWindow(event, action) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error(`Only the active Ajour window can ${action}.`);
  }
}

function assertDevelopmentBuild(event, action) {
  assertActiveDesktopWindow(event, action);
  if (app.isPackaged) {
    throw new Error(
      "Development plugin directories are unavailable in production builds.",
    );
  }
}

async function resolveAssetPath(requestPath) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const candidate = path.resolve(staticRoot, `.${normalizedPath}`);
  const relativeCandidate = path.relative(staticRoot, candidate);

  if (
    relativeCandidate.startsWith("..") ||
    path.isAbsolute(relativeCandidate)
  ) {
    return path.join(staticRoot, "index.html");
  }

  try {
    const candidateStat = await stat(candidate);
    if (candidateStat.isDirectory()) {
      return path.join(candidate, "index.html");
    }

    return candidate;
  } catch {
    return path.join(staticRoot, "index.html");
  }
}

function registerStaticProtocol() {
  protocol.handle("app", async (request) => {
    const requestUrl = new URL(request.url);
    const assetPath = await resolveAssetPath(
      decodeURIComponent(requestUrl.pathname),
    );
    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkInternalAppApiHealth(timeoutMs = 750) {
  return await new Promise((resolve) => {
    const request = http.get(
      {
        host: INTERNAL_APP_API_HOST,
        port: INTERNAL_APP_API_PORT,
        path: "/api/health",
      },
      (response) => {
        const isHealthy = response.statusCode === 200;
        response.resume();
        response.once("end", () => resolve(isHealthy));
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Internal app API health check timed out"));
    });
    request.once("error", () => resolve(false));
  });
}

async function waitForInternalAppApiStartup(apiProcess) {
  let lastError = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (internalAppApiServer !== apiProcess) {
      throw lastError ?? new Error("Internal app API failed to start");
    }

    if (await checkInternalAppApiHealth()) {
      return;
    }

    lastError = new Error("Internal app API is still starting");
    await delay(150);
  }

  throw lastError ?? new Error("Internal app API failed to start");
}

function internalAppApiPortInUseError(cause) {
  return new Error(
    `Ajour's plugin runtime cannot start because port ${INTERNAL_APP_API_PORT} is already in use. Close the other app or development server using this port, then try again.`,
    { cause },
  );
}

async function ensureInternalAppApiRunning() {
  if (internalAppApiServer) {
    await waitForInternalAppApiStartup(internalAppApiServer);
    return;
  }

  if (internalAppApiStartPromise) {
    return await internalAppApiStartPromise;
  }

  internalAppApiStartPromise = (async () => {
    if (internalAppApiStopPromise) {
      await internalAppApiStopPromise;
    }

    if (await checkInternalAppApiHealth()) {
      throw internalAppApiPortInUseError();
    }

    if (!existsSync(internalAppApiEntryPath)) {
      throw new Error(
        `Internal app API entry missing: ${internalAppApiEntryPath}`,
      );
    }

    internalAppApiModulePromise ??= import(
      pathToFileURL(internalAppApiEntryPath).toString()
    );
    const { startAppApiServer } = await internalAppApiModulePromise;
    if (typeof startAppApiServer !== "function") {
      throw new Error(
        `Internal app API module is missing startAppApiServer: ${internalAppApiEntryPath}`,
      );
    }

    const apiServer = await startAppApiServer({
      host: INTERNAL_APP_API_HOST,
      port: INTERNAL_APP_API_PORT,
      statePath:
        process.env.AJOUR_APP_API_STATE_PATH ??
        path.join(app.getPath("userData"), "app-api-state.json"),
      installedPluginDirectory: path.join(app.getPath("userData"), "plugins"),
      developmentPluginDirectories: app.isPackaged
        ? []
        : resolveDevelopmentPluginDirectories(),
      bundledPluginArchives: [],
      allowDevelopmentPlugins: !app.isPackaged,
      allowedOrigins: app.isPackaged
        ? ["app://local"]
        : ["http://127.0.0.1:5173"],
    }).catch((error) => {
      if (error?.code === "EADDRINUSE") {
        throw internalAppApiPortInUseError(error);
      }
      throw error;
    });
    internalAppApiServer = apiServer;

    try {
      await waitForInternalAppApiStartup(apiServer);
    } catch (error) {
      if (internalAppApiServer === apiServer) {
        internalAppApiServer = null;
      }

      await new Promise((resolve, reject) => {
        apiServer.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }

          resolve();
        });
      });

      throw error;
    }
  })().finally(() => {
    internalAppApiStartPromise = null;
  });

  return await internalAppApiStartPromise;
}

async function stopInternalAppApi() {
  if (internalAppApiStartPromise) {
    try {
      await internalAppApiStartPromise;
    } catch {
      // Start failures already reset internal API state.
    }
  }

  if (!internalAppApiServer) {
    return;
  }

  if (internalAppApiStopPromise) {
    return await internalAppApiStopPromise;
  }

  const apiServer = internalAppApiServer;
  internalAppApiStopPromise = (async () => {
    const { stopAppApiServer } = await internalAppApiModulePromise;
    await stopAppApiServer(apiServer);
    if (internalAppApiServer === apiServer) {
      internalAppApiServer = null;
    }
  })().finally(() => {
    internalAppApiStopPromise = null;
  });

  return await internalAppApiStopPromise;
}

// Quitting waits this long for the local API to stop. The agent runner gives a
// running agent's CLI 5 seconds to exit, then 1 more to clean up, so a healthy
// stop always fits.
const INTERNAL_APP_API_STOP_TIMEOUT_MS = 10_000;

/**
 * Stops the local API for a quit or an update. Resolves "timed-out" when it is
 * still stopping after the timeout, so quitting never hangs on it.
 */
function stopInternalAppApiWithinTimeout() {
  return stopWithin(stopInternalAppApi(), INTERNAL_APP_API_STOP_TIMEOUT_MS);
}

async function resolveRendererUrl() {
  if (process.env.AJOUR_DESKTOP_RENDERER_URL) {
    return process.env.AJOUR_DESKTOP_RENDERER_URL;
  }

  return "app://local/";
}

function resolveDevelopmentPluginDirectories() {
  if (developmentPluginDirectoriesOverride !== undefined) {
    return (
      developmentPluginDirectoriesOverride ??
      resolveAutomaticDevelopmentPluginDirectories()
    );
  }

  const configuredDirectories =
    resolveEnvironmentDevelopmentPluginDirectories();
  if (configuredDirectories.length > 0) {
    return configuredDirectories;
  }

  const savedDirectories = loadDevelopmentPluginDirectories(
    developmentPluginSettingsPath,
  );
  if (savedDirectories) {
    return savedDirectories;
  }

  return resolveRepositoryDevelopmentPluginDirectories();
}

function resolveAutomaticDevelopmentPluginDirectories() {
  const configuredDirectories =
    resolveEnvironmentDevelopmentPluginDirectories();
  return configuredDirectories.length > 0
    ? configuredDirectories
    : resolveRepositoryDevelopmentPluginDirectories();
}

function resolveEnvironmentDevelopmentPluginDirectories() {
  return (
    process.env.AJOUR_DEV_PLUGIN_DIRS?.split(path.delimiter)
      .map((directory) => directory.trim())
      .filter(Boolean) ?? []
  );
}

function resolveRepositoryDevelopmentPluginDirectories() {
  const pluginRoot = path.join(internalAppApiRuntimeRoot, "plugins");
  if (!existsSync(pluginRoot)) {
    return [];
  }

  return readdirSync(pluginRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(pluginRoot, entry.name, "plugin.json")),
    )
    .map((entry) => path.join(pluginRoot, entry.name));
}

function getDevelopmentPluginSettings() {
  if (app.isPackaged) {
    return { available: false, directories: [] };
  }

  return {
    available: true,
    directories: resolveDevelopmentPluginDirectories(),
  };
}

async function applyDevelopmentPluginDirectories(directories) {
  const previousOverride = developmentPluginDirectoriesOverride;
  developmentPluginDirectoriesOverride = directories;

  try {
    await stopInternalAppApi();
    await ensureInternalAppApiRunning();
    if (directories === null) {
      clearDevelopmentPluginDirectories(developmentPluginSettingsPath);
    } else {
      saveDevelopmentPluginDirectories(
        developmentPluginSettingsPath,
        directories,
      );
    }
  } catch (error) {
    developmentPluginDirectoriesOverride = previousOverride;
    await stopInternalAppApi();
    try {
      await ensureInternalAppApiRunning();
    } catch {
      // Preserve the original configuration error for the Debug page.
    }
    throw error;
  }
}

/**
 * Opens a web or mail link in the system's browser or mail app. A link the
 * system cannot open is dropped; the wide-events work (#308) emits it here.
 */
function openExternalLink(url) {
  shell.openExternal(url).catch(() => {});
}

/**
 * Startup failed before the window could load, as when the window cannot be
 * created. Says why and quits, so no windowless process keeps the instance
 * lock. The wide-events work (#308) emits `app.error` here.
 */
function quitAfterStartupFailure(error) {
  dialog.showErrorBox(
    "Ajour could not start",
    typeof error?.message === "string" ? error.message : String(error),
  );
  app.quit();
}

async function createMainWindow() {
  const rendererUrl = await resolveRendererUrl();
  const platformChromeOptions = getPlatformWindowChromeOptions(
    process.platform,
    nativeTheme.shouldUseDarkColors ? "dark" : "light",
  );

  const window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 390,
    minHeight: 550,
    autoHideMenuBar: true,
    backgroundColor: "#f4eee5",
    icon: iconPath,
    title: "Ajour",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
    ...platformChromeOptions,
  });

  mainWindow = window;
  window.once("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  // Reloads a crashed page, asks about a hung one or a failed load, and is
  // where the wide-events work (#308) emits `process.gone` and
  // `window.unresponsive`.
  const recovery = watchWindow(window, {
    url: rendererUrl,
    dialog,
    quit: () => app.quit(),
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, rendererUrl) === "external") {
      openExternalLink(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("context-menu", (_event, params) => {
    showEditContextMenu(window, params);
  });

  window.webContents.on("will-navigate", (event, navigationUrl) => {
    const destination = classifyNavigation(navigationUrl, rendererUrl);
    if (destination === "app") {
      return;
    }

    event.preventDefault();
    if (destination === "external") {
      openExternalLink(navigationUrl);
    }
  });

  await recovery.load();
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      if (process.platform === "darwin") {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }

      if (!process.env.AJOUR_DESKTOP_RENDERER_URL) {
        registerStaticProtocol();
      }

      // Replaces Electron's default menu, which keeps Reload and DevTools in
      // packaged builds. Windows hides it under the title bar overlay. The
      // renderer can draw the same menus in the title bar, but that is turned
      // off for now.
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(
          buildAppMenuTemplate(appMenuModel, {
            platform: process.platform,
            sendAction: sendMenuAction,
          }),
        ),
      );

      void refreshPluginCatalog().catch((error) => {
        console.error("Unable to refresh the plugin catalog.", error);
      });
      schedulePluginCatalogRefresh();

      try {
        await ensureInternalAppApiRunning();
      } catch (error) {
        console.error("Failed to start internal app API.", error);
      }

      await createMainWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow().catch(quitAfterStartupFailure);
        }
      });
    })
    .catch(quitAfterStartupFailure);

  app.on("before-quit", (event) => {
    if (gracefulQuitStarted) {
      return;
    }

    gracefulQuitStarted = true;
    if (pluginCatalogRefreshTimer) {
      clearInterval(pluginCatalogRefreshTimer);
      pluginCatalogRefreshTimer = null;
    }
    event.preventDefault();
    automaticUpdateController.dispose();
    // A failed stop still quits. The wide-events work (#308) emits the quit's
    // outcome here.
    stopInternalAppApiWithinTimeout()
      .catch(() => "failed")
      .then((outcome) => {
        gracefulQuitStarted = true;
        if (outcome === "timed-out") {
          // Skips the window and quit events, which could wait again. Plugin
          // workers are threads, so they end with the process.
          app.exit(0);
          return;
        }
        app.quit();
      });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
