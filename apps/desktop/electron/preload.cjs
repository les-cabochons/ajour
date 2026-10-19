const { contextBridge, ipcRenderer } = require("electron");

// The edit menu's Copy on selected text. The page copies the focused entries on
// any copy event, so this one copy skips the page's listeners and stays the
// browser's own copy, with formatting and links. The pass is in place before
// the copy is asked for, and goes after that copy or a second.
ipcRenderer.on("ajour:copy-selection", () => {
  const passToBrowser = (event) => event.stopImmediatePropagation();
  window.addEventListener("copy", passToBrowser, { capture: true, once: true });
  setTimeout(
    () => window.removeEventListener("copy", passToBrowser, { capture: true }),
    1000,
  );
  ipcRenderer.send("ajour:run-edit-command", "copy");
});

contextBridge.exposeInMainWorld("ajourDesktop", {
  bootstrapLocalState: ipcRenderer.sendSync("ajour:get-bootstrap-local-state"),
  runtime: ipcRenderer.sendSync("ajour:get-runtime-info"),
  appMenu: ipcRenderer.sendSync("ajour:get-app-menu"),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("ajour:menu-action", listener);
    return () => ipcRenderer.removeListener("ajour:menu-action", listener);
  },
  runMenuItem: (itemId) => ipcRenderer.send("ajour:run-menu-item", itemId),
  showContextMenu: (items, position) =>
    ipcRenderer.invoke("ajour:show-context-menu", items, position),
  runEditCommand: (command) =>
    ipcRenderer.send("ajour:run-edit-command", command),
  setThemeSource: (mode) => ipcRenderer.send("ajour:set-theme-source", mode),
  setWindowChromeTheme: (theme) =>
    ipcRenderer.send("ajour:set-window-chrome-theme", theme),
  checkForUpdates: (track) =>
    ipcRenderer.invoke("ajour:check-for-updates", track),
  getUpdateState: () => ipcRenderer.invoke("ajour:get-update-state"),
  onUpdateStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("ajour:update-state-changed", listener);
    return () =>
      ipcRenderer.removeListener("ajour:update-state-changed", listener);
  },
  updateAndRestart: (track, version) =>
    ipcRenderer.invoke("ajour:update-and-restart", track, version),
  configureAutomaticUpdates: (track) =>
    ipcRenderer.invoke("ajour:configure-automatic-updates", track),
  openUpdateRelease: (releaseUrl) =>
    ipcRenderer.invoke("ajour:open-update-release", releaseUrl),
  installPlugin: () => ipcRenderer.invoke("ajour:install-plugin"),
  getPluginCatalog: () => ipcRenderer.invoke("ajour:get-plugin-catalog"),
  getPluginCatalogSettings: () =>
    ipcRenderer.invoke("ajour:get-plugin-catalog-settings"),
  configurePluginCatalog: (settings) =>
    ipcRenderer.invoke("ajour:configure-plugin-catalog", settings),
  onPluginCatalogUpdated: (callback) => {
    const listener = (_event, catalog) => callback(catalog);
    ipcRenderer.on("ajour:plugin-catalog-updated", listener);
    return () =>
      ipcRenderer.removeListener("ajour:plugin-catalog-updated", listener);
  },
  downloadCatalogPlugin: (pluginId) =>
    ipcRenderer.invoke("ajour:download-catalog-plugin", pluginId),
  uninstallPlugin: (pluginId) =>
    ipcRenderer.invoke("ajour:uninstall-plugin", pluginId),
  getDevelopmentPluginSettings: () =>
    ipcRenderer.invoke("ajour:get-development-plugin-settings"),
  selectDevelopmentPluginDirectory: () =>
    ipcRenderer.invoke("ajour:select-development-plugin-directory"),
  clearDevelopmentPluginDirectories: () =>
    ipcRenderer.invoke("ajour:clear-development-plugin-directories"),
});
