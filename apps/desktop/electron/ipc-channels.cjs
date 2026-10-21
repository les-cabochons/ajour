// @ts-check

/**
 * @typedef {import("../../../packages/wide-events/catalog.ts").AjourCatalog} AjourCatalog
 * @typedef {import("../../../packages/wide-events/catalog.ts").EventName<AjourCatalog>} EventName
 */

/**
 * The catalog's events an IPC channel may emit: those whose kinds include `ipc`.
 * @typedef {{ [Name in EventName]: "ipc" extends import("../../../packages/wide-events/catalog.ts").KindOf<AjourCatalog, Name> ? Name : never }[EventName]} IpcEventName
 */

/**
 * @typedef {object} IpcChannel
 * @property {IpcEventName} event The wide event each call emits.
 * @property {"invoke" | "message" | "sync"} mode `invoke` registers with `ipc.handle`, `message` with `ipc.onMessage`, `sync` with `ipc.answerSync`.
 */

/**
 * Every IPC channel of the main process, with the event its calls emit. The
 * wrapper in ipc-listeners.cjs refuses a channel that is missing here, and
 * `just typecheck` refuses an event name the catalog lacks or that is not an
 * IPC event (packages/wide-events/lib/ajour-catalog.ts).
 *
 * @satisfies {Record<string, IpcChannel>}
 */
const IPC_CHANNELS = {
  "ajour:get-bootstrap-local-state": {
    event: "local_state.recover",
    mode: "sync",
  },
  "ajour:get-runtime-info": { event: "app.runtime_info", mode: "sync" },
  "ajour:get-app-menu": { event: "app.menu_model", mode: "sync" },
  "ajour:run-menu-item": { event: "menu.run_item", mode: "message" },
  "ajour:show-context-menu": { event: "context_menu.show", mode: "invoke" },
  "ajour:run-edit-command": { event: "edit.run", mode: "message" },
  "ajour:set-theme-source": { event: "window.set_theme", mode: "message" },
  "ajour:set-window-chrome-theme": {
    event: "window.set_theme",
    mode: "message",
  },
  "ajour:check-for-updates": { event: "update.check", mode: "invoke" },
  "ajour:get-update-state": { event: "update.get_state", mode: "invoke" },
  "ajour:update-and-restart": { event: "update.install", mode: "invoke" },
  // Choosing a track checks it at once.
  "ajour:configure-automatic-updates": {
    event: "update.check",
    mode: "invoke",
  },
  "ajour:open-update-release": {
    event: "update.open_release",
    mode: "invoke",
  },
  "ajour:install-plugin": { event: "plugin.install", mode: "invoke" },
  "ajour:get-plugin-catalog": { event: "catalog.get", mode: "invoke" },
  "ajour:get-plugin-catalog-settings": {
    event: "catalog.get_settings",
    mode: "invoke",
  },
  "ajour:configure-plugin-catalog": {
    event: "catalog.configure",
    mode: "invoke",
  },
  "ajour:download-catalog-plugin": { event: "plugin.install", mode: "invoke" },
  "ajour:uninstall-plugin": { event: "plugin.uninstall", mode: "invoke" },
  "ajour:get-development-plugin-settings": {
    event: "dev_plugins.get_settings",
    mode: "invoke",
  },
  "ajour:select-development-plugin-directory": {
    event: "dev_plugins.configure",
    mode: "invoke",
  },
  "ajour:clear-development-plugin-directories": {
    event: "dev_plugins.configure",
    mode: "invoke",
  },
};

module.exports = {
  IPC_CHANNELS,
};
