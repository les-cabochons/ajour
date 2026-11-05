import { describe, expect, it, vi } from "vitest";
import { createTrayPanelController } from "./electron/tray-panel.cjs";
import { createTrayController } from "./electron/keep-running.cjs";

function setup(platform = "win32") {
  let time = 1000;
  const listeners = new Map<string, () => void>();
  let visible = false;
  const window = {
    isDestroyed: () => false,
    isVisible: () => visible,
    setBounds: vi.fn(),
    show: () => {
      visible = true;
    },
    hide: () => {
      visible = false;
    },
    focus: vi.fn(),
    destroy: vi.fn(),
    on: (name: string, callback: () => void) => listeners.set(name, callback),
  };
  const request = vi.fn();
  const visibility = vi.fn();
  const controller = createTrayPanelController({
    now: () => time,
    platform,
    getBounds: () => ({ x: 970, y: 760, width: 20, height: 20 }),
    getWorkArea: () => ({ x: 0, y: 0, width: 1000, height: 780 }),
    request,
    visibility,
  });
  return {
    controller,
    window,
    listeners,
    request,
    visibility,
    advance: () => {
      time += 200;
    },
  };
}

describe("the compact tray window", () => {
  it("opens from a macOS click, keeps the native menu on right-click and displays elapsed time", () => {
    const listeners = new Map<string, () => void>();
    const tray = {
      setToolTip: vi.fn(),
      setTitle: vi.fn(),
      setContextMenu: vi.fn(),
      popUpContextMenu: vi.fn(),
      destroy: vi.fn(),
      on: (name: string, listener: () => void) => listeners.set(name, listener),
    };
    const open = vi.fn();
    const controller = createTrayController({
      platform: "darwin",
      now: () => 0,
      createTray: () => tray,
      buildMenu: (value) => value,
      onAction: () => {},
      onPanelRequested: open,
    });
    controller.show();
    controller.setState({
      entry: {
        timerId: "current",
        title: "Current task",
        startedAt: 0,
        accumulatedMs: 60_000,
      },
    });
    listeners.get("click")!();
    expect(open).toHaveBeenCalledTimes(1);
    expect(tray.setContextMenu).not.toHaveBeenCalled();
    listeners.get("right-click")!();
    expect(tray.popUpContextMenu).toHaveBeenCalledTimes(1);
    expect(tray.setTitle).toHaveBeenLastCalledWith("0:01", {
      fontType: "monospacedDigit",
    });
    controller.setState({ entry: null });
    expect(tray.setTitle).toHaveBeenLastCalledWith("", {
      fontType: "monospacedDigit",
    });
    controller.remove();
  });
  it("requests its owner once, then shows only after the content is ready", () => {
    const s = setup();
    s.controller.toggle();
    s.controller.toggle();
    expect(s.request).toHaveBeenCalledTimes(1);
    s.controller.attach(s.window);
    expect(s.window.isVisible()).toBe(false);
    s.controller.ready();
    expect(s.window.isVisible()).toBe(true);
    expect(s.window.setBounds).toHaveBeenCalledWith({
      x: 630,
      y: 72,
      width: 360,
      height: 680,
    });
  });

  it("dismisses on blur, reopens the same window and destroys it on quit", () => {
    const s = setup();
    s.controller.toggle();
    s.controller.attach(s.window);
    s.controller.ready();
    s.listeners.get("blur")!();
    expect(s.window.isVisible()).toBe(false);
    s.advance();
    s.controller.toggle();
    expect(s.window.isVisible()).toBe(true);
    expect(s.request).toHaveBeenCalledTimes(1);
    s.controller.destroy();
    expect(s.window.destroy).toHaveBeenCalledTimes(1);
  });

  it("lets Linux position its regular compact window", () => {
    const s = setup("linux");
    s.controller.toggle();
    s.controller.attach(s.window);
    s.controller.ready();
    expect(s.window.isVisible()).toBe(true);
    expect(s.window.setBounds).not.toHaveBeenCalled();
    s.listeners.get("blur")!();
    expect(s.window.isVisible()).toBe(true);
  });

  it("does not reopen when clicking the tray first blurs an open panel", () => {
    const s = setup();
    s.controller.toggle();
    s.controller.attach(s.window);
    s.controller.ready();
    s.listeners.get("blur")!();
    s.controller.toggle();
    expect(s.window.isVisible()).toBe(false);
    s.advance();
    s.controller.toggle();
    expect(s.window.isVisible()).toBe(true);
  });
});
