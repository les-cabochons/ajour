import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

interface TrayEntry {
  timerId: string;
  title: string;
  startedAt: number;
  accumulatedMs: number;
}

type TrayMenuItem =
  | { type: "separator" }
  | { id: "open" | "entry" | "stop" | "quit"; label: string; enabled: boolean };

interface FakeTray {
  tooltip: string | undefined;
  template: {
    label?: string;
    type?: string;
    enabled?: boolean;
    click?: () => void;
  }[];
  destroyed: boolean;
  listeners: Map<string, () => void>;
}

const {
  DEFAULT_WINDOW_SETTINGS,
  closeActionOf,
  createTrayController,
  firstCloseNotice,
  formatCountedTime,
  loadWindowSettings,
  msUntilCountedTimeChanges,
  normalizeTrayState,
  saveWindowSettings,
  trayMenuModel,
} = require("./electron/keep-running.cjs") as {
  DEFAULT_WINDOW_SETTINGS: {
    keep_running: boolean;
    close_notice_shown: boolean;
  };
  closeActionOf: (options: {
    quitting: boolean;
    keepRunning: boolean;
  }) => "hide" | "close";
  createTrayController: (options: {
    platform: string;
    now: () => number;
    createTray: () => unknown;
    buildMenu: (template: unknown[]) => unknown;
    onAction: (action: string, entry: TrayEntry | null) => void;
  }) => {
    show: () => void;
    remove: () => void;
    setState: (state: unknown) => void;
    entry: () => TrayEntry | null;
  };
  firstCloseNotice: (platform: string) => string;
  formatCountedTime: (ms: number) => string;
  loadWindowSettings: (file: string) => {
    keep_running: boolean;
    close_notice_shown: boolean;
  };
  msUntilCountedTimeChanges: (countedMs: number) => number;
  normalizeTrayState: (value: unknown) => { entry: TrayEntry | null };
  saveWindowSettings: (
    file: string,
    value: unknown,
  ) => { keep_running: boolean; close_notice_shown: boolean };
  trayMenuModel: (options: {
    entry: TrayEntry | null;
    now: number;
    platform: string;
  }) => { tooltip: string; items: TrayMenuItem[] };
};

const MINUTE = 60_000;

function entry(overrides: Partial<TrayEntry> = {}): TrayEntry {
  return {
    timerId: "timer-1",
    title: "Fix export rounding",
    startedAt: 0,
    accumulatedMs: 0,
    ...overrides,
  };
}

describe("window settings", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "ajour-window-settings-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps Ajour running by default, before any notice has shown", () => {
    expect(DEFAULT_WINDOW_SETTINGS).toEqual({
      keep_running: true,
      close_notice_shown: false,
    });
    expect(loadWindowSettings(path.join(directory, "missing.json"))).toEqual(
      DEFAULT_WINDOW_SETTINGS,
    );
  });

  it("falls back to the defaults for a file it cannot read", () => {
    const file = path.join(directory, "window-settings.json");
    writeFileSync(file, "{ not json");

    expect(loadWindowSettings(file)).toEqual(DEFAULT_WINDOW_SETTINGS);
  });

  it("keeps a saved choice, and a stray value takes its default", () => {
    const file = path.join(directory, "nested", "window-settings.json");
    saveWindowSettings(file, { keep_running: false, close_notice_shown: true });

    expect(loadWindowSettings(file)).toEqual({
      keep_running: false,
      close_notice_shown: true,
    });

    writeFileSync(
      file,
      JSON.stringify({ keep_running: "no", close_notice_shown: 1 }),
    );
    expect(loadWindowSettings(file)).toEqual(DEFAULT_WINDOW_SETTINGS);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      keep_running: "no",
      close_notice_shown: 1,
    });
  });
});

