const { contextBridge, ipcRenderer } = require("electron");

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
  setWindowChromeTheme: (theme) =>
    ipcRenderer.send("ajour:set-window-chrome-theme", theme),
  checkForUpdates: (track) =>
    ipcRenderer.invoke("ajour:check-for-updates", track),
  configureAutomaticUpdates: (track) =>
    ipcRenderer.invoke("ajour:configure-automatic-updates", track),
  openUpdateRelease: (releaseUrl) =>
    ipcRenderer.invoke("ajour:open-update-release", releaseUrl),
  installConnectorPlugin: () =>
    ipcRenderer.invoke("ajour:install-connector-plugin"),
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
  uninstallConnectorPlugin: (pluginId) =>
    ipcRenderer.invoke("ajour:uninstall-connector-plugin", pluginId),
  getDevelopmentPluginSettings: () =>
    ipcRenderer.invoke("ajour:get-development-plugin-settings"),
  selectDevelopmentPluginDirectory: () =>
    ipcRenderer.invoke("ajour:select-development-plugin-directory"),
  clearDevelopmentPluginDirectories: () =>
    ipcRenderer.invoke("ajour:clear-development-plugin-directories"),
});
