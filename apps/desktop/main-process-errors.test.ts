import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingEvents } from "./recording-events.ts";

// main.cjs runs only inside Electron, so these tests run its wiring, statement
// by statement, in a VM context with Electron replaced. The rules themselves
// live in the electron/*.cjs modules and have their own tests. `events`, the
// main process's emitter, is a VM global with a recording sink.

const require = createRequire(import.meta.url);
const { classifyNavigation } = require("./electron/navigation.cjs");
const {
  createIpcListeners,
  refusedSender,
} = require("./electron/ipc-listeners.cjs");
const { stopWithin } = require("./electron/stop-within.cjs");
const { watchWindow } = require("./electron/window-recovery.cjs");

const source = await readFile(
  new URL("./electron/main.cjs", import.meta.url),
  "utf8",
);

/**
 * The whole statement of main.cjs whose first line starts with `opening`: a
 * one-line statement, or everything up to the bracket that closes it at the
 * same indentation. Independent of what comes before or after it.
 */
function statement(opening: string) {
  const start = source.indexOf(opening);
  expect(start, opening).toBeGreaterThanOrEqual(0);
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const indent = source.slice(lineStart, start);
  const firstLineEnd = source.indexOf("\n", start);
  if (!/[{([]\s*$/.test(source.slice(start, firstLineEnd))) {
    return source.slice(lineStart, firstLineEnd + 1);
  }

  const closing = new RegExp(`\\n${indent}[})\\]][^\\n]*`, "g");
  closing.lastIndex = firstLineEnd;
  for (let match = closing.exec(source); match; match = closing.exec(source)) {
    // `} else {` closes one branch and opens the next.
    if (!/[{([]\s*$/.test(match[0])) {
      return `${source.slice(lineStart, match.index + match[0].length)}\n`;
    }
  }
  throw new Error(`No end for: ${opening}`);
}

function run(context: vm.Context, ...openings: string[]) {
  vm.runInContext(openings.map(statement).join("\n"), context);
}

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quitting and installing an update", () => {
  function quitRuntime(stopInternalAppApi: () => Promise<void>) {
    const handlers = new Map<string, (event: unknown) => void>();
    const app = {
      on: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
      quit: vi.fn(),
      exit: vi.fn(),
    };
    const { events, recorded } = recordingEvents();
    const context = vm.createContext({
      app,
      events,
      quitTrigger: "other",
      clearInterval,
      gracefulQuitStarted: false,
      pluginCatalogRefreshTimer: null,
      automaticUpdateController: { dispose: vi.fn() },
      stopInternalAppApi,
      stopWithin,
    });
    run(
      context,
      "const INTERNAL_APP_API_STOP_TIMEOUT_MS",
      "function stopInternalAppApiWithinTimeout(",
      "async function prepareToInstallUpdate(",
      "function cancelUpdateInstallPreparation(",
      'app.on("before-quit"',
    );
    return {
      app,
      recorded,
      quit() {
        const event = { preventDefault: vi.fn() };
        handlers.get("before-quit")?.(event);
        return event;
      },
      prepareToInstallUpdate: () =>
        context.prepareToInstallUpdate() as Promise<void>,
      cancelUpdateInstallPreparation: () =>
        context.cancelUpdateInstallPreparation(),
    };
  }

  const hangs = () => new Promise<void>(() => {});
  const fails = async () => {
    throw new Error("plugin manager refused to stop");
  };

  it("quits once the local API has stopped", async () => {
    const runtime = quitRuntime(async () => {});

    const event = runtime.quit();
    await flush();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(runtime.app.quit).toHaveBeenCalledOnce();
    expect(runtime.app.exit).not.toHaveBeenCalled();
  });

  it("still quits when stopping the local API fails", async () => {
    const runtime = quitRuntime(fails);

    runtime.quit();
    await flush();

    expect(runtime.app.quit).toHaveBeenCalledOnce();
  });

  it("exits after ten seconds when stopping the local API hangs", async () => {
    const runtime = quitRuntime(hangs);

    runtime.quit();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(runtime.app.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(runtime.app.exit).toHaveBeenCalledWith(0);
    expect(runtime.app.quit).not.toHaveBeenCalled();
  });

  it("installs the update when stopping the local API fails, as quitting does", async () => {
    const runtime = quitRuntime(fails);

    // The stop outcome goes to the install's event.
    await expect(runtime.prepareToInstallUpdate()).resolves.toBe("failed");
    // The updater's own quit then goes straight through.
    const event = runtime.quit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("installs the update after ten seconds when stopping the local API hangs", async () => {
    const runtime = quitRuntime(hangs);
    const prepared = vi.fn();

    void runtime.prepareToInstallUpdate().then(prepared);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(prepared).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(prepared).toHaveBeenCalledOnce();
    expect(runtime.quit().preventDefault).not.toHaveBeenCalled();
  });

  it("records the quit with the local API's stop", async () => {
    const runtime = quitRuntime(async () => {});

    runtime.quit();
    await flush();

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.quit",
        kind: "lifecycle",
        outcome: "ok",
        quit: {
          trigger: "other",
          api_stop: "stopped",
          api_stop_ms: expect.any(Number),
          updater_ms: expect.any(Number),
        },
      },
    ]);
  });

  it("records a failed stop on the quit", async () => {
    const runtime = quitRuntime(fails);

    runtime.quit();
    await flush();

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.quit",
        outcome: "error",
        outcome_reason: "api_stop_failed",
        quit: { api_stop: "failed" },
      },
    ]);
  });

  it("emits a timed-out quit before the process exits", async () => {
    const runtime = quitRuntime(hangs);
    let emittedBeforeExit = false;
    runtime.app.exit.mockImplementation(() => {
      emittedBeforeExit = runtime.recorded.length === 1;
    });

    runtime.quit();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(emittedBeforeExit).toBe(true);
    expect(runtime.recorded[0]).toMatchObject({
      outcome: "timeout",
      outcome_reason: "api_stop_timed_out",
      quit: { api_stop: "timed_out" },
    });
  });

  it("stops the local API again on the next quit when the update is cancelled", async () => {
    const runtime = quitRuntime(async () => {});
    await runtime.prepareToInstallUpdate();

    runtime.cancelUpdateInstallPreparation();
    const event = runtime.quit();
    await flush();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(runtime.app.quit).toHaveBeenCalledOnce();
  });
});

describe("IPC listeners", () => {
  function ipcRuntime({
    loadDesktopBootstrapLocalState = vi.fn(
      (): Record<string, unknown> | null => ({ updatedAt: 1 }),
    ),
  } = {}) {
    const ipcMain = new EventEmitter();
    const nativeTheme = { themeSource: "system" };
    const mainWindow = {
      webContents: "active-window",
      setTitleBarOverlay: vi.fn(),
    };
    const { events, recorded } = recordingEvents();
    const context = vm.createContext({
      app: { getPath: () => "/fixture" },
      events,
      refusedSender,
      ipc: createIpcListeners(ipcMain, { events }),
      nativeTheme,
      mainWindow,
      appMenuModel: { menus: [] },
      findAppMenuRoleItem: () => ({ role: "zoomIn" }),
      Menu: { getApplicationMenu: () => null },
      process: { platform: "win32" },
      getWindowsTitleBarOverlay: () => ({}),
      loadDesktopBootstrapLocalState,
    });
    run(
      context,
      "let desktopBootstrapLocalState",
      'ipc.answerSync("ajour:get-bootstrap-local-state"',
      'ipc.onMessage("ajour:run-menu-item"',
      'ipc.onMessage("ajour:run-edit-command"',
      'ipc.onMessage("ajour:set-theme-source"',
      'ipc.onMessage("ajour:set-window-chrome-theme"',
      "function assertActiveDesktopWindow(",
    );
    return {
      ipcMain,
      nativeTheme,
      mainWindow,
      recorded,
      requestBootstrapState() {
        const event: { sender: string; returnValue?: unknown } = {
          sender: "active-window",
        };
        ipcMain.emit("ajour:get-bootstrap-local-state", event);
        return event.returnValue;
      },
    };
  }

  it.each([
    ["ajour:run-menu-item", "zoom-in"],
    ["ajour:run-edit-command", "copy"],
    ["ajour:set-theme-source", "dark"],
    ["ajour:set-window-chrome-theme", "dark"],
  ])("ignores %s from a window other than the active one", (channel, value) => {
    const runtime = ipcRuntime();
    const foreign = { sender: "another-window", cut: vi.fn(), copy: vi.fn() };

    expect(() => runtime.ipcMain.emit(channel, foreign, value)).not.toThrow();
    expect(foreign.copy).not.toHaveBeenCalled();
    expect(runtime.nativeTheme.themeSource).toBe("system");
    expect(runtime.mainWindow.setTitleBarOverlay).not.toHaveBeenCalled();
  });

  it("still serves the active window", () => {
    const runtime = ipcRuntime();

    runtime.ipcMain.emit(
      "ajour:set-theme-source",
      { sender: "active-window" },
      "dark",
    );

    expect(runtime.nativeTheme.themeSource).toBe("dark");
  });

  // The refused sender is a security check, not a crash.
  it("records a message from another window as refused", () => {
    const runtime = ipcRuntime();

    runtime.ipcMain.emit(
      "ajour:set-theme-source",
      { sender: "another-window" },
      "dark",
    );

    expect(runtime.recorded).toMatchObject([
      {
        name: "window.set_theme",
        kind: "ipc",
        outcome: "refused",
        outcome_reason: "foreign_sender",
        ipc: { channel: "ajour:set-theme-source", sender_accepted: false },
      },
    ]);
  });

  it("records what each message did, with its enum values only", () => {
    const runtime = ipcRuntime();

    runtime.ipcMain.emit(
      "ajour:set-theme-source",
      { sender: "active-window" },
      "dark",
    );
    runtime.ipcMain.emit(
      "ajour:run-menu-item",
      { sender: "active-window" },
      "zoom-in",
    );

    expect(runtime.recorded).toMatchObject([
      { name: "window.set_theme", outcome: "ok", theme: { value: "dark" } },
      { name: "menu.run_item", outcome: "ok", menu: { item_id: "zoom-in" } },
    ]);
  });

  it("records a failed bootstrap read without the user's paths", () => {
    const runtime = ipcRuntime({
      loadDesktopBootstrapLocalState: vi.fn(
        (options: { report?: Record<string, unknown> }) => {
          options.report!.source = "none";
          options.report!.error = new Error(
            "EPERM: operation not permitted, open 'C:\\Users\\alex\\AppData\\Roaming\\@ajour\\desktop\\Local Storage\\leveldb\\000003.log'",
          );
          return null;
        },
      ),
    });

    expect(runtime.requestBootstrapState()).toBeNull();
    runtime.requestBootstrapState();

    expect(runtime.recorded).toMatchObject([
      {
        name: "local_state.recover",
        outcome: "error",
        local_state: { source: "none", cached: false },
        error: { type: "Error" },
      },
      { name: "local_state.recover", local_state: { cached: true } },
    ]);
    expect(runtime.recorded[0]!.error!.message).not.toContain("alex");
  });

  it("answers the bootstrap request with null when the read fails", () => {
    const runtime = ipcRuntime({
      loadDesktopBootstrapLocalState: vi.fn(() => {
        throw new Error("EPERM: operation not permitted");
      }),
    });

    expect(runtime.requestBootstrapState()).toBeNull();
  });

  // A reload after a crash asks again; recovery must still wait for the next
  // launch.
  it.each([
    ["finds nothing", () => null],
    [
      "fails",
      () => {
        throw new Error("EPERM: operation not permitted");
      },
    ],
  ])(
    "reads the bootstrap state once per launch when the read %s",
    (_outcome, read) => {
      const loadDesktopBootstrapLocalState = vi.fn(read);
      const runtime = ipcRuntime({ loadDesktopBootstrapLocalState });

      runtime.requestBootstrapState();
      const second = runtime.requestBootstrapState();

      expect(second).toBeNull();
      expect(loadDesktopBootstrapLocalState).toHaveBeenCalledOnce();
    },
  );
});

describe("the main window", () => {
  function windowRuntime({
    loadURL = async (_url: string) => {},
  }: { loadURL?: (url: string) => Promise<void> } = {}) {
    const windows: FakeBrowserWindow[] = [];
    class FakeBrowserWindow extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: (
          handler: (details: { url: string }) => { action: string },
        ) => {
          this.openHandler = handler;
        },
        forcefullyCrashRenderer: vi.fn(),
      });
      openHandler: (details: { url: string }) => { action: string } = () => ({
        action: "allow",
      });
      loadURL = vi.fn(loadURL);
      isDestroyed = () => false;
      constructor() {
        super();
        windows.push(this);
      }
    }
    const shell = {
      openExternal: vi.fn(async (_url: string) => {
        throw new Error("No application is associated with this link.");
      }),
    };
    const dialog = { showMessageBox: vi.fn(() => new Promise(() => {})) };
    const { events, recorded } = recordingEvents();
    const context = vm.createContext({
      BrowserWindow: FakeBrowserWindow,
      app: { quit: vi.fn() },
      events,
      quitTrigger: "other",
      URL,
      classifyNavigation,
      dialog,
      getPlatformWindowChromeOptions: () => ({}),
      iconPath: "icon.png",
      mainWindow: null,
      nativeTheme: { shouldUseDarkColors: false },
      preloadPath: "preload.cjs",
      process: { platform: "win32" },
      resolveRendererUrl: async () => "app://local/",
      shell,
      showEditContextMenu: vi.fn(),
      watchWindow,
    });
    run(
      context,
      "function schemeOf(",
      "function followNavigation(",
      "async function createMainWindow(",
    );
    return {
      shell,
      dialog,
      recorded,
      createMainWindow: () => context.createMainWindow() as Promise<void>,
      get window() {
        return windows[0]!;
      },
      navigate(url: string) {
        const event = { preventDefault: vi.fn() };
        windows[0]!.webContents.emit("will-navigate", event, url);
        return event;
      },
    };
  }

  it("keeps in-app navigation in the window", async () => {
    const runtime = windowRuntime();
    await runtime.createMainWindow();

    const event = runtime.navigate("app://local/backlog");

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(runtime.shell.openExternal).not.toHaveBeenCalled();
  });

  it("opens a web link in the system browser, even when that fails", async () => {
    const runtime = windowRuntime();
    await runtime.createMainWindow();

    const event = runtime.navigate("https://dev.azure.com/team/_workitems/1");
    await flush();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(runtime.shell.openExternal).toHaveBeenCalledWith(
      "https://dev.azure.com/team/_workitems/1",
    );
  });

  it("blocks a malformed URL without throwing", async () => {
    const runtime = windowRuntime();
    await runtime.createMainWindow();

    let event: { preventDefault: ReturnType<typeof vi.fn> } | undefined;
    expect(() => {
      event = runtime.navigate("http://[::1");
    }).not.toThrow();

    expect(event?.preventDefault).toHaveBeenCalled();
    expect(runtime.shell.openExternal).not.toHaveBeenCalled();
  });

  it("opens new-window links in the system browser only when they are web links", async () => {
    const runtime = windowRuntime();
    await runtime.createMainWindow();

    expect(runtime.window.openHandler({ url: "https://github.com/" })).toEqual({
      action: "deny",
    });
    expect(runtime.window.openHandler({ url: "ms-msdt:/id" })).toEqual({
      action: "deny",
    });
    await flush();

    expect(runtime.shell.openExternal.mock.calls).toEqual([
      ["https://github.com/"],
    ]);
  });

  it("records each navigation with its scheme, never its URL", async () => {
    const runtime = windowRuntime();
    await runtime.createMainWindow();

    runtime.navigate("https://dev.azure.com/team/_workitems/1");
    runtime.navigate("vscode://file/C:/Users/alex/notes.md");
    runtime.window.openHandler({ url: "http://[::1" });
    await flush();

    // The external link ends once the system answers, so after the others.
    const navigations = runtime.recorded.filter(
      (event) => event.name === "window.navigate",
    );
    navigations.unshift(navigations.pop()!);
    expect(navigations).toMatchObject([
      {
        kind: "navigation",
        outcome: "error",
        error: { message: "The system could not open the link." },
        navigation: {
          destination: "external",
          scheme: "https:",
          source: "will_navigate",
        },
      },
      {
        outcome: "refused",
        navigation: { destination: "blocked", scheme: "vscode:" },
      },
      {
        outcome: "refused",
        navigation: {
          destination: "blocked",
          scheme: "other",
          source: "window_open",
        },
      },
    ]);
    expect(JSON.stringify(navigations)).not.toMatch(/azure|alex|::1/);
  });

  it("records the window's first load as the launch's", async () => {
    const runtime = windowRuntime();

    await runtime.createMainWindow();

    expect(runtime.recorded).toMatchObject([
      { name: "window.load", outcome: "ok", window: { trigger: "launch" } },
    ]);
  });

  it("opens even when the app cannot load, and offers to try again", async () => {
    const runtime = windowRuntime({
      loadURL: async () => {
        throw Object.assign(
          new Error("ERR_FILE_NOT_FOUND (-6) loading 'app://local/'"),
          { code: "ERR_FILE_NOT_FOUND" },
        );
      },
    });

    // It resolves how long the load took, for app.launch.
    await expect(runtime.createMainWindow()).resolves.toEqual(
      expect.any(Number),
    );
    await flush();

    expect(runtime.dialog.showMessageBox).toHaveBeenCalledWith(
      runtime.window,
      expect.objectContaining({ buttons: ["Try again", "Quit"] }),
    );
  });
});

