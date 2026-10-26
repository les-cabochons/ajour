const { randomUUID } = require("node:crypto");
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
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  safeStorage,
  session,
  shell,
  WebContentsView,
} = require("electron");
// On its own line so the IPC check in code-standards.md can tell this import
// from any other use of the object: only `createIpcListeners` may take it.
const { ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const {
  buildAppMenuTemplate,
  findAppMenuRoleItem,
  getAppMenuModel,
} = require("./app-menu.cjs");
const { createAutomaticUpdateController } = require("./automatic-update.cjs");
const {
  MAC_ICON_SYMBOLS,
  objectActionIdOf,
  buildContextMenuTemplate,
  buildEditContextMenuTemplate,
  getPopupPosition,
  normalizeContextMenuItems,
} = require("./context-menu.cjs");
const {
  pluginInstallResultOf,
  selectPluginArchive,
} = require("./plugin-install.cjs");
const { createSafeStorageCipher } = require("./secret-cipher.cjs");
const { createBrokerNetwork } = require("./broker-transport.cjs");
const { PLUGIN_SCHEME } = require("./plugin-renderer-policy.cjs");
const {
  createPluginRendererRuntime,
} = require("./plugin-renderer-runtime.cjs");
const { launchSandboxRefusal } = require("./plugin-sandbox.cjs");
const {
  PROCESS_RECORD_FILE,
  createProcessRecord,
  sweepOrphanedRenderers,
} = require("./plugin-renderer-sweep.cjs");
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
const { createIpcListeners, refusedSender } = require("./ipc-listeners.cjs");
const {
  loadDesktopBootstrapLocalState,
} = require("./local-state-bootstrap.cjs");
const {
  apiLaunchOf,
  apiStopOf,
  createLaunchContext,
  createMainEvents,
  loadMainEmitter,
  readLaunchVersion,
  triggerOf,
  writeLaunchVersion,
} = require("./main-events.cjs");
const { classifyNavigation } = require("./navigation.cjs");
const { stopWithin } = require("./stop-within.cjs");
const {
  getPlatformWindowChromeOptions,
  getWindowsTitleBarOverlay,
} = require("./window-chrome.cjs");
const { watchWindow } = require("./window-recovery.cjs");
const {
  addWindowApiToken,
  createWindowApiToken,
} = require("./window-api-token.cjs");
const {
  createUpdateCheckCoordinator,
  isAllowedReleaseUrl,
} = require("./update-check.cjs");

// On macOS, safeStorage keeps its key in a keychain item named after the
// app, so a development build takes a name of its own and never touches the
// release build's key. A release build never changes its name: that would
// lose the key, and every saved secret with it. The data folder is pinned
// below, so the name doesn't move it.
if (!app.isPackaged) app.setName("Ajour Dev");

// A development build keeps its data in a folder of its own, so it never
// opens the release build's vault with another key. AJOUR_USER_DATA_PATH
// still points either build anywhere.
const DESKTOP_USER_DATA_DIRNAME = app.isPackaged ? "Ajour" : "Ajour Dev";
const stableUserDataPath =
  process.env.AJOUR_USER_DATA_PATH ??
  path.join(app.getPath("appData"), DESKTOP_USER_DATA_DIRNAME);
if (app.getPath("userData") !== stableUserDataPath) {
  app.setPath("userData", stableUserDataPath);
}

// The main process's wide events (docs/logging-strategy.md). Units can start
// at once: the package loads below, the way the local API does, and takes
// over what was recorded meanwhile.
const events = createMainEvents();
const launch = createLaunchContext({
  version: app.getVersion(),
  packaged: app.isPackaged,
  // The packaged build's commit, which electron-builder injects.
  commit: /** @type {{ buildCommit?: string }} */ (require("../package.json"))
    .buildCommit,
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  randomUUID,
});
// Why the app quits, for app.quit: what set it off, or "other".
let quitTrigger = "other";

process.on("uncaughtExceptionMonitor", (error, origin) => {
  if (origin === "uncaughtException") {
    recordAppError(error, "uncaught_exception");
  }
});
// Node has no observe-only event for rejections, and a listener silences
// its warning. Events go nowhere by default, so the warning is kept.
process.on("unhandledRejection", (reason) => {
  recordAppError(reason, "unhandled_rejection");
  process.emitWarning(
    `Unhandled promise rejection: ${describeRejection(reason)}`,
    "UnhandledPromiseRejectionWarning",
  );
});

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
  {
    // Each plugin's origin, `ajour-plugin://<id>` (plugin-renderer-runtime.cjs).
    // Standard and secure only: no service workers, no CSP bypass, no fetch
    // of it from anywhere else, no code cache.
    scheme: PLUGIN_SCHEME,
    privileges: { standard: true, secure: true },
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
// The local API answers only requests that carry this launch's token, which
// main adds to the window's. It's kept in memory and never written anywhere.
const windowApiToken = createWindowApiToken();
const internalAppApiRuntimeRoot = app.isPackaged
  ? path.join(process.resourcesPath, "internal-app-runtime")
  : path.resolve(__dirname, "../../..");
const internalAppApiEntryPath = app.isPackaged
  ? path.join(internalAppApiRuntimeRoot, "apps/api/src/server.ts")
  : path.resolve(__dirname, "../../api/src/server.ts");

void loadMainEmitter({
  packageRoot: path.join(internalAppApiRuntimeRoot, "packages/wide-events"),
  launch,
  homeDirectory: app.getPath("home"),
  userDataPath: app.getPath("userData"),
  sinkSwitch: process.env.AJOUR_WIDE_EVENTS,
}).then(
  (createEmitter) => events.attach(createEmitter),
  () => events.abandon(),
);

let internalAppApiServer = null;
let internalAppApiStartPromise = null;
let internalAppApiStopPromise = null;
let internalAppApiModulePromise = null;
let desktopBootstrapLocalState;
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
  checkForUpdates: (track, report) =>
    checkForUpdatesCoordinated({
      track,
      currentVersion: app.getVersion(),
      fetchImpl: net.fetch,
      report,
    }),
  onStateChanged: (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("ajour:update-state-changed", state);
    }
  },
  dialog,
  getMainWindow: () => mainWindow,
  prepareToInstall: prepareToInstallUpdate,
  resetInstallPreparation: cancelUpdateInstallPreparation,
  events,
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

/**
 * Refreshes the plugin catalog, once at a time. It never rejects, so its
 * `catalog.refresh` event takes its outcome from the refresh itself.
 */
function refreshPluginCatalog(trigger) {
  pluginCatalogRefreshPromise ??= events
    .run(
      "catalog.refresh",
      { kind: "job", trigger: triggerOf(trigger), detached: true },
      (unit) => {
        unit.set({ catalog: { trigger } });
        return pluginCatalogService.refresh({ unit });
      },
    )
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
      void refreshPluginCatalog("interval");
    },
    pluginCatalogSettings.refreshMinutes * 60 * 1000,
  );
  pluginCatalogRefreshTimer.unref?.();
}

