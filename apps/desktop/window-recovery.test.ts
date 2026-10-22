import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { recordingEvents } from "./recording-events.ts";

const require = createRequire(import.meta.url);
const { watchWindow } = require("./electron/window-recovery.cjs") as {
  watchWindow: (
    window: FakeWindow,
    options: {
      url: string;
      dialog: { showMessageBox: FakeDialog["showMessageBox"] };
      quit: () => void;
      events: unknown;
      now?: () => number;
    },
  ) => { load: (trigger?: string) => Promise<string> };
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
  const { events, recorded } = recordingEvents({ now: () => time });
  const recovery = watchWindow(window, {
    url: APP_URL,
    dialog,
    quit,
    events,
    now: () => time,
  });
  return {
    window,
    dialog,
    quit,
    recovery,
    events: recorded,
    fixture: events,
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

    await expect(recovery.load()).resolves.toBe("error");
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

describe("window recovery events", () => {
  it("records a load with its trigger and duration", async () => {
    const { window, recovery, events, at } = setUp();
    window.loadURL.mockImplementation(async () => {
      at(120);
    });

    await recovery.load("launch");

    expect(events).toMatchObject([
      {
        name: "window.load",
        kind: "lifecycle",
        outcome: "ok",
        trigger: "boot",
        window: { trigger: "launch", load_ms: 120 },
      },
    ]);
  });

  it("keeps a failed load open until the answer, with Electron's code", async () => {
    const { window, dialog, recovery, events } = setUp();
    window.loadURL.mockRejectedValueOnce(
      loadError("ERR_FILE_NOT_FOUND", "(-6) loading 'app://local/'"),
    );

    await recovery.load("launch");
    await flush();
    expect(events).toEqual([]);
    await dialog.choose("Try again");

    expect(events).toMatchObject([
      {
        name: "window.load",
        outcome: "error",
        error: { code: "ERR_FILE_NOT_FOUND" },
        window: { trigger: "launch", answer: "try_again" },
      },
      { name: "window.load", outcome: "ok", window: { trigger: "retry" } },
    ]);
    expect(JSON.stringify(events)).not.toContain("app://local");
  });

  it("records an aborted load as cancelled", async () => {
    const { window, recovery, events } = setUp();
    window.loadURL.mockRejectedValueOnce(
      loadError("ERR_ABORTED", "(-3) loading 'app://local/'"),
    );

    await recovery.load();

    expect(events).toMatchObject([
      { name: "window.load", outcome: "cancelled", outcome_reason: "aborted" },
    ]);
  });

  it("records a crash and the reload it led to", async () => {
    const { window, recovery, events } = setUp();
    await recovery.load("launch");

    window.webContents.emit(
      "render-process-gone",
      {},
      { reason: "oom", exitCode: -536870904 },
    );
    await flush();

    expect(events.slice(1)).toMatchObject([
      {
        name: "process.gone",
        kind: "crash",
        outcome: "error",
        process: { type: "renderer", reason: "oom", exit_code: -536870904 },
        recovery: { action: "reloaded" },
      },
      { name: "window.load", window: { trigger: "crash_reload" } },
    ]);
  });

  it("records the third crash with the answer to the dialog", async () => {
    const { window, dialog, recovery, events } = setUp();
    await recovery.load();
    crash(window);
    crash(window);
    crash(window);
    await flush();

    await dialog.choose("Quit");

    expect(
      events.filter((event) => event.name === "process.gone").at(-1),
    ).toMatchObject({ recovery: { action: "cap_reached", answer: "quit" } });
  });

  it("records a hung window until it responds again", async () => {
    const { window, recovery, events, at } = setUp();
    await recovery.load();

    at(1_000);
    window.webContents.emit("unresponsive");
    await flush();
    at(4_000);
    window.webContents.emit("responsive");
    await flush();

    expect(events.slice(1)).toMatchObject([
      {
        name: "window.unresponsive",
        kind: "crash",
        outcome: "ok",
        duration_ms: 3_000,
        unresponsive: { answer: "replaced", recovered: true },
      },
    ]);
  });

  it("records Reload from the not-responding dialog, and its kill as on purpose", async () => {
    const { window, dialog, recovery, events } = setUp();
    await recovery.load();

    window.webContents.emit("unresponsive");
    await flush();
    await dialog.choose("Reload");
    await flush();

    expect(events.slice(1)).toMatchObject([
      {
        name: "window.unresponsive",
        outcome: "error",
        unresponsive: { answer: "reload", recovered: false },
      },
      {
        name: "process.gone",
        outcome: "ok",
        recovery: { action: "killed_on_purpose" },
      },
      { name: "window.load", window: { trigger: "crash_reload" } },
    ]);
  });

  it("resolves each load's outcome, so the launch can end with it", async () => {
    const { window, recovery } = setUp();
    window.loadURL
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(loadError("ERR_FAILED", "(-2) loading"))
      .mockRejectedValueOnce(loadError("ERR_ABORTED", "(-3) loading"));

    const outcomes = [
      await recovery.load("launch"),
      await recovery.load("launch"),
      await recovery.load("launch"),
    ];

    expect(outcomes).toEqual(["ok", "error", "cancelled"]);
  });

  it("keeps the answer of a hang dialog that a crash replaced", async () => {
    const { window, recovery, events } = setUp();
    await recovery.load();

    window.webContents.emit("unresponsive");
    await flush();
    crash(window);
    await flush();

    expect(events.find((e) => e.name === "window.unresponsive")).toMatchObject({
      outcome: "error",
      unresponsive: { answer: "replaced", recovered: false },
    });
  });

  it("emits a crash as its own event even while another unit is active", async () => {
    const { window, recovery, events, fixture } = setUp();
    await recovery.load();

    fixture.run("menu.run_item", { kind: "ipc", trigger: "user" }, () => {
      crash(window);
    });
    await flush();

    expect(events.map((e) => e.name)).toEqual(
      expect.arrayContaining(["process.gone", "menu.run_item"]),
    );
  });
});
