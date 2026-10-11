/**
 * The application menu. See "Menu bar" under "Keyboard" in agents/ux-spec.md.
 *
 * `getAppMenuModel` describes the menus as plain data, so the preload can hand
 * the same menus to the renderer, which draws them in the Windows title bar.
 * `buildAppMenuTemplate` turns that model into an Electron menu template.
 * Both functions are pure; main.cjs sets the menu and sends the actions.
 *
 * Three kinds of items:
 * - action items carry an id from the renderer's shortcut registry
 *   (`apps/web/src/lib/shortcuts.ts`). Clicking one sends the id to the renderer.
 * - role items run an Electron role (undo, copy, zoom, quit and so on) in main.
 * - separators.
 *
 * The renderer's key listener is the only binding path for registry shortcuts.
 * Single keys never become native accelerators, so typing "d" in a field still
 * types "d". macOS shows them in the label, as "Day (D)"; Windows and Linux
 * show them as unregistered accelerators.
 */

/**
 * @typedef {{ type: "separator" }} AppMenuSeparator
 * @typedef {{ type: "action", id: string, label: string, action: string, accelerator?: string }} AppMenuActionItem
 * @typedef {{ type: "role", id: string, label: string, role: string, accelerator?: string }} AppMenuRoleItem
 * @typedef {AppMenuSeparator | AppMenuActionItem | AppMenuRoleItem} AppMenuItem
 * @typedef {{ id: string, label: string, role?: "window" | "help", items: AppMenuItem[] }} AppMenu
 */

const SEPARATOR = Object.freeze({ type: "separator" });

/** @returns {AppMenuActionItem} */
function actionItem(action, label, accelerator) {
  return {
    type: "action",
    id: `action:${action}`,
    label,
    action,
    ...(accelerator ? { accelerator } : {}),
  };
}

/** @returns {AppMenuRoleItem} */
function roleItem(role, label, accelerator) {
  return {
    type: "role",
    id: `role:${role}`,
    label,
    role,
    ...(accelerator ? { accelerator } : {}),
  };
}

/**
 * True for an accelerator with no modifier, such as "D", "[" or "?". These
 * are the single-key shortcuts that only work outside text fields.
 */
function isSingleKeyAccelerator(accelerator) {
  return typeof accelerator === "string" && !accelerator.includes("+");
}

/**
 * The menus for one platform and build type, as plain data.
 *
 * @param {{ platform: NodeJS.Platform, developmentBuild: boolean, appName: string }} options
 * @returns {AppMenu[]}
 */
function getAppMenuModel({ platform, developmentBuild, appName }) {
  const isMac = platform === "darwin";

  const appMenuItems = [
    roleItem("about", `About ${appName}`),
    SEPARATOR,
    actionItem("app.settings", "Settings…", "CmdOrCtrl+,"),
    actionItem("app.check-for-updates", "Check for updates…"),
    SEPARATOR,
    ...(isMac
      ? [
          roleItem("hide", `Hide ${appName}`, "Command+H"),
          roleItem("hideOthers", "Hide others", "Command+Alt+H"),
          roleItem("unhide", "Show all"),
          SEPARATOR,
          roleItem("quit", `Quit ${appName}`, "Command+Q"),
        ]
      : // Windows closes apps with Alt+F4, which the system handles.
        [roleItem("quit", "Exit")]),
  ];

  const editMenuItems = [
    roleItem("undo", "Undo", "CmdOrCtrl+Z"),
    roleItem("redo", "Redo", isMac ? "Shift+CmdOrCtrl+Z" : "Ctrl+Y"),
    SEPARATOR,
    roleItem("cut", "Cut", "CmdOrCtrl+X"),
    roleItem("copy", "Copy", "CmdOrCtrl+C"),
    roleItem("paste", "Paste", "CmdOrCtrl+V"),
    roleItem("selectAll", "Select all", "CmdOrCtrl+A"),
  ];

  const viewMenuItems = [
    actionItem("time.day-view", "Day", "D"),
    actionItem("time.week-view", "Week", "W"),
    SEPARATOR,
    actionItem("app.toggle-sidebar", "Show or hide sidebar", "CmdOrCtrl+B"),
    SEPARATOR,
    actionItem("time.today", "Today", "T"),
    actionItem("time.previous", "Previous", "["),
    actionItem("time.next", "Next", "]"),
    SEPARATOR,
    roleItem("resetZoom", "Actual size", "CmdOrCtrl+0"),
    roleItem("zoomIn", "Zoom in", "CmdOrCtrl+Plus"),
    roleItem("zoomOut", "Zoom out", "CmdOrCtrl+-"),
    // Packaged builds must not reload or open DevTools from the keyboard.
    ...(developmentBuild
      ? [
          SEPARATOR,
          roleItem("reload", "Reload", "CmdOrCtrl+R"),
          roleItem(
            "toggleDevTools",
            "Toggle developer tools",
            isMac ? "Alt+Command+I" : "Ctrl+Shift+I",
          ),
        ]
      : []),
  ];

  // The focused entry's actions. Continue applies to the focused entry, or the
  // most recent one when no entry has focus.
  const entryMenuItems = [
    actionItem("entry.new", "New entry", "N"),
    actionItem("entry.stop-or-start", "Start or stop", "S"),
    actionItem("entry.continue", "Continue", "C"),
  ];

  const windowMenuItems = isMac
    ? [
        roleItem("minimize", "Minimize", "Command+M"),
        roleItem("zoom", "Zoom"),
        SEPARATOR,
        roleItem("close", "Close window", "Command+W"),
        SEPARATOR,
        roleItem("front", "Bring all to front"),
      ]
    : [
        roleItem("minimize", "Minimize"),
        roleItem("close", "Close window", "Ctrl+W"),
      ];

  return [
    { id: "app", label: appName, items: appMenuItems },
    { id: "edit", label: "Edit", items: editMenuItems },
    { id: "view", label: "View", items: viewMenuItems },
    { id: "entry", label: "Entry", items: entryMenuItems },
    {
      id: "window",
      label: "Window",
      // macOS adds the window list to the menu with this role.
      ...(isMac ? { role: "window" } : {}),
      items: windowMenuItems,
    },
    {
      id: "help",
      label: "Help",
      // macOS adds the Help search field to the menu with this role.
      ...(isMac ? { role: "help" } : {}),
      items: [actionItem("app.shortcuts", "Keyboard shortcuts", "?")],
    },
  ];
}