// Every IPC channel registers through `ipc`, which emits each call's event,
// named in ipc-channels.cjs. None can throw into the main process, and a
// failed synchronous request answers null.
const ipc = createIpcListeners(ipcMain, {
  events,
  windowSession: () => session.defaultSession,
});

// Read once per launch. A read that finds nothing or fails stays null until
// the next launch, even when a crashed window reloads and asks again.
ipc.answerSync("ajour:get-bootstrap-local-state", () => {
  const unit = events.current();
  if (desktopBootstrapLocalState !== undefined) {
    unit?.set({ local_state: { cached: true } });
    return desktopBootstrapLocalState;
  }
  desktopBootstrapLocalState = null;
  const report = {};
  desktopBootstrapLocalState = loadDesktopBootstrapLocalState({
    appDataPath: app.getPath("appData"),
    currentUserDataPath: app.getPath("userData"),
    report,
  });
  unit?.set({
    local_state: {
      cached: false,
      source: report.source,
      legacy_folder_count: report.legacy_folder_count,
      bytes_scanned: report.bytes_scanned,
      record_counts: report.record_counts,
    },
  });
  if (report.error) unit?.fail(report.error);
  return desktopBootstrapLocalState;
});

ipc.answerSync("ajour:get-runtime-info", () => ({
  automaticUpdatesEnabled,
  developmentBuild: !app.isPackaged,
  platform: process.platform,
  version: app.getVersion(),
  launch,
}));

ipc.answerSync("ajour:get-app-menu", () => appMenuModel);

// The Windows title bar menus run role items (Copy, Zoom in, Exit) through the
// hidden native menu, so they behave like the macOS menu bar.
ipc.onMessage("ajour:run-menu-item", (event, itemId) => {
  assertActiveDesktopWindow(event, "run a menu item");
  const roleItem = findAppMenuRoleItem(appMenuModel, itemId);
  if (!roleItem) {
    return;
  }
  events.current()?.set({ menu: { item_id: itemId } });

  Menu.getApplicationMenu()
    ?.getMenuItemById(itemId)
    ?.click(undefined, mainWindow, mainWindow.webContents);
});

