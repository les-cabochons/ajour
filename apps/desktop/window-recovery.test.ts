import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { watchWindow } = require("./electron/window-recovery.cjs") as {
  watchWindow: (
    window: FakeWindow,
    options: {
      url: string;
      dialog: { showMessageBox: FakeDialog["showMessageBox"] };
      quit: () => void;
      now?: () => number;
    },
  ) => { load: () => Promise<void> };
};

const APP_URL = "app://local/";

interface MessageBoxOptions {
  type?: string;
  message: string;
  detail?: string;
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
  signal?: AbortSignal;
}

interface FakeDialog {
  showMessageBox: (
    window: unknown,
    options: MessageBoxOptions,
  ) => Promise<{ response: number }>;
  /** Every message box shown, in order. */
  shown: MessageBoxOptions[];
  /**
   * Answers a message box, the latest unless `which` gives its index, with the
   * button labelled `label`.
   */
  choose: (label: string, which?: number) => Promise<void>;
}

type FakeWindow = ReturnType<typeof fakeWindow>;

function fakeWindow() {
  const webContents = Object.assign(new EventEmitter(), {
    // As in Electron, the killed renderer reports itself gone afterwards.
    forcefullyCrashRenderer: vi.fn(() => {
      queueMicrotask(() =>
        webContents.emit(
          "render-process-gone",
          {},
          { reason: "killed", exitCode: 1 },
        ),
      );
    }),
  });
  let destroyed = false;
  return {
    webContents,
    loadURL: vi.fn(async (_url: string) => {}),
    isDestroyed: () => destroyed,
    destroy() {
      destroyed = true;
    },
  };
}

/**
 * As in Electron, an aborted message box answers its cancel button, unless
 * `closesOnAbort` is false, which stands for a box the system could not close.
 */
function fakeDialog({ closesOnAbort = true } = {}): FakeDialog {
  const shown: MessageBoxOptions[] = [];
  const pending: Array<(response: number) => void> = [];
  return {
    shown,
    showMessageBox: vi.fn((_window, options: MessageBoxOptions) => {
      shown.push(options);
      return new Promise<{ response: number }>((resolve) => {
        const answer = (response: number) => resolve({ response });
        pending.push(answer);
        if (closesOnAbort) {
          options.signal?.addEventListener("abort", () =>
            answer(options.cancelId ?? 0),
          );
        }
      });
    }),
    async choose(label, which = shown.length - 1) {
      const options = shown[which];
      const answer = pending[which];
      if (!options || !answer) throw new Error("No message box is open.");
      const response = options.buttons.indexOf(label);
      if (response < 0) throw new Error(`No "${label}" button.`);
      answer(response);
      await flush();
    },
  };
}

