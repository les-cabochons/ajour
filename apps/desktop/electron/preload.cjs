const { contextBridge, ipcRenderer } = require("electron");

// A blank child has no entrypoint or privileged bridge. Its DOM is rendered
// by the owner's React tree, which remains the only local-state writer.
const isTrayPanel =
  typeof location !== "undefined" && location.href === "about:blank";

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

/**
 * `ipcRenderer.invoke`, rejecting with the main process's own message.
 * Electron rejects with "Error invoking remote method '<channel>': Error:
 * <message>", and the page shows an error's message as it is. Main always
 * throws an `Error` (ipc-listeners.cjs), so the type name is Electron's.
 */
const invoke = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).catch((error) => {
    throw new Error(
      String(error?.message ?? error).replace(
        /^Error invoking remote method '[^']*': (?:\w*Error: )?/,
        "",
      ),
    );
  });

const bootstrapLocalState = isTrayPanel
  ? null
  : ipcRenderer.sendSync("ajour:get-bootstrap-local-state");
const runtime = isTrayPanel
  ? null
  : ipcRenderer.sendSync("ajour:get-runtime-info");

// Whether the page forwards its wide events to the local log file: whether
// main is writing it, from the runtime info and then each change main
// pushes (#440). Kept here, so a page that subscribes late still gets the last one.
let forwardingWideEvents = runtime?.wideEventsForwarding === true;
const forwardingListeners = new Set();
ipcRenderer.on("ajour:wide-events-forwarding", (_event, forwarding) => {
  forwardingWideEvents = forwarding === true;
  for (const listener of forwardingListeners) {
    try {
      listener(forwardingWideEvents);
    } catch {
      // One listener's failure never stops the others.
    }
  }
});

const desktopApi = {
  bootstrapLocalState,
  runtime,
  appMenu: isTrayPanel ? null : ipcRenderer.sendSync("ajour:get-app-menu"),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("ajour:menu-action", listener);
    return () => ipcRenderer.removeListener("ajour:menu-action", listener);
  },
  runMenuItem: (itemId, trace) =>
    ipcRenderer.send("ajour:run-menu-item", itemId, ...traced(trace)),
  showContextMenu: (items, position, trace) =>
    invoke("ajour:show-context-menu", items, position, ...traced(trace)),
  runEditCommand: (command, trace) =>
    ipcRenderer.send("ajour:run-edit-command", command, ...traced(trace)),
  setThemeSource: (mode, trace) =>
    ipcRenderer.send("ajour:set-theme-source", mode, ...traced(trace)),
  setWindowChromeTheme: (theme, trace) =>
    ipcRenderer.send("ajour:set-window-chrome-theme", theme, ...traced(trace)),
  getWindowSettings: (trace) =>
    invoke("ajour:get-window-settings", ...traced(trace)),
  configureWindowSettings: (settings, trace) =>
    invoke("ajour:configure-window-settings", settings, ...traced(trace)),
  setTrayState: (state, trace) =>
    ipcRenderer.send("ajour:set-tray-state", state, ...traced(trace)),
  trayPanelCommand: (command, trace) =>
    ipcRenderer.send("ajour:tray-panel-command", command, ...traced(trace)),
  onTrayPanel: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("ajour:tray-panel", listener);
    return () => ipcRenderer.removeListener("ajour:tray-panel", listener);
  },
  onTrayAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("ajour:tray-action", listener);
    return () => ipcRenderer.removeListener("ajour:tray-action", listener);
  },
  getCliCommand: (trace) => invoke("ajour:get-cli-command", ...traced(trace)),
  installCliCommand: (trace) =>
    invoke("ajour:install-cli-command", ...traced(trace)),
  addCliCommandWsl: (options, trace) =>
    invoke("ajour:add-cli-command-wsl", options, ...traced(trace)),
  removeCliCommandWsl: (options, trace) =>
    invoke("ajour:remove-cli-command-wsl", options, ...traced(trace)),
  removeCliCommand: () => invoke("ajour:remove-cli-command"),
  onCliCommandChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("ajour:cli-command-changed", listener);
    return () =>
      ipcRenderer.removeListener("ajour:cli-command-changed", listener);
  },
  checkForUpdates: (track, trace) =>
    invoke("ajour:check-for-updates", track, ...traced(trace)),
  getUpdateState: (trace) => invoke("ajour:get-update-state", ...traced(trace)),
  onUpdateStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("ajour:update-state-changed", listener);
    return () =>
      ipcRenderer.removeListener("ajour:update-state-changed", listener);
  },
  updateAndRestart: (track, version, trace) =>
    invoke("ajour:update-and-restart", track, version, ...traced(trace)),
  configureAutomaticUpdates: (track, trace) =>
    invoke("ajour:configure-automatic-updates", track, ...traced(trace)),
  openUpdateRelease: (releaseUrl, trace) =>
    invoke("ajour:open-update-release", releaseUrl, ...traced(trace)),
  installPlugin: (trace) => invoke("ajour:install-plugin", ...traced(trace)),
  getPluginCatalog: (trace) =>
    invoke("ajour:get-plugin-catalog", ...traced(trace)),
  getPluginCatalogSettings: (trace) =>
    invoke("ajour:get-plugin-catalog-settings", ...traced(trace)),
  configurePluginCatalog: (settings, trace) =>
    invoke("ajour:configure-plugin-catalog", settings, ...traced(trace)),
  onPluginCatalogUpdated: (callback) => {
    const listener = (_event, catalog) => callback(catalog);
    ipcRenderer.on("ajour:plugin-catalog-updated", listener);
    return () =>
      ipcRenderer.removeListener("ajour:plugin-catalog-updated", listener);
  },
  downloadCatalogPlugin: (pluginId, sourceUrl, trace) =>
    invoke(
      "ajour:download-catalog-plugin",
      pluginId,
      sourceUrl,
      ...traced(trace),
    ),
  inspectPluginSource: (url, trace) =>
    invoke("ajour:inspect-plugin-source", url, ...traced(trace)),
  addPluginSource: (url, keyFingerprint, trace) =>
    invoke("ajour:add-plugin-source", url, keyFingerprint, ...traced(trace)),
  removePluginSource: (url, trace) =>
    invoke("ajour:remove-plugin-source", url, ...traced(trace)),
  uninstallPlugin: (pluginId, trace) =>
    invoke("ajour:uninstall-plugin", pluginId, ...traced(trace)),
  getDevelopmentPluginSettings: (trace) =>
    invoke("ajour:get-development-plugin-settings", ...traced(trace)),
  selectDevelopmentPluginDirectory: (trace) =>
    invoke("ajour:select-development-plugin-directory", ...traced(trace)),
  clearDevelopmentPluginDirectories: (trace) =>
    invoke("ajour:clear-development-plugin-directories", ...traced(trace)),
  getLogsStatus: (trace) => invoke("ajour:get-logs-status", ...traced(trace)),
  configureLogs: (settings, trace) =>
    invoke("ajour:configure-logs", settings, ...traced(trace)),
  deleteAllLogs: (trace) => invoke("ajour:delete-all-logs", ...traced(trace)),
  forwardWideEvents: (batch) =>
    ipcRenderer.send("ajour:forward-wide-events", batch),
  onWideEventsForwarding: (callback) => {
    forwardingListeners.add(callback);
    callback(forwardingWideEvents);
    return () => {
      forwardingListeners.delete(callback);
    };
  },
};
if (!isTrayPanel) contextBridge.exposeInMainWorld("ajourDesktop", desktopApi);