/**
 * The Electron menu template for `model`. Action items call `sendAction` with
 * their registry id; role items run their Electron role. `platform` must be the
 * one the model was built for.
 *
 * @param {AppMenu[]} model
 * @param {{ platform: NodeJS.Platform, sendAction: (action: string) => void }} options
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function buildAppMenuTemplate(model, { platform, sendAction }) {
  return model.map((menu) => ({
    id: `menu:${menu.id}`,
    label: menu.label,
    ...(menu.role ? { role: menu.role } : {}),
    submenu: menu.items.map((item) =>
      toTemplateItem(item, platform, sendAction),
    ),
  }));
}

/** @returns {Electron.MenuItemConstructorOptions} */
function toTemplateItem(item, platform, sendAction) {
  if (item.type === "separator") {
    return { type: "separator" };
  }

  if (item.type === "role") {
    return {
      id: item.id,
      label: item.label,
      role: item.role,
      ...(item.accelerator ? { accelerator: item.accelerator } : {}),
    };
  }

  if (!item.accelerator) {
    return {
      id: item.id,
      label: item.label,
      click: () => sendAction(item.action),
    };
  }

  if (!isSingleKeyAccelerator(item.accelerator)) {
    return {
      id: item.id,
      label: item.label,
      accelerator: item.accelerator,
      click: () => sendAction(item.action),
    };
  }

  // macOS ignores `registerAccelerator` and would take the key from text
  // fields, so its single keys go in the label and bind nothing.
  if (platform === "darwin") {
    return {
      id: item.id,
      label: `${item.label} (${item.accelerator})`,
      click: () => sendAction(item.action),
    };
  }

  // Windows and Linux show the key without binding it.
  return {
    id: item.id,
    label: item.label,
    accelerator: item.accelerator,
    registerAccelerator: false,
    click: () => sendAction(item.action),
  };
}

/**
 * The role item with this id, or undefined. The Windows title bar menus send
 * item ids back to main, which only runs ids that name a role item.
 *
 * @param {AppMenu[]} model
 * @param {unknown} itemId
 * @returns {AppMenuRoleItem | undefined}
 */
function findAppMenuRoleItem(model, itemId) {
  if (typeof itemId !== "string") {
    return undefined;
  }

  for (const menu of model) {
    const item = menu.items.find(
      (candidate) => candidate.type === "role" && candidate.id === itemId,
    );
    if (item) {
      return /** @type {AppMenuRoleItem} */ (item);
    }
  }
  return undefined;
}

module.exports = {
  buildAppMenuTemplate,
  findAppMenuRoleItem,
  getAppMenuModel,
  isSingleKeyAccelerator,
};