/** Lets pending tasks and promise callbacks run. */
async function flush() {
  for (let index = 0; index < 3; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The error Electron's `loadURL` rejects with. */
function loadError(code: string, rest: string) {
  return Object.assign(new Error(`${code} ${rest}`), { code });
}

function crash(window: FakeWindow, reason = "crashed") {
  window.webContents.emit("render-process-gone", {}, { reason, exitCode: 1 });
}

function setUp({ closesOnAbort = true } = {}) {
  const window = fakeWindow();
  const dialog = fakeDialog({ closesOnAbort });
  const quit = vi.fn();
  let time = 0;
  const recovery = watchWindow(window, {
    url: APP_URL,
    dialog,
    quit,
    now: () => time,
  });
  return {
    window,
    dialog,
    quit,
    recovery,
    at(ms: number) {
      time = ms;
    },
  };
}

describe("window recovery", () => {
  it("loads the app into the window", async () => {
    const { window, recovery } = setUp();

    await recovery.load();

    expect(window.loadURL).toHaveBeenCalledWith(APP_URL);
  });

  it("loads the app again when the page crashes", async () => {
    const { window, dialog, recovery } = setUp();
    await recovery.load();

    crash(window);
    await flush();

    expect(window.loadURL).toHaveBeenCalledTimes(2);
    expect(dialog.shown).toEqual([]);
  });

  // Navigating inside the crash event fails a Chromium check that ends the
  // main process, as the real app showed with exit code 0x80000003.
  it("loads the app again only after the crash event has returned", async () => {
    const { window, recovery } = setUp();
    await recovery.load();

    crash(window);
    await Promise.resolve();
    expect(window.loadURL).toHaveBeenCalledOnce();

    await flush();
    expect(window.loadURL).toHaveBeenCalledTimes(2);
  });

  it("waits for the crash event to return even when Reload is answered at once", async () => {
    const { window, dialog, recovery } = setUp();
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0 });
    await recovery.load();

    crash(window);
    crash(window);
    crash(window);
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(window.loadURL).toHaveBeenCalledOnce();

    await flush();
    expect(window.loadURL).toHaveBeenCalledTimes(4);
  });

  it("stops reloading at the third crash within a minute and asks instead", async () => {
    const { window, dialog, recovery, at } = setUp();
    await recovery.load();

    at(0);
    crash(window);
    at(20_000);
    crash(window, "oom");
    at(40_000);
    crash(window, "killed");
    await flush();

    expect(window.loadURL).toHaveBeenCalledTimes(3);
    expect(dialog.shown).toHaveLength(1);
    expect(dialog.shown[0]).toMatchObject({
      message: "Ajour keeps crashing",
      detail:
        "The window crashed 3 times within 60 seconds, so Ajour stopped reloading it.",
      buttons: ["Reload", "Quit"],
    });
  });

  it("keeps reloading crashes spread over more than a minute", async () => {
    const { window, dialog, recovery, at } = setUp();
    await recovery.load();

    at(0);
    crash(window);
    at(30_000);
    crash(window);
    at(61_000);
    crash(window);
    await flush();

    expect(window.loadURL).toHaveBeenCalledTimes(4);
    expect(dialog.shown).toEqual([]);
  });

  it("reloads with a fresh allowance when the user chooses Reload", async () => {
    const { window, dialog, quit, recovery } = setUp();
    await recovery.load();
    crash(window);
    crash(window);
    crash(window);
    await flush();

    await dialog.choose("Reload");
    crash(window);
    await flush();

    expect(window.loadURL).toHaveBeenCalledTimes(5);
    expect(dialog.shown).toHaveLength(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it("quits when the user chooses Quit", async () => {
    const { window, dialog, quit, recovery } = setUp();
    await recovery.load();
    crash(window);
    crash(window);
    crash(window);
    await flush();

    await dialog.choose("Quit");

    expect(quit).toHaveBeenCalledOnce();
    expect(window.loadURL).toHaveBeenCalledTimes(3);
  });

  it("asks to try again when the app cannot load, without rejecting", async () => {
    const { window, dialog, recovery } = setUp();
    window.loadURL.mockRejectedValueOnce(
      loadError("ERR_FILE_NOT_FOUND", "(-6) loading 'app://local/'"),
    );

    await expect(recovery.load()).resolves.toBeUndefined();
    await flush();
    expect(dialog.shown).toHaveLength(1);
    expect(dialog.shown[0]).toMatchObject({
      message: "Ajour could not load its window",
      detail: "ERR_FILE_NOT_FOUND (-6) loading 'app://local/'",
      buttons: ["Try again", "Quit"],
    });

    await dialog.choose("Try again");
    expect(window.loadURL).toHaveBeenCalledTimes(2);
  });

  it("quits from the failed load dialog", async () => {
    const { window, dialog, quit, recovery } = setUp();
    window.loadURL.mockRejectedValueOnce(
      loadError("ERR_CONNECTION_REFUSED", "(-102) loading 'app://local/'"),
    );

    await recovery.load();
    await flush();
    await dialog.choose("Quit");

    expect(quit).toHaveBeenCalledOnce();
  });

  it("quits rather than leave a blank window when it cannot ask", async () => {
    const { window, dialog, quit, recovery } = setUp();
    vi.mocked(dialog.showMessageBox).mockRejectedValue(
      new Error("dialog unavailable"),
    );
    await recovery.load();

    crash(window);
    crash(window);
    crash(window);
    window.webContents.emit("unresponsive");
    await flush();

    expect(quit).toHaveBeenCalledOnce();
  });

  it("closes a failed-load dialog when the page crashes, and ignores its answer", async () => {
    const { window, dialog, quit, recovery } = setUp();
    window.loadURL.mockRejectedValueOnce(
      loadError("ERR_FAILED", "(-2) loading 'app://local/'"),
    );
    await recovery.load();
    await flush();

    crash(window);
    await flush();

    expect(dialog.shown[0]?.signal?.aborted).toBe(true);
    expect(quit).not.toHaveBeenCalled();
    expect(window.loadURL).toHaveBeenCalledTimes(2);
  });

  it.each(["Try again", "Quit"])(
    "ignores %s from a failed-load dialog that a crash made outdated",
    async (label) => {
      const { window, dialog, quit, recovery } = setUp({
        closesOnAbort: false,
      });
      window.loadURL.mockRejectedValueOnce(
        loadError("ERR_FAILED", "(-2) loading 'app://local/'"),
      );
      await recovery.load();
      await flush();
      crash(window);
      await flush();

      await dialog.choose(label, 0);

      // The first load and the crash's reload, nothing more.
      expect(window.loadURL).toHaveBeenCalledTimes(2);
      expect(quit).not.toHaveBeenCalled();
    },
  );

  it("replaces an open not-responding dialog with a failed-load one", async () => {
    const { window, dialog, recovery } = setUp({ closesOnAbort: false });
    await recovery.load();
    window.webContents.emit("unresponsive");
    await flush();
    window.loadURL.mockRejectedValueOnce(
      loadError("ERR_FAILED", "(-2) loading 'app://local/'"),
    );

    await recovery.load();
    await flush();
    await dialog.choose("Reload", 0);

    expect(dialog.shown[0]?.signal?.aborted).toBe(true);
    expect(dialog.shown[1]?.message).toBe("Ajour could not load its window");
    expect(window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled();
  });

  it("stays quiet when a newer navigation aborts the load", async () => {
    const { window, dialog, recovery } = setUp();
    window.loadURL.mockRejectedValueOnce(
      loadError("ERR_ABORTED", "(-3) loading 'app://local/'"),
    );

    await recovery.load();
    await flush();

    expect(dialog.shown).toEqual([]);
  });

  it("stays quiet when the window closes while loading", async () => {
    const { window, dialog, recovery } = setUp();
    window.loadURL.mockImplementationOnce(async () => {
      window.destroy();
      throw loadError("ERR_FAILED", "(-2) loading 'app://local/'");
    });

    await recovery.load();
    await flush();

    expect(dialog.shown).toEqual([]);
  });

  it("reports only the latest load's failure", async () => {
    const { window, dialog, recovery } = setUp();
    let failFirstLoad = (_error: Error) => {};
    window.loadURL.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failFirstLoad = reject;
        }),
    );
    const firstLoad = recovery.load();

    crash(window);
    failFirstLoad(loadError("ERR_FAILED", "(-2) loading 'app://local/'"));
    await firstLoad;
    await flush();

    expect(window.loadURL).toHaveBeenCalledTimes(2);
    expect(dialog.shown).toEqual([]);
  });

  it("offers to reload a page that stops responding, through a fresh renderer", async () => {
    const { window, dialog, recovery } = setUp();
    await recovery.load();

    window.webContents.emit("unresponsive");
    await flush();
    expect(dialog.shown).toHaveLength(1);
    expect(dialog.shown[0]).toMatchObject({
      message: "Ajour is not responding",
      buttons: ["Wait", "Reload"],
    });

    await dialog.choose("Reload");
    await flush();
    expect(window.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce();
    expect(window.loadURL).toHaveBeenCalledTimes(2);
  });

  it("does not count a Reload from the not-responding dialog as a crash", async () => {
    const { window, dialog, recovery } = setUp();
    await recovery.load();
    crash(window);
    crash(window);
    await flush();

    window.webContents.emit("unresponsive");
    await flush();
    await dialog.choose("Reload");
    await flush();
    expect(window.loadURL).toHaveBeenCalledTimes(4);
    expect(dialog.shown).toHaveLength(1);

    crash(window);
    await flush();
    expect(dialog.shown.at(-1)?.message).toBe("Ajour keeps crashing");
  });

  it("leaves the page alone when the user chooses Wait", async () => {
    const { window, dialog, recovery } = setUp();
    await recovery.load();

    window.webContents.emit("unresponsive");
    await flush();
    await dialog.choose("Wait");

    expect(window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled();
    expect(window.loadURL).toHaveBeenCalledOnce();
  });

  it("asks once while the page stays unresponsive", async () => {
    const { window, dialog, recovery } = setUp();
    await recovery.load();

    window.webContents.emit("unresponsive");
    window.webContents.emit("unresponsive");
    await flush();

    expect(dialog.shown).toHaveLength(1);
  });

  it("closes the question when the page responds again", async () => {
    const { window, dialog, recovery } = setUp();
    await recovery.load();

    window.webContents.emit("unresponsive");
    await flush();
    window.webContents.emit("responsive");
    await flush();

    expect(dialog.shown[0]?.signal?.aborted).toBe(true);
    expect(window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled();
  });

  it("closes the question when the page crashes, and reloads it", async () => {
    const { window, dialog, recovery } = setUp();
    await recovery.load();

    window.webContents.emit("unresponsive");
    await flush();
    crash(window);
    await flush();

    expect(dialog.shown[0]?.signal?.aborted).toBe(true);
    expect(window.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled();
    expect(window.loadURL).toHaveBeenCalledTimes(2);
  });

  it("ignores a crash once the window is closed", async () => {
    const { window, dialog, recovery } = setUp();
    await recovery.load();

    window.destroy();
    crash(window);
    await flush();

    expect(window.loadURL).toHaveBeenCalledOnce();
    expect(dialog.shown).toEqual([]);
  });
});
