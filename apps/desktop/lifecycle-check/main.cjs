// The real app for `scripts/check-keep-running.mjs` (#534): Ajour's own main
// process, with these changes for the check and nothing else.
//
// - The system's app data folder moves into the check's temp folder, so the
//   desktop bootstrap never reads a real Ajour profile.
// - Playwright's switches that keep a hidden page's timers running at full
//   speed are taken off, so the hidden window is slowed as it is for users.
// - The tray menus main builds are kept on `globalThis.ajourKeepRunningCheck`,
//   so the check clicks the same Open Ajour and Quit items the tray shows.
// - The quit's steps are printed as event lines, for the log of a failed run.
"use strict";

const { app, Menu } = require("electron");
const path = require("node:path");

if (!app.isPackaged && process.env.AJOUR_CLI_CHECK_VERSION)
  app.setVersion(process.env.AJOUR_CLI_CHECK_VERSION);

const userData = process.env.AJOUR_USER_DATA_PATH;
if (!userData) throw new Error("Set AJOUR_USER_DATA_PATH to a temp folder.");
app.setPath("appData", path.join(userData, "app-data"));

for (const name of [
  "disable-background-timer-throttling",
  "disable-backgrounding-occluded-windows",
  "disable-renderer-backgrounding",
]) {
  app.commandLine.removeSwitch(name);
}

const check = { trayMenus: [] };
globalThis.ajourKeepRunningCheck = check;
const buildFromTemplate = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (template) => {
  const menu = buildFromTemplate(template);
  if (template.some((item) => item.label === "Open Ajour")) {
    check.trayMenus.push(template);
  }
  return menu;
};

const step = (name) =>
  process.stdout.write(
    `${JSON.stringify({ name: `check.${name}`, timestamp: Date.now() })}\n`,
  );
for (const name of ["before-quit", "will-quit", "quit", "window-all-closed"]) {
  app.on(name, () => step(name));
}
app.on("browser-window-created", (_event, window) => {
  window.on("close", () => step("window.close"));
  window.on("closed", () => step("window.closed"));
});

require("../electron/main.cjs");
