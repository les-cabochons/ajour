import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createIpcListeners } = require("./electron/ipc-listeners.cjs") as {
  createIpcListeners: (ipcMain: EventEmitter) => {
    onMessage: (
      channel: string,
      listener: (event: IpcEvent, ...args: unknown[]) => void,
    ) => void;
    answerSync: (
      channel: string,
      answer: (event: IpcEvent, ...args: unknown[]) => unknown,
    ) => void;
  };
};

interface IpcEvent {
  sender: string;
  returnValue?: unknown;
}

function setUp() {
  const ipcMain = new EventEmitter();
  return { ipcMain, ipc: createIpcListeners(ipcMain) };
}

describe("main process IPC listeners", () => {
  it("passes a message and its arguments to the listener", () => {
    const { ipcMain, ipc } = setUp();
    const received: unknown[] = [];
    ipc.onMessage("ajour:set-theme-source", (_event, mode) => {
      received.push(mode);
    });

    ipcMain.emit("ajour:set-theme-source", { sender: "window" }, "dark");

    expect(received).toEqual(["dark"]);
  });

  it("keeps a throwing message listener from crashing the main process", () => {
    const { ipcMain, ipc } = setUp();
    ipc.onMessage("ajour:run-menu-item", () => {
      throw new Error("Only the active Ajour window can run a menu item.");
    });

    expect(() =>
      ipcMain.emit("ajour:run-menu-item", { sender: "other" }, "zoom-in"),
    ).not.toThrow();
  });

  it("answers a synchronous request with the listener's value", () => {
    const { ipcMain, ipc } = setUp();
    ipc.answerSync("ajour:get-app-menu", () => ({ menus: [] }));
    const event: IpcEvent = { sender: "window" };

    ipcMain.emit("ajour:get-app-menu", event);

    expect(event.returnValue).toEqual({ menus: [] });
  });

  it("answers null when a synchronous request fails, so the renderer never waits", () => {
    const { ipcMain, ipc } = setUp();
    ipc.answerSync("ajour:get-bootstrap-local-state", () => {
      throw new Error("EPERM: operation not permitted, open '000003.log'");
    });
    const event: IpcEvent = { sender: "window" };

    expect(() =>
      ipcMain.emit("ajour:get-bootstrap-local-state", event),
    ).not.toThrow();
    expect(event.returnValue).toBeNull();
  });
});
