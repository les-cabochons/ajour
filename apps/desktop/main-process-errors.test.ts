import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { classifyNavigation } = require("./electron/navigation.cjs");
const { createIpcListeners } = require("./electron/ipc-listeners.cjs");
const { stopWithin } = require("./electron/stop-within.cjs");
const { watchWindow } = require("./electron/window-recovery.cjs");

const source = await readFile(
  new URL("./electron/main.cjs", import.meta.url),
  "utf8",
);

/** The part of main.cjs from `start` up to `end`, or to the end of the file. */
function section(start: string, end?: string) {
  const startIndex = source.indexOf(start);
  expect(startIndex, start).toBeGreaterThanOrEqual(0);
  if (end === undefined) return source.slice(startIndex);
  const endIndex = source.indexOf(end, startIndex);
  expect(endIndex, end).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
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

describe("quitting", () => {
  function quitRuntime(stopInternalAppApi: () => Promise<void>) {
    const handlers = new Map<string, (event: unknown) => void>();
    const app = {
      on: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
      quit: vi.fn(),
      exit: vi.fn(),
    };
    const context = vm.createContext({
      app,
      process: { platform: "win32" },
      clearInterval,
      gracefulQuitStarted: false,
      pluginCatalogRefreshTimer: null,
      automaticUpdateController: { dispose: vi.fn() },
      stopInternalAppApi,
      stopWithin,
    });
    vm.runInContext(
      section(
        "const INTERNAL_APP_API_STOP_TIMEOUT_MS",
        "async function resolveRendererUrl()",
      ) + section('app.on("before-quit"', 'app.on("window-all-closed"'),
      context,
    );
    return {
      app,
      quit() {
        const event = { preventDefault: vi.fn() };
        handlers.get("before-quit")?.(event);
        return event;
      },
    };
  }

  it("quits once the local API has stopped", async () => {
    const runtime = quitRuntime(async () => {});

    const event = runtime.quit();
    await flush();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(runtime.app.quit).toHaveBeenCalledOnce();
    expect(runtime.app.exit).not.toHaveBeenCalled();
  });

  it("still quits when stopping the local API fails", async () => {
    const runtime = quitRuntime(async () => {
      throw new Error("plugin manager refused to stop");
    });

    runtime.quit();
    await flush();

    expect(runtime.app.quit).toHaveBeenCalledOnce();
  });

  it("exits after ten seconds when stopping the local API hangs", async () => {
    const runtime = quitRuntime(() => new Promise(() => {}));

    runtime.quit();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(runtime.app.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(runtime.app.exit).toHaveBeenCalledWith(0);
    expect(runtime.app.quit).not.toHaveBeenCalled();
  });
});

describe("IPC listeners", () => {
  function ipcRuntime({
    loadDesktopBootstrapLocalState = () => ({ updatedAt: 1 }),
  } = {}) {
    const ipcMain = Object.assign(new EventEmitter(), { handle: vi.fn() });
    const nativeTheme = { themeSource: "system" };
    const mainWindow = {
      webContents: "active-window",
      setTitleBarOverlay: vi.fn(),
    };
    const context = vm.createContext({
      app: { getPath: () => "/fixture" },
      ipc: createIpcListeners(ipcMain),
      ipcMain,
      nativeTheme,
      mainWindow,
      appMenuModel: { menus: [] },
      findAppMenuRoleItem: () => ({ role: "zoomIn" }),
      Menu: { getApplicationMenu: () => null },
      process: { platform: "win32" },
      getWindowsTitleBarOverlay: () => ({}),
      loadDesktopBootstrapLocalState,
      desktopBootstrapLocalState: null,
    });
    vm.runInContext(
      section(
        'ipc.answerSync("ajour:get-bootstrap-local-state"',
        'ipcMain.handle("ajour:check-for-updates"',
      ) +
        section(
          "function assertActiveDesktopWindow(",
          "function assertDevelopmentBuild(",
        ),
      context,
    );
    return { ipcMain, nativeTheme, mainWindow };
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

  it("answers the bootstrap request with null when the read fails", () => {
    const runtime = ipcRuntime({
      loadDesktopBootstrapLocalState: () => {
        throw new Error("EPERM: operation not permitted");
      },
    });
    const event: { sender: string; returnValue?: unknown } = {
      sender: "active-window",
    };

    expect(() =>
      runtime.ipcMain.emit("ajour:get-bootstrap-local-state", event),
    ).not.toThrow();
    expect(event.returnValue).toBeNull();
  });
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
    const context = vm.createContext({
      BrowserWindow: FakeBrowserWindow,
      app: { quit: vi.fn() },
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
    vm.runInContext(
      section(
        "function openExternalLink(",
        "function quitAfterStartupFailure(",
      ) +
        section(
          "async function createMainWindow()",
          "if (!hasSingleInstanceLock)",
        ),
      context,
    );
    return {
      shell,
      dialog,
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

  it.each(["http://[::1", "file:///C:/Windows/System32/calc.exe"])(
    "blocks navigation to %s without throwing",
    async (url) => {
      const runtime = windowRuntime();
      await runtime.createMainWindow();

      let event: { preventDefault: ReturnType<typeof vi.fn> } | undefined;
      expect(() => {
        event = runtime.navigate(url);
      }).not.toThrow();

      expect(event?.preventDefault).toHaveBeenCalled();
      expect(runtime.shell.openExternal).not.toHaveBeenCalled();
    },
  );

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

  it("opens even when the app cannot load, and offers to try again", async () => {
    const runtime = windowRuntime({
      loadURL: async () => {
        throw Object.assign(
          new Error("ERR_FILE_NOT_FOUND (-6) loading 'app://local/'"),
          { code: "ERR_FILE_NOT_FOUND" },
        );
      },
    });

    await expect(runtime.createMainWindow()).resolves.toBeUndefined();
    await flush();

    expect(runtime.dialog.showMessageBox).toHaveBeenCalledWith(
      runtime.window,
      expect.objectContaining({ buttons: ["Try again", "Quit"] }),
    );
  });
});

describe("startup", () => {
  function startupRuntime(createMainWindow: () => Promise<void>) {
    const app = {
      on: vi.fn(),
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
    };
    const dialog = { showErrorBox: vi.fn() };
    const context = vm.createContext({
      app,
      appMenuModel: { menus: [] },
      buildAppMenuTemplate: () => [],
      console: { error: vi.fn() },
      createMainWindow,
      dialog,
      ensureInternalAppApiRunning: async () => {},
      hasSingleInstanceLock: true,
      Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
      process: { platform: "win32", env: {} },
      refreshPluginCatalog: async () => {},
      registerStaticProtocol: vi.fn(),
      schedulePluginCatalogRefresh: vi.fn(),
      sendMenuAction: vi.fn(),
    });
    vm.runInContext(
      section(
        "function quitAfterStartupFailure(",
        "async function createMainWindow()",
      ) + section("if (!hasSingleInstanceLock)"),
      context,
    );
    return { app, dialog };
  }

  it("says why and quits when the window cannot be created", async () => {
    const runtime = startupRuntime(async () => {
      throw new Error("The GPU process could not start.");
    });
    await flush();

    expect(runtime.dialog.showErrorBox).toHaveBeenCalledWith(
      "Ajour could not start",
      "The GPU process could not start.",
    );
    expect(runtime.app.quit).toHaveBeenCalledOnce();
  });

  it("starts without asking anything when the window opens", async () => {
    const runtime = startupRuntime(async () => {});
    await flush();

    expect(runtime.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(runtime.app.quit).not.toHaveBeenCalled();
  });
});