// Object right-click menus. Resolves with the picked item's id, or null when
// the menu closes without a pick.
ipc.handle("ajour:show-context-menu", (event, items, position) => {
  assertActiveDesktopWindow(event, "show a context menu");
  const unit = events.current();
  const menuItems = normalizeContextMenuItems(items);
  unit?.set({
    context_menu: {
      item_count: Array.isArray(items) ? items.length : 0,
      kept_count: menuItems.length,
      picked: false,
    },
  });
  if (menuItems.length === 0) {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (id) => {
      if (!settled) {
        settled = true;
        if (id !== null) {
          unit?.set({
            context_menu: { picked: true, action_id: objectActionIdOf(id) },
          });
        }
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
  if (command === "cut" || command === "copy") {
    events.current()?.set({ edit: { command } });
  }
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
    events.current()?.set({ theme: { value: mode } });
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

  events.current()?.set({ theme: { value: theme } });
  mainWindow.setTitleBarOverlay(getWindowsTitleBarOverlay(theme));
});

ipc.handle("ajour:check-for-updates", async (event, track) => {
  assertActiveDesktopWindow(event, "check for application updates");
  return await automaticUpdateController.checkNow(track, {
    unit: events.current(),
  });
});

ipc.handle("ajour:get-update-state", (event) => {
  assertActiveDesktopWindow(event, "read application update state");
  return automaticUpdateController.getState();
});

ipc.handle("ajour:update-and-restart", async (event, track, version) => {
  assertActiveDesktopWindow(event, "update and restart the application");
  return await automaticUpdateController.updateAndRestart(track, version, {
    unit: events.current(),
  });
});

ipc.handle("ajour:configure-automatic-updates", async (event, track) => {
  assertActiveDesktopWindow(event, "configure automatic application updates");
  await automaticUpdateController.configure(track, { unit: events.current() });
});

ipc.handle("ajour:open-update-release", async (event, releaseUrl) => {
  assertActiveDesktopWindow(event, "open an application update release");
  const unit = events.current();
  const allowed = isAllowedReleaseUrl(releaseUrl);
  unit?.set({ update: { release_allowed: allowed } });
  if (!allowed) {
    unit?.refuse("url_not_allowed");
    throw new Error("The update release URL is not allowed.");
  }
  await shell.openExternal(releaseUrl);
});

/** A plugin ID fit for an event: the catalog's pattern, or nothing. */
function pluginIdForEvent(pluginId) {
  return typeof pluginId === "string" &&
    /^[a-z0-9][a-z0-9_-]{1,63}$/u.test(pluginId)
    ? pluginId
    : undefined;
}

/**
 * Installs a plugin archive through the local API, and adds what the install
 * did to `unit`, the call's `plugin.install` event.
 */
async function installPluginArchive(unit, archive, ...options) {
  unit?.set({ plugin: { archive_bytes: archive.archiveBytes.byteLength } });
  try {
    await ensureInternalAppApiRunning();
  } catch (error) {
    unit?.set({ plugin: { result: "api_unavailable" } });
    throw error;
  }
  if (!internalAppApiServer || !internalAppApiModulePromise) {
    unit?.set({ plugin: { result: "api_unavailable" } });
    throw new Error("Internal app API unavailable. Restart the app.");
  }

  const { installPluginForServer } = await internalAppApiModulePromise;
  if (typeof installPluginForServer !== "function") {
    unit?.set({ plugin: { result: "api_unavailable" } });
    throw new Error("Internal app API does not support plugin installation.");
  }

  const installStartedAt = Date.now();
  let result;
  try {
    result = await installPluginForServer(
      internalAppApiServer,
      archive.archiveBytes,
      archive.archiveFilename,
      ...options,
    );
  } catch (error) {
    unit?.set({
      plugin: {
        install_ms: Date.now() - installStartedAt,
        result: pluginInstallResultOf(error),
      },
    });
    throw error;
  }
  unit?.set({
    plugin: {
      id: pluginIdForEvent(result?.plugin?.id),
      version: result?.plugin?.version,
      replaced: result?.replaced,
      install_ms: Date.now() - installStartedAt,
      result: result?.replaced ? "updated" : "installed",
    },
  });
  return result;
}

ipc.handle("ajour:install-plugin", async (event) => {
  const unit = events.current();
  unit?.set({ plugin: { source: "archive" } });
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw refusedSender(
      "Plugins can only be installed by the active Ajour window.",
    );
  }
  if (!app.isPackaged) {
    unit?.refuse("development_build");
    throw new Error(
      "Packaged plugin installation is only available in production builds.",
    );
  }

  const dialogStartedAt = Date.now();
  let selectedArchive;
  try {
    selectedArchive = await selectPluginArchive(dialog, mainWindow);
  } catch (error) {
    unit?.set({ plugin: { result: pluginInstallResultOf(error) } });
    throw error;
  } finally {
    unit?.set({ plugin: { dialog_ms: Date.now() - dialogStartedAt } });
  }
  if (!selectedArchive) {
    unit?.set({ plugin: { result: "cancelled" } }).cancel();
    return null;
  }

  return await installPluginArchive(unit, selectedArchive);
});

ipc.handle("ajour:get-plugin-catalog", async (event) => {
  assertActiveDesktopWindow(event, "read the plugin catalog");
  return (
    pluginCatalogService.getCurrentCatalog() ??
    (await refreshPluginCatalog("request"))
  );
});

ipc.handle("ajour:get-plugin-catalog-settings", async (event) => {
  assertActiveDesktopWindow(event, "read plugin catalog settings");
  return pluginCatalogSettings;
});

ipc.handle("ajour:configure-plugin-catalog", async (event, settings) => {
  assertActiveDesktopWindow(event, "configure the plugin catalog");
  const before = pluginCatalogSettings.refreshMinutes;
  pluginCatalogSettings = savePluginCatalogSettings(
    pluginCatalogSettingsPath,
    settings,
  );
  events.current()?.set({
    catalog: {
      refresh_minutes_before: before,
      refresh_minutes_after: pluginCatalogSettings.refreshMinutes,
    },
  });
  schedulePluginCatalogRefresh();
  return pluginCatalogSettings;
});

ipc.handle("ajour:download-catalog-plugin", async (event, pluginId) => {
  assertActiveDesktopWindow(event, "download a plugin");
  const unit = events.current();
  unit?.set({ plugin: { source: "catalog", id: pluginIdForEvent(pluginId) } });
  if (!app.isPackaged) {
    unit?.refuse("development_build");
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

  const downloadStartedAt = Date.now();
  let downloaded;
  try {
    downloaded = await pluginCatalogService.downloadPluginArchive(pluginId);
  } catch (error) {
    unit?.set({ plugin: { result: pluginInstallResultOf(error) } });
    throw error;
  } finally {
    unit?.set({ plugin: { download_ms: Date.now() - downloadStartedAt } });
  }
  const result = await installPluginArchive(unit, downloaded, {
    enableAfterInstall: false,
  });
  return { type: "plugin", result };
});

ipc.handle("ajour:uninstall-plugin", async (event, pluginId) => {
  const unit = events.current();
  unit?.set({ plugin: { id: pluginIdForEvent(pluginId) } });
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw refusedSender(
      "Plugins can only be uninstalled by the active Ajour window.",
    );
  }
  if (!app.isPackaged) {
    unit?.refuse("development_build");
    throw new Error(
      "Development directory plugins cannot be uninstalled by the app.",
    );
  }

  try {
    await ensureInternalAppApiRunning();
  } catch (error) {
    unit?.set({ plugin: { result: "api_unavailable" } });
    throw error;
  }
  if (!internalAppApiServer || !internalAppApiModulePromise) {
    unit?.set({ plugin: { result: "api_unavailable" } });
    throw new Error("Internal app API unavailable. Restart the app.");
  }

  const { uninstallPluginForServer } = await internalAppApiModulePromise;
  if (typeof uninstallPluginForServer !== "function") {
    unit?.set({ plugin: { result: "api_unavailable" } });
    throw new Error("Internal app API does not support plugin uninstall.");
  }

  try {
    const result = await uninstallPluginForServer(
      internalAppApiServer,
      pluginId,
    );
    unit?.set({ plugin: { result: "uninstalled" } });
    return result;
  } catch (error) {
    unit?.set({ plugin: { result: "failed" } });
    throw error;
  }
});

ipc.handle("ajour:get-development-plugin-settings", async (event) => {
  assertActiveDesktopWindow(event, "read development plugin settings");
  return getDevelopmentPluginSettings();
});

ipc.handle("ajour:select-development-plugin-directory", async (event) => {
  assertDevelopmentBuild(event, "configure development plugin directories");
  const unit = events.current();
  unit?.set({
    dev_plugins: {
      action: "select",
      directory_count_before: resolveDevelopmentPluginDirectories().length,
    },
  });
  const directory = await selectDevelopmentPluginDirectory(dialog, mainWindow);
  if (!directory) {
    unit?.set({ dev_plugins: { result: "cancelled" } }).cancel();
    return null;
  }

  await configureDevelopmentPluginDirectories(unit, [directory]);
  return getDevelopmentPluginSettings();
});

ipc.handle("ajour:clear-development-plugin-directories", async (event) => {
  assertDevelopmentBuild(event, "reset development plugin directories");
  const unit = events.current();
  unit?.set({
    dev_plugins: {
      action: "clear",
      directory_count_before: resolveDevelopmentPluginDirectories().length,
    },
  });
  await configureDevelopmentPluginDirectories(unit, null);
  return getDevelopmentPluginSettings();
});

/** Applies development plugin folders, and records the result on `unit`. */
async function configureDevelopmentPluginDirectories(unit, directories) {
  try {
    await applyDevelopmentPluginDirectories(directories);
    unit?.set({ dev_plugins: { result: "applied" } });
  } catch (error) {
    unit?.set({ dev_plugins: { result: "rolled_back" } });
    throw error;
  } finally {
    unit?.set({
      dev_plugins: {
        directory_count_after: resolveDevelopmentPluginDirectories().length,
      },
    });
  }
}

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

/** Refuses a call from any window but the active one. Its event says `refused`. */
function assertActiveDesktopWindow(event, action) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw refusedSender(`Only the active Ajour window can ${action}.`);
  }
}