describe("closing the window", () => {
  it("hides the window while Ajour keeps running", () => {
    expect(closeActionOf({ quitting: false, keepRunning: true })).toBe("hide");
  });

  it("closes the window when the setting is off", () => {
    expect(closeActionOf({ quitting: false, keepRunning: false })).toBe(
      "close",
    );
  });

  // Quit, an update install and a system shutdown close the window for good.
  it("closes the window while Ajour quits", () => {
    expect(closeActionOf({ quitting: true, keepRunning: true })).toBe("close");
  });

  it("says where to quit from on the first close", () => {
    expect(firstCloseNotice("win32")).toBe(
      "Ajour is still running. Quit it from the tray icon.",
    );
    expect(firstCloseNotice("linux")).toBe(
      "Ajour is still running. Quit it from the tray icon.",
    );
    expect(firstCloseNotice("darwin")).toBe(
      "Ajour is still running. Quit it from the menu bar.",
    );
  });
});

describe("counted time", () => {
  it("shows hours and minutes, rounded to the minute like the window title", () => {
    expect(formatCountedTime(0)).toBe("0:00");
    expect(formatCountedTime(29_999)).toBe("0:00");
    expect(formatCountedTime(30_000)).toBe("0:01");
    expect(formatCountedTime(84 * MINUTE)).toBe("1:24");
    expect(formatCountedTime(-5_000)).toBe("0:00");
  });

  it("waits until the shown minute changes", () => {
    expect(msUntilCountedTimeChanges(0)).toBe(30_000);
    expect(msUntilCountedTimeChanges(30_000)).toBe(MINUTE);
    expect(msUntilCountedTimeChanges(85_000)).toBe(5_000);
  });
});

describe("tray state from the window", () => {
  it("keeps a running entry's title and times", () => {
    expect(
      normalizeTrayState({
        entry: { ...entry({ startedAt: 1_000, accumulatedMs: 5_000 }), x: 1 },
      }),
    ).toEqual({ entry: entry({ startedAt: 1_000, accumulatedMs: 5_000 }) });
  });

  it("reads anything else as nothing running", () => {
    for (const value of [
      undefined,
      null,
      "running",
      { entry: null },
      { entry: { ...entry(), title: "   " } },
      { entry: { ...entry(), startedAt: Number.NaN } },
      { entry: { ...entry(), accumulatedMs: -1 } },
      { entry: { ...entry(), timerId: 7 } },
    ]) {
      expect(normalizeTrayState(value)).toEqual({ entry: null });
    }
  });

  it("caps a very long title", () => {
    const title = "x".repeat(5_000);
    expect(
      normalizeTrayState({ entry: entry({ title }) }).entry?.title,
    ).toHaveLength(500);
  });
});

