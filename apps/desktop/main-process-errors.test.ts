import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingEvents } from "./recording-events.ts";

// main.cjs runs only inside Electron, so these tests run its wiring, statement
// by statement, in a VM context with Electron replaced. The rules themselves
// live in the electron/*.cjs modules and have their own tests. `events`, the
// main process's emitter, is a VM global with a recording sink.

const require = createRequire(import.meta.url);

/*
 * The main process's part of the privacy canary (#311, ADR 0011), with the
 * marker of apps/web/src/lib/wide-events-canary.test.ts: what the renderer
 * sends, the URLs it opens and what a failure names carry it, and no event
 * may hold it.
 */
const MARKER = "CANARY-LEAK-7Q4X";
const MARKED = /canary-leak-7q4x/i;
const { classifyNavigation } = require("./electron/navigation.cjs");
const {
  createIpcListeners,
  refusedSender,
} = require("./electron/ipc-listeners.cjs");
const { stopWithin } = require("./electron/stop-within.cjs");
const {
  buildAppMenuTemplate,
  findAppMenuRoleItem,
  getAppMenuModel,
} = require("./electron/app-menu.cjs");
const {
  buildContextMenuTemplate,
  normalizeContextMenuItems,
  objectActionIdOf,
} = require("./electron/context-menu.cjs");
const { apiStopOf, triggerOf } = require("./electron/main-events.cjs");
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
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quitting and installing an update", () => {
  function quitRuntime(
    stopInternalAppApi: () => Promise<void>,
    {
      loaded = true,
      quitTrigger = "other",
      flushLogs = async () => {},
    }: {
      loaded?: boolean;
      quitTrigger?: string;
      flushLogs?: () => Promise<void>;
    } = {},
  ) {
    const handlers = new Map<string, (event: unknown) => void>();
    const app = {
      on: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
      quit: vi.fn(),
      exit: vi.fn(),
    };
    const { events, recorded, attach } = recordingEvents({ loaded });
    const automaticUpdateController = {
      dispose: vi.fn(),
      installerQuitting: vi.fn(),
    };
    const order: string[] = [];
    const closePluginRenderers = vi.fn(async () => {
      order.push("plugin renderers closed");
    });
    app.quit.mockImplementation(() => order.push("quit"));
    const localLogs = {
      flush: vi.fn(flushLogs),
      startSweeps: vi.fn(),
      drainSync: vi.fn(),
    };
    const context = vm.createContext({
      localLogs,
      closePluginRenderers,
      app,
      events,
      quitTrigger,
      apiStopOf,
      triggerOf,
      // The faked clock: the quit's deadline counts from Date.now().
      Date,
      clearInterval,
      setTimeout,
      clearTimeout,
      gracefulQuitStarted: false,
      pluginCatalogRefreshTimer: null,
      automaticUpdateController,
      stopInternalAppApi,
      stopWithin,
    });
    run(
      context,
      "const INTERNAL_APP_API_STOP_TIMEOUT_MS",
      "function stopInternalAppApiWithinTimeout(",
      "function startQuit(",
      "function recordApiStop(",
      "function endQuit(",
      "function whenEventsReady(",
      "let updateQuit",
      "let systemQuitRecorded",
      "function recordSessionEnd(",
      "async function prepareToInstallUpdate(",
      "function cancelUpdateInstallPreparation(",
      'app.on("before-quit"',
      'app.on("will-quit"',
    );
    return {
      app,
      recorded,
      attach,
      automaticUpdateController,
      closePluginRenderers,
      localLogs,
      order,
      emit: (name: string) => handlers.get(name)?.({ preventDefault: vi.fn() }),
      quit() {
        const event = { preventDefault: vi.fn() };
        handlers.get("before-quit")?.(event);
        return event;
      },
      recordSessionEnd: () => context.recordSessionEnd(),
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

  it("closes every plugin renderer once the local API stopped, before it quits", async () => {
    const runtime = quitRuntime(async () => {});

    runtime.quit();
    await flush();

    expect(runtime.closePluginRenderers).toHaveBeenCalledOnce();
    expect(runtime.order).toEqual(["plugin renderers closed", "quit"]);
  });

  it("writes what the local log file holds before it quits", async () => {
    let written = () => {};
    const runtime = quitRuntime(async () => {}, {
      flushLogs: () =>
        new Promise<void>((resolve) => {
          written = resolve;
        }),
    });

    runtime.quit();
    await flush();
    expect(runtime.localLogs.flush).toHaveBeenCalledOnce();
    expect(runtime.app.quit).not.toHaveBeenCalled();

    written();
    await flush();
    expect(runtime.app.quit).toHaveBeenCalledOnce();
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

  // app.exit skips will-quit, which is where the log file is drained.
  it("writes the log file's waiting events before it exits on a timed-out stop", async () => {
    const runtime = quitRuntime(hangs);

    runtime.quit();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(runtime.localLogs.drainSync).toHaveBeenCalledOnce();
    expect(
      runtime.localLogs.drainSync.mock.invocationCallOrder[0]!,
    ).toBeLessThan(runtime.app.exit.mock.invocationCallOrder[0]!);
  });

  it("installs the update when stopping the local API fails, as quitting does", async () => {
    const runtime = quitRuntime(fails);

    // The stop outcome goes to the install's event.
    await expect(runtime.prepareToInstallUpdate()).resolves.toBe("failed");
    // The updater's own quit then goes straight through.
    const event = runtime.quit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("closes every plugin renderer before an update installs, so none outlives the installer's quit", async () => {
    const runtime = quitRuntime(async () => {});

    await runtime.prepareToInstallUpdate();

    expect(runtime.closePluginRenderers).toHaveBeenCalledOnce();
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

  // A system shutdown, or a Quit no Ajour code saw, is not the user.
  it("names a quit it cannot attribute as the system's", async () => {
    const runtime = quitRuntime(async () => {});

    runtime.quit();
    await flush();

    expect(runtime.recorded[0]).toMatchObject({
      trigger: "system",
      quit: { trigger: "other" },
    });
  });

  it("still stops the local API after a session end, without a second quit event", async () => {
    const runtime = quitRuntime(async () => {});

    runtime.recordSessionEnd();
    runtime.quit();
    await flush();

    expect(runtime.recorded).toMatchObject([
      { name: "app.quit", quit: { trigger: "os" } },
    ]);
    expect(runtime.app.quit).toHaveBeenCalledOnce();
  });

  it("records a menu Quit as the user's, on its own event", async () => {
    const runtime = quitRuntime(async () => {}, { quitTrigger: "menu" });

    runtime.quit();
    await flush();

    expect(runtime.recorded[0]).toMatchObject({
      name: "app.quit",
      trigger: "user",
      quit: { trigger: "menu", api_stop: "stopped" },
    });
  });

  it("records the quit an update install makes, once the installer quits", async () => {
    const runtime = quitRuntime(async () => {});

    await runtime.prepareToInstallUpdate();
    expect(runtime.recorded).toEqual([]);
    runtime.quit();

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.quit",
        outcome: "ok",
        quit: { trigger: "update_install", api_stop: "stopped" },
      },
    ]);
  });

  it("records an update install that did not quit as cancelled", async () => {
    const runtime = quitRuntime(async () => {});

    await runtime.prepareToInstallUpdate();
    runtime.cancelUpdateInstallPreparation();

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.quit",
        outcome: "cancelled",
        outcome_reason: "update_cancelled",
        quit: { trigger: "update_install" },
      },
    ]);
  });

  it("waits for the events package before the process quits", async () => {
    const runtime = quitRuntime(async () => {}, { loaded: false });

    runtime.quit();
    await flush();
    expect(runtime.app.quit).not.toHaveBeenCalled();
    runtime.attach();
    await flush();

    expect(runtime.app.quit).toHaveBeenCalledOnce();
    expect(runtime.recorded).toMatchObject([{ name: "app.quit" }]);
  });

  // The install's event stays open until the app quits for the installer.
  it("tells the update controller when the app quits", () => {
    const runtime = quitRuntime(async () => {});

    runtime.emit("will-quit");

    expect(
      runtime.automaticUpdateController.installerQuitting,
    ).toHaveBeenCalledOnce();
  });

  // An update install's events end after the last flush: the installer's quit ends one at will-quit.
  it("writes the log file's waiting events at will-quit, after the installer's quit ended its event", () => {
    const runtime = quitRuntime(async () => {});

    runtime.emit("will-quit");

    expect(runtime.localLogs.drainSync).toHaveBeenCalledOnce();
    expect(
      runtime.automaticUpdateController.installerQuitting.mock
        .invocationCallOrder[0],
    ).toBeLessThan(runtime.localLogs.drainSync.mock.invocationCallOrder[0]!);
  });

  // The installer's quit skips before-quit's wait, so preparation waits.
  it("waits for the events package before an update installs", async () => {
    const runtime = quitRuntime(async () => {}, { loaded: false });
    const prepared = vi.fn();

    void runtime.prepareToInstallUpdate().then(prepared);
    await flush();
    expect(prepared).not.toHaveBeenCalled();
    runtime.attach();
    await flush();

    expect(prepared).toHaveBeenCalledOnce();
  });

  it("installs within ten seconds even when the events package never loads", async () => {
    const runtime = quitRuntime(async () => {}, { loaded: false });
    const prepared = vi.fn();

    void runtime.prepareToInstallUpdate().then(prepared);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(prepared).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(prepared).toHaveBeenCalledOnce();
  });

  it("quits within ten seconds even when the events package never loads", async () => {
    const runtime = quitRuntime(async () => {}, { loaded: false });

    runtime.quit();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(runtime.app.quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(runtime.app.quit).toHaveBeenCalledOnce();
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
    role = "zoomIn",
    realMenu = false,
  } = {}) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = Object.assign(new EventEmitter(), {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    });
    let popup: { callback: () => void } | undefined;
    let template: { label?: string; click?: () => void }[] = [];
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
      appMenuModel: realMenu
        ? getAppMenuModel({
            platform: "win32",
            developmentBuild: false,
            appName: "Ajour",
          })
        : { menus: [] },
      findAppMenuRoleItem: realMenu ? findAppMenuRoleItem : () => ({ role }),
      quitTrigger: "other",
      Menu: {
        getApplicationMenu: () => null,
        buildFromTemplate: (built: typeof template) => {
          template = built;
          return {
            popup: (options: { callback: () => void }) => {
              popup = options;
            },
          };
        },
      },
      normalizeContextMenuItems,
      buildContextMenuTemplate,
      getPopupPosition: () => ({}),
      getContextMenuIcon: () => undefined,
      objectActionIdOf,
      setTimeout,
      process: { platform: "win32" },
      getWindowsTitleBarOverlay: () => ({}),
      loadDesktopBootstrapLocalState,
    });
    run(
      context,
      "let desktopBootstrapLocalState",
      'ipc.answerSync("ajour:get-bootstrap-local-state"',
      'ipc.onMessage("ajour:run-menu-item"',
      'ipc.handle("ajour:show-context-menu"',
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
      context,
      /** Shows a context menu with `ids` and picks the item labelled `pick`. */
      async pickFromContextMenu(ids: string[], pick: string) {
        const sender = { getZoomFactor: () => 1 };
        mainWindow.webContents = sender as never;
        const shown = handlers.get("ajour:show-context-menu")!(
          { sender },
          ids.map((id) => ({ type: "item", id, label: id, enabled: true })),
          { x: 1, y: 1 },
        );
        template.find((item) => item.label === pick)?.click?.();
        popup?.callback();
        await vi.runAllTimersAsync();
        return await shown;
      },
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

  // The renderer names the items; only a known object action enters an event.
  it("records the picked object action, and any other id as other", async () => {
    const runtime = ipcRuntime();

    await expect(
      runtime.pickFromContextMenu(["settle", "archive"], "settle"),
    ).resolves.toBe("settle");
    await runtime.pickFromContextMenu(
      ["https://private.example/secret"],
      "https://private.example/secret",
    );

    expect(runtime.recorded).toMatchObject([
      {
        name: "context_menu.show",
        context_menu: {
          item_count: 2,
          kept_count: 2,
          picked: true,
          action_id: "settle",
        },
      },
      { name: "context_menu.show", context_menu: { action_id: "other" } },
    ]);
    expect(JSON.stringify(runtime.recorded)).not.toContain("private.example");
  });

  // The renderer names the item; only one of the menu's own role items
  // enters an event.
  it("never records a menu item id the menu does not have", () => {
    const runtime = ipcRuntime({ realMenu: true });

    runtime.ipcMain.emit(
      "ajour:run-menu-item",
      { sender: "active-window" },
      "https://private.example/menu",
    );
    runtime.ipcMain.emit(
      "ajour:run-menu-item",
      { sender: "active-window" },
      "role:zoomIn",
    );

    expect(runtime.recorded).toMatchObject([
      { name: "menu.run_item", outcome: "ok" },
      { name: "menu.run_item", menu: { item_id: "role:zoomIn" } },
    ]);
    expect(runtime.recorded[0]).not.toHaveProperty("menu");
    expect(JSON.stringify(runtime.recorded)).not.toContain("private.example");
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

  it("keeps what the renderer sends out of every IPC event: the privacy canary", async () => {
    const runtime = ipcRuntime({
      realMenu: true,
      loadDesktopBootstrapLocalState: vi.fn(
        (options: { report?: Record<string, unknown> }) => {
          options.report!.source = "recovery_file";
          // The state it found is the user's: the event counts records only.
          return { timesheetEntries: [{ note: MARKER }] };
        },
      ),
    });
    const active = { sender: "active-window", cut: vi.fn(), copy: vi.fn() };

    await runtime.pickFromContextMenu(
      [`open:${MARKER}`, "settle"],
      `open:${MARKER}`,
    );
    runtime.ipcMain.emit("ajour:run-menu-item", active, `role:${MARKER}`);
    runtime.ipcMain.emit("ajour:run-edit-command", active, MARKER);
    runtime.ipcMain.emit("ajour:set-theme-source", active, MARKER);
    runtime.ipcMain.emit("ajour:set-window-chrome-theme", active, MARKER);
    runtime.requestBootstrapState();

    expect(runtime.recorded.map((event) => event.name)).toEqual([
      "context_menu.show",
      "menu.run_item",
      "edit.run",
      "window.set_theme",
      "window.set_theme",
      "local_state.recover",
    ]);
    expect(runtime.recorded[0]).toMatchObject({
      context_menu: { picked: true, action_id: "other" },
    });
    expect(JSON.stringify(runtime.recorded)).not.toMatch(MARKED);
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
      gracefulQuitStarted: false,
      triggerOf,
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
      "function startQuit(",
      "let systemQuitRecorded",
      "function recordSessionEnd(",
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

  it("keeps the URLs the window opens out of every event: the privacy canary", async () => {
    const runtime = windowRuntime();
    await runtime.createMainWindow();

    runtime.navigate(`https://${MARKER}.example.test/${MARKER}?q=${MARKER}`);
    runtime.navigate(`vscode://file/C:/Users/alex/${MARKER}.md`);
    runtime.window.openHandler({ url: `https://example.test/#${MARKER}` });
    runtime.window.openHandler({ url: `mailto:${MARKER}@example.test` });
    await flush();

    expect(
      runtime.recorded.filter((event) => event.name === "window.navigate"),
    ).toHaveLength(4);
    expect(JSON.stringify(runtime.recorded)).not.toMatch(MARKED);
  });

  // Windows ends the session without before-quit, so the quit is recorded
  // when the session ends.
  it("records a quit the system began on Windows, once", async () => {
    const runtime = windowRuntime();
    await runtime.createMainWindow();

    runtime.window.emit("session-end");
    runtime.window.emit("session-end");

    expect(
      runtime.recorded.filter((event) => event.name === "app.quit"),
    ).toMatchObject([{ trigger: "system", quit: { trigger: "os" } }]);
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

    // It resolves how long the load took and how it ended, for app.launch.
    await expect(runtime.createMainWindow()).resolves.toEqual({
      loadMs: expect.any(Number),
      loadOutcome: "error",
    });
    await flush();

    expect(runtime.dialog.showMessageBox).toHaveBeenCalledWith(
      runtime.window,
      expect.objectContaining({ buttons: ["Try again", "Quit"] }),
    );
  });
});

describe("startup", () => {
  function startupRuntime({
    createMainWindow = vi.fn(async () => ({ loadMs: 120, loadOutcome: "ok" })),
    ensureInternalAppApiRunning = async () => {},
    hasSingleInstanceLock = true,
    mainWindow = null as null | Record<string, unknown>,
    loaded = true,
    packaged = true,
  }: {
    loaded?: boolean;
    packaged?: boolean;
    createMainWindow?: () => Promise<{ loadMs: number; loadOutcome: string }>;
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
      getPath: () => "/fixture",
      getVersion: () => "1.3.0",
      isPackaged: packaged,
    };
    const dialog = { showErrorBox: vi.fn() };
    const { events, recorded, attach } = recordingEvents({ loaded });
    const powerMonitor = new EventEmitter();
    const localLogs = { flush: async () => {}, startSweeps: vi.fn() };
    let menuTemplate: {
      submenu?: { id?: string; click?: () => void }[];
    }[] = [];
    const writeLaunchVersion = vi.fn();
    const defaultSession = { name: "window session" };
    const addWindowApiToken = vi.fn();
    const context = vm.createContext({
      addWindowApiToken,
      app,
      appMenuModel: getAppMenuModel({
        platform: "win32",
        developmentBuild: false,
        appName: "Ajour",
      }),
      buildAppMenuTemplate,
      powerMonitor,
      BrowserWindow: { getAllWindows: () => [] },
      createMainWindow,
      dialog,
      ensureInternalAppApiRunning,
      events,
      existsSync: () => true,
      hasSingleInstanceLock,
      localLogs,
      INTERNAL_APP_API_HOST: "127.0.0.1",
      INTERNAL_APP_API_PORT: 8787,
      INTERNAL_APP_API_STOP_TIMEOUT_MS: 10_000,
      mainWindow,
      path,
      readLaunchVersion: vi.fn(() => "1.2.0"),
      writeLaunchVersion,
      setTimeout,
      clearTimeout,
      Menu: {
        setApplicationMenu: vi.fn(),
        buildFromTemplate: (built: typeof menuTemplate) => {
          menuTemplate = built;
        },
      },
      performance: { timeOrigin: Date.now() - 500 },
      pluginCatalogSettings: { refreshMinutes: 15 },
      pluginCatalogSettingsPath: "plugin-catalog-settings.json",
      process: { platform: "win32", env: {} },
      quitTrigger: "other",
      refreshPluginCatalog: async () => {},
      registerStaticProtocol: vi.fn(),
      schedulePluginCatalogRefresh: vi.fn(),
      sendMenuAction: vi.fn(),
      session: { defaultSession },
      windowApiToken: "launch-token",
    });
    run(
      context,
      "function recordAppError(",
      "function quitAfterStartupFailure(",
      "function launchVersionMarker(",
      "function quitFromMenu(",
      "function apiStartFailureOf(",
      "function whenEventsReady(",
      "if (!hasSingleInstanceLock)",
    );
    return {
      addWindowApiToken,
      defaultSession,
      app,
      dialog,
      createMainWindow,
      recorded,
      events,
      attach,
      writeLaunchVersion,
      context,
      powerMonitor,
      localLogs,
      /** Clicks a menu item of the app menu main.cjs built. */
      clickMenuItem(id: string) {
        menuTemplate
          .flatMap((menu) => menu.submenu ?? [])
          .find((item) => item.id === id)
          ?.click?.();
      },
      emit: (name: string, ...args: unknown[]) => handlers.get(name)?.(...args),
    };
  }

  it("starts the local log file's retention sweeps only in the process that holds the lock", async () => {
    const holder = startupRuntime();
    const second = startupRuntime({ hasSingleInstanceLock: false });
    await flush();

    expect(holder.localLogs.startSweeps).toHaveBeenCalledOnce();
    expect(second.localLogs.startSweeps).not.toHaveBeenCalled();
  });

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

  it("adds the window token to the window's session before the window opens", async () => {
    const runtime = startupRuntime();
    await flush();

    expect(runtime.addWindowApiToken).toHaveBeenCalledWith(
      runtime.defaultSession,
      { apiOrigin: "http://127.0.0.1:8787", token: "launch-token" },
    );
    expect(runtime.addWindowApiToken.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runtime.createMainWindow).mock.invocationCallOrder[0]!,
    );
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

  it("records the version the previous launch ran", async () => {
    const runtime = startupRuntime();
    await flush();

    expect(runtime.recorded[0]).toMatchObject({
      name: "app.launch",
      launch: { previous_version: "1.2.0" },
    });
  });

  // Development runs share the user data folder, and would fake an upgrade.
  it("leaves the version marker alone in a development build", async () => {
    const runtime = startupRuntime({ packaged: false });
    await flush();

    expect(runtime.recorded[0]!.launch).not.toHaveProperty("previous_version");
    expect(runtime.writeLaunchVersion).not.toHaveBeenCalled();
  });

  it("writes this launch's version once the window has loaded", async () => {
    const loaded = startupRuntime();
    const failed = startupRuntime({
      createMainWindow: async () => ({ loadMs: 40, loadOutcome: "error" }),
    });
    await flush();

    expect(loaded.writeLaunchVersion).toHaveBeenCalledWith(
      expect.stringMatching(/last-launch\.json$/),
      "1.3.0",
    );
    expect(failed.writeLaunchVersion).not.toHaveBeenCalled();
  });

  it("ends the launch with the failed load's outcome", async () => {
    const runtime = startupRuntime({
      createMainWindow: async () => ({ loadMs: 40, loadOutcome: "error" }),
    });
    await flush();

    expect(runtime.recorded[0]).toMatchObject({
      name: "app.launch",
      outcome: "error",
      outcome_reason: "load_failed",
      launch: { renderer_load_ms: 40 },
    });
  });

  it("waits for the events package before the second process quits", async () => {
    const runtime = startupRuntime({
      hasSingleInstanceLock: false,
      loaded: false,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(runtime.app.quit).not.toHaveBeenCalled();
    runtime.attach();
    await flush();

    expect(runtime.app.quit).toHaveBeenCalledOnce();
    expect(runtime.recorded).toMatchObject([{ name: "app.lock_refused" }]);
  });

  // The title bar's Quit clicks the same item through ajour:run-menu-item.
  it("names a Quit from the app menu as the menu's", async () => {
    const runtime = startupRuntime();
    await flush();

    runtime.clickMenuItem("role:quit");

    expect(runtime.context.quitTrigger).toBe("menu");
    expect(runtime.app.quit).toHaveBeenCalledOnce();
  });

  it("names a quit the system began on macOS and Linux as the system's", async () => {
    const runtime = startupRuntime();
    await flush();

    runtime.powerMonitor.emit("shutdown");
    runtime.emit("window-all-closed");

    expect(runtime.context.quitTrigger).toBe("os");
  });

  it("names a quit after the last window closed as such", async () => {
    const runtime = startupRuntime();
    await flush();

    runtime.emit("window-all-closed");

    expect(runtime.context.quitTrigger).toBe("all_windows_closed");
    expect(runtime.app.quit).toHaveBeenCalledOnce();
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
    const emitWarning = vi.fn();
    const context = vm.createContext({
      events,
      process: {
        on: (name: string, listener: (...args: unknown[]) => void) =>
          listeners.set(name, listener),
        emitWarning,
      },
    });
    run(
      context,
      "function describeRejection(",
      "function recordAppError(",
      'process.on("uncaughtExceptionMonitor"',
      'process.on("unhandledRejection"',
    );
    return {
      events,
      recorded,
      emitWarning,
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

  it("keeps what a failure names out of its event, once scrubbed: the privacy canary", () => {
    const runtime = crashRuntime();

    runtime.emit(
      "uncaughtExceptionMonitor",
      new Error(
        `Could not fetch https://${MARKER}.example.test/${MARKER}?token=${MARKER}`,
      ),
      "uncaughtException",
    );
    runtime.emit(
      "unhandledRejection",
      Object.assign(new Error(`Refused at https://example.test/${MARKER}`), {
        code: "ECONNREFUSED",
      }),
    );

    expect(runtime.recorded).toMatchObject([
      {
        name: "app.error",
        error: { message: "Could not fetch [url]" },
      },
      { name: "app.error", error: { code: "ECONNREFUSED" } },
    ]);
    expect(JSON.stringify(runtime.recorded)).not.toMatch(MARKED);
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

  // Events go nowhere by default, so a rejection keeps Node's warning.
  it("keeps the warning an unhandled rejection prints without a listener", () => {
    const runtime = crashRuntime();

    runtime.emit("unhandledRejection", new Error("refresh failed"));
    runtime.emit("unhandledRejection", Object.create(null));

    expect(runtime.emitWarning.mock.calls).toEqual([
      [
        expect.stringContaining("refresh failed"),
        "UnhandledPromiseRejectionWarning",
      ],
      [
        "Unhandled promise rejection: a value that cannot be printed",
        "UnhandledPromiseRejectionWarning",
      ],
    ]);
  });
});

/*
 * The same rule as the web canary's (apps/web/src/lib/wide-events-canary.test.ts),
 * for the one kind of event that names what a failure echoes here: the marker
 * may stay in the error message of an `ipc` event, such as the archive or
 * plugin a handler names when it refuses. ADR 0011 makes `error.message` a
 * sensitive field: the scrubber replaces URLs, the user data folder and the
 * home folder, but text a failure echoes stays, and so does the name of a file
 * once its folder is replaced. Every other field holds none, and so does the
 * message of every other kind of event.
 */
const MARKER_ALLOWED_IN: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["ipc", new Set(["error.message"])],
]);

/** Where `value` holds the marker, as `path = "text"`, in a key or a value. */
function markedPlaces(
  value: unknown,
  at = "",
): { path: string; inKey: boolean; shown: string }[] {
  if (typeof value === "string") {
    return MARKED.test(value)
      ? [{ path: at, inKey: false, shown: `${at} = ${JSON.stringify(value)}` }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      markedPlaces(item, `${at}[${index}]`),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = at ? `${at}.${key}` : key;
      return [
        ...(MARKED.test(key)
          ? [{ path: childPath, inKey: true, shown: `the key ${childPath}` }]
          : []),
        ...markedPlaces(child, childPath),
      ];
    });
  }
  return [];
}

/** Each place an event holds the marker that ADR 0011 does not allow. */
function leaksIn(events: readonly unknown[]) {
  return events.flatMap((event) =>
    markedPlaces(event)
      .filter(
        (place) =>
          place.inKey ||
          !MARKER_ALLOWED_IN.get((event as { kind?: string }).kind ?? "")?.has(
            place.path,
          ),
      )
      .map((place) => `${(event as { name: string }).name}: ${place.shown}`),
  );
}

/** Every key and string in `value`. */
function textsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [
      key,
      ...textsIn(child),
    ]);
  }
  return [];
}

/** The folders the recording emitter scrubs, as the fixtures spell them. */
const HOME = "C:\\Users\\alex";
const USER_DATA = "C:\\Users\\alex\\AppData\\Roaming\\Ajour";

/** A path with one separator and one case, to find it as the scrubber does. */
const comparable = (text: string) => text.replace(/[\\/]+/g, "/").toLowerCase();

/** What no event holds, an error's message included: any URL, the home or user data folder. */
function survivorsIn(events: readonly unknown[]) {
  return events.flatMap((event) =>
    textsIn(event).flatMap((text) =>
      [
        /[a-z][a-z0-9+.-]*:\/\//i.test(text) && "a URL",
        comparable(text).includes(comparable(HOME)) && "the home folder",
        comparable(text).includes(comparable(USER_DATA)) &&
          "the user data folder",
      ]
        .filter((what): what is string => typeof what === "string")
        .map(
          (what) =>
            `${(event as { name: string }).name} holds ${what}: ${JSON.stringify(text)}`,
        ),
    ),
  );
}

/** Fails on a marker where ADR 0011 allows none, and on a URL or folder anywhere. */
function expectNoLeak(events: readonly unknown[]) {
  expect(leaksIn(events)).toEqual([]);
  expect(survivorsIn(events)).toEqual([]);
}

describe("plugin and update IPC: the privacy canary", () => {
  const archivePath = `${HOME}\\Downloads\\${MARKER}.ajour-connector`;
  const archive = {
    archiveBytes: new Uint8Array(15),
    archiveFilename: `${MARKER}.ajour-connector`,
  };
  const releaseUrl = `https://github.com/les-cabochons/ajour/releases/tag/${MARKER}`;

  /** The plugin and update handlers of main.cjs, with the parts that touch the system replaced. */
  function pluginRuntime({
    packaged = true,
    ...overrides
  }: { packaged?: boolean } & Record<string, unknown> = {}) {
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const { events, recorded } = recordingEvents();
    const api = {
      installPluginForServer: vi.fn(async (..._args: unknown[]) => ({
        plugin: { id: "azure_devops", version: "1.2.3" },
        replaced: false,
      })),
      uninstallPluginForServer: vi.fn(async (..._args: unknown[]) => ({})),
    };
    const context = vm.createContext({
      events,
      refusedSender,
      isAllowedReleaseUrl: require("./electron/update-check.cjs")
        .isAllowedReleaseUrl,
      pluginInstallResultOf: require("./electron/plugin-install.cjs")
        .pluginInstallResultOf,
      // The real picker, over a dialog that picks a file that isn't there.
      selectPluginArchive: require("./electron/plugin-install.cjs")
        .selectPluginArchive,
      dialog: { showOpenDialog: async () => ({ filePaths: [archivePath] }) },
      app: { isPackaged: packaged },
      mainWindow: { webContents: "active-window" },
      shell: { openExternal: vi.fn(async () => undefined) },
      ensureInternalAppApiRunning: async () => undefined,
      internalAppApiServer: {},
      internalAppApiModulePromise: Promise.resolve(api),
      pluginCatalogService: { downloadPluginArchive: async () => archive },
      selectDevelopmentPluginDirectory: async () =>
        `${HOME}\\${MARKER}\\plugins`,
      applyDevelopmentPluginDirectories: async () => undefined,
      resolveDevelopmentPluginDirectories: () => [],
      getDevelopmentPluginSettings: () => ({ directories: [] }),
      ipc: createIpcListeners(
        {
          handle: (
            name: string,
            handler: (...args: unknown[]) => Promise<unknown>,
          ) => void handlers.set(name, handler),
        },
        { events },
      ),
      ...overrides,
    });
    run(
      context,
      "function assertActiveDesktopWindow(",
      "function assertDevelopmentBuild(",
      "function pluginIdForEvent(",
      "async function installPluginArchive(",
      'ipc.handle("ajour:open-update-release"',
      'ipc.handle("ajour:install-plugin"',
      'ipc.handle("ajour:download-catalog-plugin"',
      'ipc.handle("ajour:uninstall-plugin"',
      "async function configureDevelopmentPluginDirectories(",
      'ipc.handle("ajour:select-development-plugin-directory"',
    );
    return {
      api,
      context,
      recorded,
      invoke: (channel: string, ...args: unknown[]) =>
        handlers.get(channel)!({ sender: "active-window" }, ...args),
    };
  }

  it("keeps an archive's path and name out of the install's events, and its failure scrubbed", async () => {
    // The picker fails on a file that isn't there, naming its path.
    const missing = pluginRuntime();
    await expect(missing.invoke("ajour:install-plugin")).rejects.toThrow(
      MARKER,
    );
    // The API refuses the archive, naming its file.
    const refused = pluginRuntime({
      selectPluginArchive: async () => archive,
    });
    refused.api.installPluginForServer.mockRejectedValueOnce(
      Object.assign(new Error(`${archive.archiveFilename} has no manifest`), {
        code: "invalid_archive",
      }),
    );
    await expect(refused.invoke("ajour:install-plugin")).rejects.toThrow(
      "no manifest",
    );
    // The install works, for an archive of a marked name.
    const installed = pluginRuntime({
      selectPluginArchive: async () => archive,
    });
    await installed.invoke("ajour:install-plugin");

    const recorded = [
      ...missing.recorded,
      ...refused.recorded,
      ...installed.recorded,
    ];
    expect(recorded.map((event) => event.outcome)).toEqual([
      "error",
      "error",
      "ok",
    ]);
    // What the picker echoes stays, with the home folder replaced.
    expect(recorded[0]!.error!.message).toContain(
      `~\\Downloads\\${MARKER}.ajour-connector`,
    );
    expect(recorded[1]!.error!.message).toBe(
      `${archive.archiveFilename} has no manifest`,
    );
    expectNoLeak(recorded);
  });

  it("keeps a catalog download's plugin ID and URL out of its events", async () => {
    const failing = pluginRuntime({
      pluginCatalogService: {
        downloadPluginArchive: async () => {
          throw new Error(
            `Could not download https://${MARKER}.example.test/${MARKER}.ajour-connector, archive ${MARKER} is not signed`,
          );
        },
      },
    });
    // A plugin ID that is not one: the event names none.
    await expect(
      failing.invoke("ajour:download-catalog-plugin", MARKER),
    ).rejects.toThrow("not signed");
    const downloaded = pluginRuntime();
    await downloaded.invoke("ajour:download-catalog-plugin", MARKER);
    // A real plugin ID stays: it is Ajour's own.
    await expect(
      pluginRuntime().invoke("ajour:download-catalog-plugin", "azure_devops"),
    ).resolves.toBeDefined();

    const recorded = [...failing.recorded, ...downloaded.recorded];
    expect(recorded[0]).toMatchObject({
      outcome: "error",
      plugin: { source: "catalog" },
      error: {
        message: `Could not download [url], archive ${MARKER} is not signed`,
      },
    });
    expect(recorded[0]!.plugin?.id).toBeUndefined();
    expect(recorded[1]).toMatchObject({ outcome: "ok" });
    expectNoLeak(recorded);
  });

  it("keeps an uninstall's plugin ID and the folder its failure names out of its event", async () => {
    const failing = pluginRuntime();
    failing.api.uninstallPluginForServer.mockRejectedValueOnce(
      new Error(
        `Plugin ${MARKER} is not installed at ${USER_DATA}\\plugins\\${MARKER}`,
      ),
    );
    await expect(
      failing.invoke("ajour:uninstall-plugin", MARKER),
    ).rejects.toThrow("not installed");
    const uninstalled = pluginRuntime();
    await uninstalled.invoke("ajour:uninstall-plugin", MARKER);

    const recorded = [...failing.recorded, ...uninstalled.recorded];
    expect(recorded[0]).toMatchObject({
      outcome: "error",
      plugin: { result: "failed" },
      error: {
        message: `Plugin ${MARKER} is not installed at [user data]\\plugins\\${MARKER}`,
      },
    });
    expect(recorded[0]!.plugin?.id).toBeUndefined();
    expect(recorded[1]).toMatchObject({
      outcome: "ok",
      plugin: { result: "uninstalled" },
    });
    expectNoLeak(recorded);
  });

  it("keeps a development plugin folder out of its events, and its failure scrubbed", async () => {
    const applied = pluginRuntime({ packaged: false });
    await applied.invoke("ajour:select-development-plugin-directory");
    const cancelled = pluginRuntime({
      packaged: false,
      selectDevelopmentPluginDirectory: async () => null,
    });
    await cancelled.invoke("ajour:select-development-plugin-directory");
    const rolledBack = pluginRuntime({
      packaged: false,
      applyDevelopmentPluginDirectories: async () => {
        throw new Error(
          `Cannot load plugins from ${HOME}\\${MARKER}\\plugins: ${MARKER} has no plugin.json`,
        );
      },
    });
    await expect(
      rolledBack.invoke("ajour:select-development-plugin-directory"),
    ).rejects.toThrow("plugin.json");

    const recorded = [
      ...applied.recorded,
      ...cancelled.recorded,
      ...rolledBack.recorded,
    ];
    expect(recorded.map((event) => event.dev_plugins?.result)).toEqual([
      "applied",
      "cancelled",
      "rolled_back",
    ]);
    expect(recorded[2]!.error!.message).toBe(
      `Cannot load plugins from ~\\${MARKER}\\plugins: ${MARKER} has no plugin.json`,
    );
    expectNoLeak(recorded);
  });

  it("keeps a release URL out of the open-release events, whether it is allowed, refused or fails", async () => {
    const opened = pluginRuntime();
    await opened.invoke("ajour:open-update-release", releaseUrl);
    const refused = pluginRuntime();
    await expect(
      refused.invoke(
        "ajour:open-update-release",
        `https://${MARKER}.example.test/${MARKER}?token=${MARKER}`,
      ),
    ).rejects.toThrow("not allowed");
    const failing = pluginRuntime({
      shell: {
        openExternal: async () => {
          throw new Error(
            `Could not open ${releaseUrl}: no application handles ${MARKER}`,
          );
        },
      },
    });
    await expect(
      failing.invoke("ajour:open-update-release", releaseUrl),
    ).rejects.toThrow("no application");

    const recorded = [
      ...opened.recorded,
      ...refused.recorded,
      ...failing.recorded,
    ];
    expect(recorded).toMatchObject([
      { outcome: "ok", update: { release_allowed: true } },
      {
        outcome: "refused",
        outcome_reason: "url_not_allowed",
        update: { release_allowed: false },
      },
      {
        outcome: "error",
        update: { release_allowed: true },
        error: {
          message: `Could not open [url]: no application handles ${MARKER}`,
        },
      },
    ]);
    expectNoLeak(recorded);
  });

  it("holds the rule itself: the marker only in an error's message, and no URL or folder anywhere", () => {
    const event = (fields: Record<string, unknown>) => ({
      name: "plugin.install",
      kind: "ipc",
      ...fields,
    });
    expect(
      leaksIn([
        event({ error: { type: "Error", message: `Plugin ${MARKER}` } }),
      ]),
    ).toEqual([]);
    for (const kind of ["lifecycle", "navigation", "crash", "command"]) {
      expect(
        leaksIn([
          event({
            kind,
            error: { type: "Error", message: `Plugin ${MARKER}` },
          }),
        ]),
        kind,
      ).not.toEqual([]);
    }
    for (const fields of [
      { error: { type: MARKER, message: "x" } },
      { error: { message: "x", code: MARKER } },
      { plugin: { id: MARKER } },
      { [MARKER]: 1 },
    ]) {
      expect(leaksIn([event(fields)]), JSON.stringify(fields)).not.toEqual([]);
    }
    for (const message of [
      `at https://${MARKER}.example.test/x`,
      `open ${HOME}\\Downloads\\a.ajour-connector`,
      `open ${HOME.replace(/\\/g, "/")}/Downloads/a`,
      `open ${USER_DATA}\\plugins`,
      `open ${JSON.stringify(HOME).slice(1, -1)}`,
    ]) {
      expect(survivorsIn([event({ error: { message } })]), message).not.toEqual(
        [],
      );
    }
  });
});