function assertDevelopmentBuild(event, action) {
  assertActiveDesktopWindow(event, action);
  if (app.isPackaged) {
    events.current()?.refuse("packaged_build");
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

/**
 * The vault the local API keeps secrets in: a file beside the state file,
 * encrypted by safeStorage. Only the API, in this process, writes it.
 */
function internalAppApiVault(apiModule, statePath) {
  return new apiModule.FileSecretVault({
    filePath: path.join(path.dirname(statePath), "app-api-vault.json"),
    cipher: createSafeStorageCipher({
      safeStorage,
      platform: process.platform,
    }),
  });
}

/**
 * The broker's transport and resolver: `net.request` on a session of its
 * own, made once, after `ready`, since a session can't exist before.
 */
let brokerNetwork = null;
function internalAppApiBrokerNetwork() {
  brokerNetwork ??= createBrokerNetwork({ net, session, randomUUID });
  return brokerNetwork;
}

/**
 * The launch's sweep of plugin renderers a previous session left running,
 * started right after the single-instance lock. No plugin renderer opens
 * before it ends.
 */
/** @type {Promise<unknown>} */
let pluginRendererSweep = Promise.resolve();

/**
 * The runtime that runs plugin API 4 packages, each in a sandboxed renderer
 * of its own, made once, after `ready`. Development builds only, until the
 * cut-over (#403): release builds admit no API 4 package yet. Without a
 * sandbox, as with `--no-sandbox` or on Linux, it runs no plugin and says why.
 */
let pluginRendererRuntime = null;
function internalAppApiPluginApi4Runtime() {
  if (app.isPackaged) return undefined;
  pluginRendererRuntime ??= createPluginRendererRuntime({
    app,
    session,
    WebContentsView,
    ipcListeners: ipc,
    events,
    hostDirectory: path.join(__dirname, "plugin-host"),
    preloadPath: path.join(__dirname, "plugin-host", "preload.cjs"),
    platform: process.platform,
    devTools: !app.isPackaged,
    launchRefusal: launchSandboxRefusal({
      argv: process.argv,
      hasSwitch: (name) => app.commandLine.hasSwitch(name),
      env: process.env,
      platform: process.platform,
      inspectorActive: require("node:inspector").url() !== undefined,
    }),
    processRecord: createProcessRecord(
      path.join(app.getPath("userData"), PROCESS_RECORD_FILE),
    ),
    whenSwept: pluginRendererSweep,
  });
  return pluginRendererRuntime;
}

/** Closes every plugin renderer, so no plugin process outlives a quit. */
async function closePluginRenderers() {
  await pluginRendererRuntime?.closeAll();
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

  throw Object.assign(
    lastError ?? new Error("Internal app API failed to start"),
    {
      code: "health_timeout",
    },
  );
}

function internalAppApiPortInUseError(cause) {
  return Object.assign(
    new Error(
      `Ajour's plugin runtime cannot start because port ${INTERNAL_APP_API_PORT} is already in use. Close the other app or development server using this port, then try again.`,
      { cause },
    ),
    { code: "port_in_use" },
  );
}

/** Where a packaged launch keeps the version it ran, for the next app.launch. */
function launchVersionMarker() {
  return path.join(app.getPath("userData"), "last-launch.json");
}

/** Why the local API could not start, as app.launch records it. */
function apiStartFailureOf(error) {
  return ["port_in_use", "health_timeout", "entry_missing"].includes(
    error?.code,
  )
    ? error.code
    : "listen_error";
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
      throw Object.assign(
        new Error(`Internal app API entry missing: ${internalAppApiEntryPath}`),
        { code: "entry_missing" },
      );
    }

    internalAppApiModulePromise ??= import(
      pathToFileURL(internalAppApiEntryPath).toString()
    );
    const internalAppApiModule = await internalAppApiModulePromise;
    const { startAppApiServer } = internalAppApiModule;
    if (typeof startAppApiServer !== "function") {
      throw Object.assign(
        new Error(
          `Internal app API module is missing startAppApiServer: ${internalAppApiEntryPath}`,
        ),
        { code: "entry_missing" },
      );
    }

    const statePath =
      process.env.AJOUR_APP_API_STATE_PATH ??
      path.join(app.getPath("userData"), "app-api-state.json");
    const apiServer = await startAppApiServer({
      host: INTERNAL_APP_API_HOST,
      port: INTERNAL_APP_API_PORT,
      statePath,
      vault: internalAppApiVault(internalAppApiModule, statePath),
      brokerTransport: internalAppApiBrokerNetwork().transport,
      brokerResolver: internalAppApiBrokerNetwork().resolver,
      pluginApi4Runtime: internalAppApiPluginApi4Runtime(),
      installedPluginDirectory: path.join(app.getPath("userData"), "plugins"),
      developmentPluginDirectories: app.isPackaged
        ? []
        : resolveDevelopmentPluginDirectories(),
      bundledPluginArchives: [],
      allowDevelopmentPlugins: !app.isPackaged,
      allowedOrigins: app.isPackaged
        ? ["app://local"]
        : ["http://127.0.0.1:5173"],
      windowToken: windowApiToken,
      launch: apiLaunchOf(launch),
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
 * Stops the local API for a quit or an update, and never rejects. Resolves
 * "stopped", "failed", or "timed-out" when it is still stopping after the
 * timeout, so quitting never hangs on it.
 */
function stopInternalAppApiWithinTimeout() {
  return stopWithin(stopInternalAppApi(), INTERNAL_APP_API_STOP_TIMEOUT_MS);
}

/** The app menu's Quit, and the title bar's, which clicks the same item. */
function quitFromMenu() {
  quitTrigger = "menu";
  app.quit();
}

/**
 * Opens `app.quit` for a quit set off by `trigger`. It is its own unit, never
 * part of the IPC call or menu item that asked for it, which ends first.
 */
function startQuit(trigger) {
  return events
    .start("app.quit", {
      kind: "lifecycle",
      trigger: triggerOf(trigger),
      detached: true,
    })
    .set({ quit: { trigger } });
}

/** Set once a Windows session end recorded the quit before-quit never sees. */
let systemQuitRecorded = false;

/**
 * Windows ends the session without before-quit, so the quit the system began
 * is recorded when the session ends, once.
 */
function recordSessionEnd() {
  quitTrigger = "os";
  if (systemQuitRecorded || gracefulQuitStarted) return;
  systemQuitRecorded = true;
  startQuit("os").end();
}

/** Records how the local API's stop ended on a quit. */
function recordApiStop(quit, outcome, stopStartedAt) {
  if (!quit) return;
  quit.set({
    quit: {
      api_stop_ms: Date.now() - stopStartedAt,
      api_stop: apiStopOf(outcome),
    },
  });
}

/** Ends a quit with its local API stop's outcome. */
function endQuit(quit, outcome) {
  if (!quit) return;
  if (outcome === "failed") quit.end("error", "api_stop_failed");
  else if (outcome === "timed-out") quit.end("timeout", "api_stop_timed_out");
  else quit.end();
}

/**
 * Resolves once the wide-events package has loaded and taken the events
 * recorded before it, or after `withinMs`, so no exit path waits longer than
 * quitting allows.
 */
function whenEventsReady(withinMs) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, Math.max(0, withinMs));
  });
  return Promise.race([events.ready, deadline]).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * The quit an update install began, with its local API stop's outcome. It
 * ends when the installer quits Ajour, or as cancelled when the update does
 * not install.
 */
let updateQuit = null;

/**
 * Runs before an update installs, which quits Ajour. Like an ordinary quit, it
 * goes ahead whether the local API stopped, failed to stop or timed out.
 * Resolves the stop outcome, for the install's event.
 */
async function prepareToInstallUpdate() {
  const quit = startQuit("update_install");
  updateQuit = { quit, outcome: undefined };
  const stopStartedAt = Date.now();
  const outcome = await stopInternalAppApiWithinTimeout();
  recordApiStop(quit, outcome, stopStartedAt);
  if (updateQuit?.quit === quit) updateQuit.outcome = outcome;
  // The installer's quit skips before-quit, so the plugin pages close here.
  await closePluginRenderers().catch(() => undefined);
  // The installer's quit skips before-quit's wait for the events.
  await whenEventsReady(
    INTERNAL_APP_API_STOP_TIMEOUT_MS - (Date.now() - stopStartedAt),
  );
  gracefulQuitStarted = true;
  return outcome;
}

/** The update did not install, so the next quit stops the local API again. */
function cancelUpdateInstallPreparation() {
  gracefulQuitStarted = false;
  updateQuit?.quit.end("cancelled", "update_cancelled");
  updateQuit = null;
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

/** A URL's scheme, such as `https:`, or `other`: never the rest of it. */
function schemeOf(url) {
  try {
    const { protocol } = new URL(url);
    return /^[a-z][a-z0-9+.-]{0,31}:$/u.test(protocol) ? protocol : "other";
  } catch {
    return "other";
  }
}

/**
 * Follows a link or navigation from the window as `classifyNavigation`
 * decided, and emits `window.navigate` with its scheme only. Web and mail
 * links open in the system's browser or mail app; a link the system cannot
 * open is dropped.
 */
function followNavigation(url, destination, source) {
  const unit = events.start("window.navigate", {
    kind: "navigation",
    trigger: "user",
    detached: true,
  });
  unit.set({ navigation: { destination, scheme: schemeOf(url), source } });
  if (destination !== "external") {
    unit.end(destination === "blocked" ? "refused" : "ok");
    return;
  }
  shell.openExternal(url).then(
    () => unit.end(),
    (error) => {
      // The system's message can quote the link, so only its type stays.
      const failure = new Error("The system could not open the link.");
      if (typeof error?.name === "string") failure.name = error.name;
      unit.fail(failure).end();
    },
  );
}

/** A rejection's reason as Node's warning prints it. */
function describeRejection(reason) {
  try {
    return reason instanceof Error
      ? (reason.stack ?? reason.message)
      : String(reason);
  } catch {
    return "a value that cannot be printed";
  }
}

/**
 * Records an error nothing else caught as `app.error`, its own event even
 * while another unit is active.
 */
function recordAppError(error, origin, handledBy = "none") {
  events
    .start("app.error", { kind: "crash", trigger: "system", detached: true })
    .set({
      crash: {
        origin,
        handled_by: handledBy,
        active_unit: events.current()?.name,
      },
    })
    .fail(error)
    .end();
}

/**
 * Startup failed before the window could load, as when the window cannot be
 * created. Says why and quits, so no windowless process keeps the instance
 * lock. A local API that cannot start is not such a failure: Ajour opens
 * without plugins.
 */
function quitAfterStartupFailure(error) {
  recordAppError(error, "startup_failure", "dialog");
  dialog.showErrorBox(
    "Ajour could not start",
    typeof error?.message === "string" ? error.message : String(error),
  );
  quitTrigger = "startup_failure";
  app.quit();
}

/**
 * Opens the window and loads the app in it. `trigger` is `launch`, or
 * `activate` when macOS reopens it. Resolves how long the load took, and
 * its outcome: `ok`, `error` or `cancelled`.
 */
async function createMainWindow(trigger = "launch") {
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

  // Reloads a crashed page, and asks about a hung one or a failed load.
  const recovery = watchWindow(window, {
    url: rendererUrl,
    dialog,
    events,
    quit: () => {
      quitTrigger = "recovery_dialog";
      app.quit();
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    followNavigation(url, classifyNavigation(url, rendererUrl), "window_open");
    return { action: "deny" };
  });

  window.on("session-end", recordSessionEnd);

  window.webContents.on("context-menu", (_event, params) => {
    showEditContextMenu(window, params);
  });

  window.webContents.on("will-navigate", (event, navigationUrl) => {
    const destination = classifyNavigation(navigationUrl, rendererUrl);
    if (destination !== "app") {
      event.preventDefault();
    }
    followNavigation(navigationUrl, destination, "will_navigate");
  });

  const loadStartedAt = Date.now();
  const loadOutcome = await recovery.load(trigger);
  return { loadMs: Date.now() - loadStartedAt, loadOutcome };
}

if (!hasSingleInstanceLock) {
  // This process's one event. The quit waits for the package to load, so the
  // event leaves before the process exits.
  events
    .start("app.lock_refused", {
      kind: "lifecycle",
      trigger: "system",
      detached: true,
    })
    .end();
  void whenEventsReady(INTERNAL_APP_API_STOP_TIMEOUT_MS).then(() => app.quit());
} else {
  // Only this process holds the lock, so a plugin renderer a previous
  // session recorded and left running is an orphan: it ends now.
  pluginRendererSweep = sweepOrphanedRenderers({
    filePath: path.join(app.getPath("userData"), PROCESS_RECORD_FILE),
    platform: process.platform,
    execPath: process.execPath,
    events,
  });

  // From the process start until the window has loaded.
  const launchUnit = events.start("app.launch", {
    kind: "lifecycle",
    trigger: "boot",
    startedAt: Math.round(performance.timeOrigin),
  });
  launchUnit.set({
    launch: {
      renderer_source: process.env.AJOUR_DESKTOP_RENDERER_URL
        ? "dev_server"
        : "app_protocol",
      // Development runs share the user data folder, so only packaged
      // builds read and write the marker.
      ...(app.isPackaged
        ? { previous_version: readLaunchVersion(launchVersionMarker()) }
        : {}),
    },
    catalog: {
      settings_source: existsSync(pluginCatalogSettingsPath)
        ? "saved"
        : "default",
      refresh_minutes: pluginCatalogSettings.refreshMinutes,
    },
  });

  app.on("second-instance", () => {
    const unit = events.start("app.second_launch", {
      kind: "lifecycle",
      trigger: "system",
      detached: true,
    });
    const hadWindow = Boolean(mainWindow);
    let restored = false;
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
        restored = true;
      }
      mainWindow.focus();
    }
    unit
      .set({
        second_launch: { had_window: hadWindow, restored, focused: hadWindow },
      })
      .end();
  });

  // A renderer's crash is window-recovery.cjs's; these are the other processes.
  app.on("child-process-gone", (_event, details) => {
    events
      .start("process.gone", {
        kind: "crash",
        trigger: "system",
        detached: true,
      })
      .set({
        process: {
          type: String(details?.type ?? "unknown")
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, "_"),
          reason: details?.reason,
          exit_code: details?.exitCode,
        },
      })
      .end(details?.reason === "clean-exit" ? "ok" : "error");
  });

  app
    .whenReady()
    .then(async () => {
      launchUnit.set({
        launch: { ready_ms: Date.now() - Math.round(performance.timeOrigin) },
      });
      if (process.platform === "darwin") {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }

      if (!process.env.AJOUR_DESKTOP_RENDERER_URL) {
        registerStaticProtocol();
      }

      // Before the window opens, so its first request to the API has it.
      // The hook sits on the default session, so the window must stay that
      // session's only user: plugin renderers use their own partitions, and
      // moving the window to one would orphan the renderer's localStorage.
      // Electron allows one onBeforeSendHeaders listener per session, so no
      // other code may register one on it.
      addWindowApiToken(session.defaultSession, {
        apiOrigin: `http://${INTERNAL_APP_API_HOST}:${INTERNAL_APP_API_PORT}`,
        token: windowApiToken,
      });

      // Replaces Electron's default menu, which keeps Reload and DevTools in
      // packaged builds. Windows hides it under the title bar overlay. The
      // renderer can draw the same menus in the title bar, but that is turned
      // off for now.
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(
          buildAppMenuTemplate(appMenuModel, {
            platform: process.platform,
            sendAction: sendMenuAction,
            quit: quitFromMenu,
          }),
        ),
      );

      // macOS and Linux shut down through before-quit.
      powerMonitor.on("shutdown", () => {
        quitTrigger = "os";
      });

      void refreshPluginCatalog("launch");
      schedulePluginCatalogRefresh();

      // Ajour opens without plugins when the local API cannot start.
      const apiStartedAt = Date.now();
      try {
        await ensureInternalAppApiRunning();
        launchUnit.set({ api: { outcome: "started" } });
      } catch (error) {
        launchUnit.set({
          api: { outcome: "failed", failure_reason: apiStartFailureOf(error) },
        });
      }
      launchUnit.set({ launch: { api_start_ms: Date.now() - apiStartedAt } });

      const windowStartedAt = Date.now();
      const { loadMs, loadOutcome } = await createMainWindow("launch");
      launchUnit.set({
        launch: {
          window_ms: Date.now() - windowStartedAt,
          renderer_load_ms: loadMs,
        },
      });
      if (loadOutcome === "error") launchUnit.end("error", "load_failed");
      else if (loadOutcome === "cancelled") {
        launchUnit.end("cancelled", "load_cancelled");
      } else {
        launchUnit.end();
        if (app.isPackaged) {
          writeLaunchVersion(launchVersionMarker(), app.getVersion());
        }
      }

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow("activate").catch(quitAfterStartupFailure);
        }
      });
    })
    .catch((error) => {
      // app.error holds the error; the launch says only where it ended.
      launchUnit.end("error", "startup_failed");
      quitAfterStartupFailure(error);
    });

  app.on("before-quit", (event) => {
    if (gracefulQuitStarted) {
      // The installer quits Ajour after its own preparation stopped the API.
      if (updateQuit) endQuit(updateQuit.quit, updateQuit.outcome);
      updateQuit = null;
      return;
    }

    gracefulQuitStarted = true;
    const quitStartedAt = Date.now();
    const quit = systemQuitRecorded ? undefined : startQuit(quitTrigger);
    if (pluginCatalogRefreshTimer) {
      clearInterval(pluginCatalogRefreshTimer);
      pluginCatalogRefreshTimer = null;
    }
    event.preventDefault();
    const updaterStartedAt = Date.now();
    automaticUpdateController.dispose();
    quit?.set({ quit: { updater_ms: Date.now() - updaterStartedAt } });
    // A failed stop still quits.
    const stopStartedAt = Date.now();
    void stopInternalAppApiWithinTimeout().then(async (outcome) => {
      gracefulQuitStarted = true;
      recordApiStop(quit, outcome, stopStartedAt);
      // The API cancelled their runs as it stopped; their pages close now.
      await closePluginRenderers().catch(() => undefined);
      endQuit(quit, outcome);
      // Events recorded before the package loaded are lost if the process
      // exits first.
      await whenEventsReady(
        INTERNAL_APP_API_STOP_TIMEOUT_MS - (Date.now() - quitStartedAt),
      );
      if (outcome === "timed-out") {
        // Ends the process with the stop still running. Plugin workers are
        // threads, so they end with it. Nothing holds close, beforeunload or
        // will-quit, so app.quit would end it too, as it does when an update
        // installs after a timed-out stop.
        app.exit(0);
        return;
      }
      app.quit();
    });
  });

  // An update install's event waits for the app to quit for the installer.
  app.on("will-quit", () => {
    automaticUpdateController.installerQuitting();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      if (quitTrigger === "other") quitTrigger = "all_windows_closed";
      app.quit();
    }
  });
}
