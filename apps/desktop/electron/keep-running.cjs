const {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");

/**
 * Ajour without its window (#534). Closing the window hides it, so the local
 * API, the plugin host and the MCP bridge keep answering, and a tray icon, or
 * a menu bar item on macOS, shows the running entry and offers Open Ajour,
 * Stop and Quit. See "Desktop window and quitting" in docs/agents/ux-spec.md.
 *
 * The rules are plain functions; `createTrayController` takes the Electron
 * tray and menu as seams, so main.cjs only wires them.
 */

/**
 * Stored in main, which needs it before the window exists. Keeping Ajour
 * running is on by default; the first close's notice shows once.
 */
const DEFAULT_WINDOW_SETTINGS = Object.freeze({
  keep_running: true,
  close_notice_shown: false,
});

/** Settings from anything: a value that is not true or false takes its default. */
function normalizeWindowSettings(value) {
  const stored =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const flag = (key) =>
    typeof stored[key] === "boolean"
      ? stored[key]
      : DEFAULT_WINDOW_SETTINGS[key];
  return {
    keep_running: flag("keep_running"),
    close_notice_shown: flag("close_notice_shown"),
  };
}

/** The stored settings, or the defaults when none are stored or they can't be read. */
function loadWindowSettings(file) {
  try {
    return normalizeWindowSettings(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_WINDOW_SETTINGS };
  }
}

function saveWindowSettings(file, value) {
  const settings = normalizeWindowSettings(value);
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, file);
  return settings;
}

/**
 * What the close button, Cmd+W or Ctrl+W does to the window: `hide` it while
 * Ajour keeps running, or `close` it. A quit, an update install or a system
 * shutdown always closes it.
 */
function closeActionOf({ quitting, keepRunning }) {
  return !quitting && keepRunning ? "hide" : "close";
}

/** The system notification the first close shows, once. */
function firstCloseNotice(platform) {
  return platform === "darwin"
    ? "Ajour is still running. Quit it from the menu bar."
    : "Ajour is still running. Quit it from the tray icon.";
}

const MINUTE_MS = 60_000;

/** "1:24": hours and minutes, rounded to the minute, as the window title shows. */
function formatCountedTime(countedMs) {
  const totalMinutes = Math.max(0, Math.round(countedMs / MINUTE_MS));
  const minutes = totalMinutes % 60;
  return `${Math.floor(totalMinutes / 60)}:${String(minutes).padStart(2, "0")}`;
}

/** How long until `formatCountedTime` shows the next minute. */
function msUntilCountedTimeChanges(countedMs) {
  const shownMinutes = Math.floor(Math.max(0, countedMs) / MINUTE_MS + 0.5);
  return (shownMinutes + 0.5) * MINUTE_MS - Math.max(0, countedMs);
}

const TITLE_LIMIT = 500;

/**
 * The tray state the window sends: the running entry's timer, title and
 * times, or nothing running. The window sends it when the entry changes, and
 * main counts the time itself, so a hidden window's slowed timers don't
 * delay the tooltip. Anything malformed reads as nothing running.
 */
function normalizeTrayState(value) {
  const entry = value && typeof value === "object" ? value.entry : undefined;
  if (!entry || typeof entry !== "object") return { entry: null };
  const { timerId, title, startedAt, accumulatedMs } = entry;
  if (
    typeof timerId !== "string" ||
    timerId.length === 0 ||
    timerId.length > 200 ||
    typeof title !== "string" ||
    title.trim().length === 0 ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(accumulatedMs) ||
    accumulatedMs < 0
  ) {
    return { entry: null };
  }
  return {
    entry: {
      timerId,
      title: title.trim().slice(0, TITLE_LIMIT),
      startedAt,
      accumulatedMs,
    },
  };
}

function countedMsOf(entry, now) {
  return entry.accumulatedMs + Math.max(0, now - entry.startedAt);
}

/** `text` cut to `limit` characters, ending in "…" when it was longer. */
function shorten(text, limit) {
  const characters = Array.from(text);
  return characters.length <= limit
    ? text
    : `${characters
        .slice(0, limit - 1)
        .join("")
        .trimEnd()}…`;
}

