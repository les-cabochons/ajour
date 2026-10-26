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

/**
 * The `{ traceparent }` the renderer passes as a call's last argument, so the
 * main process's IPC event joins the renderer's trace (ipc-listeners.cjs).
 * Anything else is dropped, never passed on.
 */
const traced = (carrier) =>
  carrier !== null &&
  typeof carrier === "object" &&
  typeof carrier.traceparent === "string"
    ? [{ traceparent: carrier.traceparent }]
    : [];

contextBridge.exposeInMainWorld("ajourDesktop", {
  bootstrapLocalState: ipcRenderer.sendSync("ajour:get-bootstrap-local-state"),
  runtime: ipcRenderer.sendSync("ajour:get-runtime-info"),
  appMenu: ipcRenderer.sendSync("ajour:get-app-menu"),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("ajour:menu-action", listener);
    return () => ipcRenderer.removeListener("ajour:menu-action", listener);
  },
  runMenuItem: (itemId, trace) =>
    ipcRenderer.send("ajour:run-menu-item", itemId, ...traced(trace)),
  showContextMenu: (items, position, trace) =>
    ipcRenderer.invoke(
      "ajour:show-context-menu",
      items,
      position,
      ...traced(trace),
    ),
  runEditCommand: (command, trace) =>
    ipcRenderer.send("ajour:run-edit-command", command, ...traced(trace)),
  setThemeSource: (mode, trace) =>
    ipcRenderer.send("ajour:set-theme-source", mode, ...traced(trace)),
  setWindowChromeTheme: (theme, trace) =>
    ipcRenderer.send("ajour:set-window-chrome-theme", theme, ...traced(trace)),
  checkForUpdates: (track, trace) =>
    ipcRenderer.invoke("ajour:check-for-updates", track, ...traced(trace)),
  getUpdateState: (trace) =>
    ipcRenderer.invoke("ajour:get-update-state", ...traced(trace)),
  onUpdateStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("ajour:update-state-changed", listener);
    return () =>
      ipcRenderer.removeListener("ajour:update-state-changed", listener);
  },
  updateAndRestart: (track, version, trace) =>
    ipcRenderer.invoke(
      "ajour:update-and-restart",
      track,
      version,
      ...traced(trace),
    ),
  configureAutomaticUpdates: (track, trace) =>
    ipcRenderer.invoke(
      "ajour:configure-automatic-updates",
      track,
      ...traced(trace),
    ),
  openUpdateRelease: (releaseUrl, trace) =>
    ipcRenderer.invoke(
      "ajour:open-update-release",
      releaseUrl,
      ...traced(trace),
    ),
  installPlugin: (trace) =>
    ipcRenderer.invoke("ajour:install-plugin", ...traced(trace)),
  getPluginCatalog: (trace) =>
    ipcRenderer.invoke("ajour:get-plugin-catalog", ...traced(trace)),
  getPluginCatalogSettings: (trace) =>
    ipcRenderer.invoke("ajour:get-plugin-catalog-settings", ...traced(trace)),
  configurePluginCatalog: (settings, trace) =>
    ipcRenderer.invoke(
      "ajour:configure-plugin-catalog",
      settings,
      ...traced(trace),
    ),
  onPluginCatalogUpdated: (callback) => {
    const listener = (_event, catalog) => callback(catalog);
    ipcRenderer.on("ajour:plugin-catalog-updated", listener);
    return () =>
      ipcRenderer.removeListener("ajour:plugin-catalog-updated", listener);
  },
  downloadCatalogPlugin: (pluginId, trace) =>
    ipcRenderer.invoke(
      "ajour:download-catalog-plugin",
      pluginId,
      ...traced(trace),
    ),
  uninstallPlugin: (pluginId, trace) =>
    ipcRenderer.invoke("ajour:uninstall-plugin", pluginId, ...traced(trace)),
  getDevelopmentPluginSettings: (trace) =>
    ipcRenderer.invoke(
      "ajour:get-development-plugin-settings",
      ...traced(trace),
    ),
  selectDevelopmentPluginDirectory: (trace) =>
    ipcRenderer.invoke(
      "ajour:select-development-plugin-directory",
      ...traced(trace),
    ),
  clearDevelopmentPluginDirectories: (trace) =>
    ipcRenderer.invoke(
      "ajour:clear-development-plugin-directories",
      ...traced(trace),
    ),
  getLogsStatus: (trace) =>
    ipcRenderer.invoke("ajour:get-logs-status", ...traced(trace)),
  configureLogs: (settings, trace) =>
    ipcRenderer.invoke("ajour:configure-logs", settings, ...traced(trace)),
  deleteAllLogs: (trace) =>
    ipcRenderer.invoke("ajour:delete-all-logs", ...traced(trace)),
});