describe("tray menu", () => {
  it("shows the running entry in the tooltip and offers Stop", () => {
    const model = trayMenuModel({
      entry: entry({ startedAt: 0, accumulatedMs: 60 * MINUTE }),
      now: 24 * MINUTE,
      platform: "win32",
    });

    expect(model.tooltip).toBe("● 1:24 Fix export rounding");
    expect(model.items).toEqual([
      { id: "open", label: "Open Ajour", enabled: true },
      { type: "separator" },
      { id: "entry", label: "Fix export rounding", enabled: false },
      { id: "stop", label: "Stop", enabled: true },
      { type: "separator" },
      { id: "quit", label: "Quit", enabled: true },
    ]);
  });

  it("says Ajour and disables Stop when nothing runs", () => {
    const model = trayMenuModel({ entry: null, now: 0, platform: "win32" });

    expect(model.tooltip).toBe("Ajour");
    expect(model.items).toEqual([
      { id: "open", label: "Open Ajour", enabled: true },
      { type: "separator" },
      { id: "entry", label: "Nothing running", enabled: false },
      { id: "stop", label: "Stop", enabled: false },
      { type: "separator" },
      { id: "quit", label: "Quit", enabled: true },
    ]);
  });

  // Windows and Linux read "&" as an access key, and a single one vanishes.
  it("keeps an ampersand in the title on Windows and Linux", () => {
    const title = "Q&A review";
    for (const platform of ["win32", "linux"]) {
      const model = trayMenuModel({
        entry: entry({ title }),
        now: 0,
        platform,
      });
      expect(model.items[2]).toMatchObject({ label: "Q&&A review" });
      expect(model.tooltip).toBe("● 0:00 Q&A review");
    }
    expect(
      trayMenuModel({ entry: entry({ title }), now: 0, platform: "darwin" })
        .items[2],
    ).toMatchObject({ label: "Q&A review" });
  });

  // Windows cuts a tooltip at 127 characters, and a long menu item is too wide.
  it("shortens a long title", () => {
    const model = trayMenuModel({
      entry: entry({ title: "word ".repeat(60).trim() }),
      now: 0,
      platform: "win32",
    });

    expect(model.tooltip.length).toBeLessThanOrEqual(127);
    expect(model.tooltip.endsWith("…")).toBe(true);
    const label = (model.items[2] as { label: string }).label;
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("tray controller", () => {
  let time: number;
  let trays: FakeTray[];
  let actions: [string, TrayEntry | null][];

  beforeEach(() => {
    vi.useFakeTimers();
    time = 0;
    trays = [];
    actions = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setUp(platform = "win32") {
    const controller = createTrayController({
      platform,
      now: () => time,
      createTray: () => {
        const tray: FakeTray = {
          tooltip: undefined,
          template: [],
          destroyed: false,
          listeners: new Map(),
        };
        trays.push(tray);
        return {
          setToolTip: (text: string) => {
            tray.tooltip = text;
          },
          setContextMenu: (menu: FakeTray["template"]) => {
            tray.template = menu;
          },
          on: (name: string, listener: () => void) =>
            tray.listeners.set(name, listener),
          destroy: () => {
            tray.destroyed = true;
          },
        };
      },
      buildMenu: (template) => template,
      onAction: (action, current) => actions.push([action, current]),
    });
    return controller;
  }

  async function advance(ms: number) {
    time += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  function click(tray: FakeTray, label: string) {
    tray.template.find((item) => item.label === label)?.click?.();
  }

  it("shows one tray icon, and removes it", () => {
    const controller = setUp();

    controller.show();
    controller.show();
    expect(trays).toHaveLength(1);
    expect(trays[0]!.tooltip).toBe("Ajour");

    controller.remove();
    expect(trays[0]!.destroyed).toBe(true);
  });

  it("follows the running entry once a minute", async () => {
    const controller = setUp();
    controller.show();

    controller.setState({ entry: entry({ startedAt: 0 }) });
    expect(trays[0]!.tooltip).toBe("● 0:00 Fix export rounding");

    // A little after the minute turns, so a timer never fires early.
    await advance(30_100);
    expect(trays[0]!.tooltip).toBe("● 0:01 Fix export rounding");
    await advance(59_000);
    expect(trays[0]!.tooltip).toBe("● 0:01 Fix export rounding");
    await advance(1_500);
    expect(trays[0]!.tooltip).toBe("● 0:02 Fix export rounding");

    controller.setState({ entry: null });
    expect(trays[0]!.tooltip).toBe("Ajour");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the state while hidden and shows it with the icon", () => {
    const controller = setUp();

    controller.setState({ entry: entry() });
    expect(trays).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    controller.show();
    expect(trays[0]!.tooltip).toBe("● 0:00 Fix export rounding");
  });

  it("runs Open Ajour, Stop with the shown entry, and Quit", () => {
    const controller = setUp();
    controller.show();
    controller.setState({ entry: entry() });

    click(trays[0]!, "Open Ajour");
    click(trays[0]!, "Stop");
    click(trays[0]!, "Quit");

    expect(actions).toEqual([
      ["open", entry()],
      ["stop", entry()],
      ["quit", entry()],
    ]);
  });

  it("opens Ajour from a click on the icon on Windows", () => {
    const controller = setUp("win32");
    controller.show();

    trays[0]!.listeners.get("click")?.();

    expect(actions).toEqual([["open", null]]);
  });

  // The macOS menu bar item opens its menu on a click.
  it("leaves a click to the menu on macOS", () => {
    const controller = setUp("darwin");
    controller.show();

    expect(trays[0]!.listeners.has("click")).toBe(false);
  });
});