describe("startup", () => {
  function startupRuntime({
    createMainWindow = vi.fn(async () => 120),
    ensureInternalAppApiRunning = async () => {},
    hasSingleInstanceLock = true,
    mainWindow = null as null | Record<string, unknown>,
  }: {
    createMainWindow?: () => Promise<number>;
    ensureInternalAppApiRunning?: () => Promise<void>;
    hasSingleInstanceLock?: boolean;
    mainWindow?: null | Record<string, unknown>;
  } = {}) {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const app = {
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) =>
        handlers.set(name, handler),
      ),
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
    };
    const dialog = { showErrorBox: vi.fn() };
    const { events, recorded } = recordingEvents();
    const context = vm.createContext({
      app,
      appMenuModel: { menus: [] },
      buildAppMenuTemplate: () => [],
      BrowserWindow: { getAllWindows: () => [] },
      createMainWindow,
      delay: () => new Promise(() => {}),
      dialog,
      ensureInternalAppApiRunning,
      events,
      existsSync: () => true,
      hasSingleInstanceLock,
      mainWindow,
      Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
      performance: { timeOrigin: Date.now() - 500 },
      pluginCatalogSettings: { refreshMinutes: 15 },
      pluginCatalogSettingsPath: "plugin-catalog-settings.json",
      process: { platform: "win32", env: {} },
      quitTrigger: "other",
      refreshPluginCatalog: async () => {},
      registerStaticProtocol: vi.fn(),
      schedulePluginCatalogRefresh: vi.fn(),
      sendMenuAction: vi.fn(),
    });
    run(
      context,
      "function recordAppError(",
      "function quitAfterStartupFailure(",
      "function apiStartFailureOf(",
      "if (!hasSingleInstanceLock)",
    );
    return {
      app,
      dialog,
      createMainWindow,
      recorded,
      events,
      emit: (name: string, ...args: unknown[]) => handlers.get(name)?.(...args),
    };
  }

  it("says why and quits when the window cannot be created", async () => {
    const runtime = startupRuntime({
      createMainWindow: async () => {
        throw new Error("The GPU process could not start.");
      },
    });
    await flush();

    expect(runtime.dialog.showErrorBox).toHaveBeenCalledWith(
      "Ajour could not start",
      "The GPU process could not start.",
    );
    expect(runtime.app.quit).toHaveBeenCalledOnce();
  });

  it("starts without asking anything when the window opens", async () => {
    const runtime = startupRuntime();
    await flush();

    expect(runtime.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(runtime.app.quit).not.toHaveBeenCalled();
  });

  // Ajour is local-first and plugins are optional: another app holding the
  // port must not lock the user out of their timesheet.
  it("opens the window without plugins when the local API cannot start", async () => {
    const runtime = startupRuntime({
      ensureInternalAppApiRunning: async () => {
        throw new Error("port 8787 is already in use");
      },
    });
    await flush();

    expect(runtime.createMainWindow).toHaveBeenCalledOnce();
    expect(runtime.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(runtime.app.quit).not.toHaveBeenCalled();
  });

  it("records the launch with the time each phase took", async () => {
    const runtime = startupRuntime();
    await flush();

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.launch",
        kind: "lifecycle",
        trigger: "boot",
        outcome: "ok",
        launch: {
          ready_ms: expect.any(Number),
          api_start_ms: expect.any(Number),
          window_ms: expect.any(Number),
          renderer_load_ms: 120,
          renderer_source: "app_protocol",
        },
        api: { outcome: "started" },
        catalog: { settings_source: "saved", refresh_minutes: 15 },
      },
    ]);
    // The launch starts with the process.
    expect(runtime.recorded[0]!.duration_ms).toBeGreaterThanOrEqual(500);
  });

  it("records why the local API could not start", async () => {
    const runtime = startupRuntime({
      ensureInternalAppApiRunning: async () => {
        throw Object.assign(new Error("port 8787 is already in use"), {
          code: "port_in_use",
        });
      },
    });
    await flush();

    expect(runtime.recorded[0]).toMatchObject({
      name: "app.launch",
      outcome: "ok",
      api: { outcome: "failed", failure_reason: "port_in_use" },
    });
  });

  it("records a failed startup as an error, and the launch where it ended", async () => {
    const runtime = startupRuntime({
      createMainWindow: async () => {
        throw new Error("The GPU process could not start.");
      },
    });
    await flush();

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.launch",
        outcome: "error",
        outcome_reason: "startup_failed",
      },
      {
        name: "app.error",
        kind: "crash",
        crash: { origin: "startup_failure", handled_by: "dialog" },
        error: { message: "The GPU process could not start." },
      },
    ]);
  });

  it("emits the refused lock before the second process quits", async () => {
    const runtime = startupRuntime({ hasSingleInstanceLock: false });
    let emittedBeforeQuit = false;
    runtime.app.quit.mockImplementation(() => {
      emittedBeforeQuit = runtime.recorded.length === 1;
    });
    await flush();

    expect(runtime.recorded).toMatchObject([
      { name: "app.lock_refused", kind: "lifecycle" },
    ]);
    expect(runtime.app.quit).toHaveBeenCalledOnce();
    expect(emittedBeforeQuit).toBe(true);
  });

  it("records a second launch that restored and focused the window", async () => {
    const mainWindow = {
      isMinimized: () => true,
      restore: vi.fn(),
      focus: vi.fn(),
    };
    const runtime = startupRuntime({ mainWindow });
    await flush();

    runtime.emit("second-instance");

    expect(runtime.recorded.at(-1)).toMatchObject({
      name: "app.second_launch",
      trigger: "system",
      second_launch: { had_window: true, restored: true, focused: true },
    });
  });

  it("records a GPU process that ended", async () => {
    const runtime = startupRuntime();
    await flush();

    runtime.emit(
      "child-process-gone",
      {},
      { type: "GPU", reason: "crashed", exitCode: 3 },
    );

    expect(runtime.recorded.at(-1)).toMatchObject({
      name: "process.gone",
      kind: "crash",
      outcome: "error",
      process: { type: "gpu", reason: "crashed", exit_code: 3 },
    });
  });
});