// Windows cuts a tray tooltip at 127 characters.
const TOOLTIP_LIMIT = 127;
const MENU_LABEL_LIMIT = 60;

/**
 * The tray's tooltip and menu. The tooltip reads like the window title,
 * "● 1:24 Fix export rounding", or "Ajour" when nothing runs. Windows and
 * Linux read "&" in a menu label as an access key, so the title's are doubled.
 */
function trayMenuModel({ entry, now, platform }) {
  const label = (text) =>
    platform === "darwin" ? text : text.replaceAll("&", "&&");
  const prefix = entry
    ? `● ${formatCountedTime(countedMsOf(entry, now))} `
    : "";
  return {
    tooltip: entry
      ? `${prefix}${shorten(entry.title, TOOLTIP_LIMIT - Array.from(prefix).length)}`
      : "Ajour",
    items: [
      { id: "open", label: "Open Ajour", enabled: true },
      { type: "separator" },
      {
        id: "entry",
        label: entry
          ? label(shorten(entry.title, MENU_LABEL_LIMIT))
          : "Nothing running",
        enabled: false,
      },
      { id: "stop", label: "Stop", enabled: Boolean(entry) },
      { type: "separator" },
      { id: "quit", label: "Quit", enabled: true },
    ],
  };
}

// The tooltip moves a little after the minute turns, so a timer never fires early.
const TICK_SLACK_MS = 100;

/**
 * The tray icon. `show` and `remove` follow the setting; `setState` takes the
 * window's tray state at any time and keeps it while the icon is gone. While
 * an entry runs, the tooltip moves with each minute. `onAction` gets `open`,
 * `stop` or `quit` with the entry the menu showed.
 *
 * `createTray` makes an Electron `Tray`, and `buildMenu` an Electron menu
 * from a template.
 */
function createTrayController({
  platform,
  now = Date.now,
  createTray,
  buildMenu,
  onAction,
}) {
  let tray = null;
  let entry = null;
  let menuKey = null;
  let tick = null;

  function stopTicking() {
    if (tick) clearTimeout(tick);
    tick = null;
  }

  function render() {
    stopTicking();
    if (!tray) return;
    const time = now();
    const model = trayMenuModel({ entry, now: time, platform });
    tray.setToolTip(model.tooltip);
    // The menu holds no time, so it changes only with the entry.
    const key = JSON.stringify(model.items);
    if (key !== menuKey) {
      menuKey = key;
      const shown = entry;
      tray.setContextMenu(
        buildMenu(
          model.items.map((item) =>
            "type" in item
              ? item
              : {
                  label: item.label,
                  enabled: item.enabled,
                  ...(item.id === "entry"
                    ? {}
                    : { click: () => onAction(item.id, shown) }),
                },
          ),
        ),
      );
    }
    if (entry) {
      tick = setTimeout(
        render,
        msUntilCountedTimeChanges(countedMsOf(entry, time)) + TICK_SLACK_MS,
      );
      tick.unref?.();
    }
  }

  return {
    show() {
      if (tray) return;
      tray = createTray();
      menuKey = null;
      // Windows opens the app on a click and the menu on a right-click. The
      // macOS menu bar item and Linux open the menu on a click.
      if (platform === "win32") tray.on("click", () => onAction("open", entry));
      render();
    },
    remove() {
      stopTicking();
      tray?.destroy();
      tray = null;
    },
    setState(state) {
      entry = normalizeTrayState(state).entry;
      render();
    },
    /** The running entry the window last sent, or null. */
    entry: () => entry,
  };
}

module.exports = {
  DEFAULT_WINDOW_SETTINGS,
  closeActionOf,
  createTrayController,
  firstCloseNotice,
  formatCountedTime,
  loadWindowSettings,
  msUntilCountedTimeChanges,
  normalizeTrayState,
  normalizeWindowSettings,
  saveWindowSettings,
  trayMenuModel,
};
