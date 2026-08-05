const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timetrackerDesktop", {
  bootstrapLocalState: ipcRenderer.sendSync("timetracker:get-bootstrap-local-state"),
  runtime: ipcRenderer.sendSync("timetracker:get-runtime-info"),
  setWindowChromeTheme: (theme) =>
    ipcRenderer.send("timetracker:set-window-chrome-theme", theme),
  installConnectorPlugin: () =>
    ipcRenderer.invoke("timetracker:install-connector-plugin"),
  uninstallConnectorPlugin: (pluginId) =>
    ipcRenderer.invoke("timetracker:uninstall-connector-plugin", pluginId),
  getDevelopmentPluginSettings: () =>
    ipcRenderer.invoke("timetracker:get-development-plugin-settings"),
  selectDevelopmentPluginDirectory: () =>
    ipcRenderer.invoke("timetracker:select-development-plugin-directory"),
  clearDevelopmentPluginDirectories: () =>
    ipcRenderer.invoke("timetracker:clear-development-plugin-directories"),
});