describe("errors nothing else caught", () => {
  function crashRuntime() {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const { events, recorded } = recordingEvents();
    const context = vm.createContext({
      events,
      process: {
        on: (name: string, listener: (...args: unknown[]) => void) =>
          listeners.set(name, listener),
      },
    });
    run(
      context,
      "function recordAppError(",
      'process.on("uncaughtExceptionMonitor"',
      'process.on("unhandledRejection"',
    );
    return {
      events,
      recorded,
      emit: (name: string, ...args: unknown[]) =>
        listeners.get(name)?.(...args),
    };
  }

  it("records an uncaught exception, with the unit that was active", async () => {
    const runtime = crashRuntime();

    await runtime.events.run(
      "update.check",
      { kind: "ipc", trigger: "user" },
      async () => {
        runtime.emit(
          "uncaughtExceptionMonitor",
          new TypeError("x is undefined"),
          "uncaughtException",
        );
      },
    );

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.error",
        kind: "crash",
        outcome: "error",
        crash: {
          origin: "uncaught_exception",
          active_unit: "update.check",
          handled_by: "none",
        },
        error: { type: "TypeError" },
      },
      { name: "update.check" },
    ]);
  });

  it("records an unhandled rejection", () => {
    const runtime = crashRuntime();

    runtime.emit("unhandledRejection", new Error("refresh failed"));

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.error",
        crash: { origin: "unhandled_rejection" },
        error: { message: "refresh failed" },
      },
    ]);
  });
});
