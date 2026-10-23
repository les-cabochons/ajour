import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { recordingEvents } from "./recording-events.ts";

const require = createRequire(import.meta.url);
const { createIpcListeners } = require("./electron/ipc-listeners.cjs") as {
  createIpcListeners: (
    ipcMain: FakeIpcMain,
    options: { events: unknown },
  ) => {
    handle: (channel: string, listener: Listener) => void;
    onMessage: (channel: string, listener: Listener) => void;
  };
};

type Listener = (event: { sender: string }, ...args: unknown[]) => unknown;

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

/** `ipcMain`: `on` listeners are emitted, `handle` handlers are kept to invoke. */
class FakeIpcMain extends EventEmitter {
  handlers = new Map<string, Listener>();
  handle(channel: string, handler: Listener) {
    this.handlers.set(channel, handler);
  }
}

/**
 * The preload, run as Electron runs it, with an `ipcRenderer` wired to the
 * main process's IPC listeners: what the renderer sees as
 * `window.ajourDesktop`, and the main process's recorded events.
 */
async function loadPreload() {
  const ipcMain = new FakeIpcMain();
  const { events, recorded } = recordingEvents();
  const ipc = createIpcListeners(ipcMain, { events });
  const sender = { sender: "window" };
  // IPC sends a structured clone, as Electron does.
  const ipcRenderer = {
    invoke: (channel: string, ...args: unknown[]) =>
      Promise.resolve().then(() =>
        ipcMain.handlers.get(channel)!(sender, ...structuredClone(args)),
      ),
    send: (channel: string, ...args: unknown[]) => {
      ipcMain.emit(channel, sender, ...structuredClone(args));
    },
    sendSync: () => null,
    on: () => undefined,
    removeListener: () => undefined,
  };
  let exposed: Record<string, (...args: unknown[]) => unknown> = {};
  const electron = {
    ipcRenderer,
    contextBridge: {
      exposeInMainWorld: (_key: string, api: typeof exposed) => {
        exposed = api;
      },
    },
  };
  const source = await readFile(
    new URL("./electron/preload.cjs", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    require: (name: string) => {
      if (name !== "electron") throw new Error(`Unexpected require: ${name}`);
      return electron;
    },
    window: { addEventListener: () => undefined },
    setTimeout,
  });
  return { api: exposed, ipc, recorded };
}

describe("the preload's trace context", () => {
  it("passes the renderer's traceparent on, so the IPC event joins its trace", async () => {
    const { api, ipc, recorded } = await loadPreload();
    const received: unknown[][] = [];
    ipc.handle("ajour:show-context-menu", (_event, ...args) => {
      received.push(args);
      return "archive";
    });

    const picked = await api.showContextMenu!(
      [{ type: "item", id: "archive", label: "Archive", enabled: true }],
      { x: 1, y: 2 },
      { traceparent: TRACEPARENT },
    );

    expect(picked).toBe("archive");
    // The listener gets the call's own arguments, never the carrier.
    expect(received).toEqual([
      [
        [{ type: "item", id: "archive", label: "Archive", enabled: true }],
        { x: 1, y: 2 },
      ],
    ]);
    expect(recorded).toEqual([
      expect.objectContaining({
        name: "context_menu.show",
        kind: "ipc",
        trace_id: TRACE_ID,
        parent_span_id: SPAN_ID,
      }),
    ]);
  });

  it("passes it on with one-way messages too", async () => {
    const { api, ipc, recorded } = await loadPreload();
    const received: unknown[][] = [];
    ipc.onMessage("ajour:set-theme-source", (_event, ...args) => {
      received.push(args);
    });

    api.setThemeSource!("dark", { traceparent: TRACEPARENT });

    expect(received).toEqual([["dark"]]);
    expect(recorded).toEqual([
      expect.objectContaining({
        name: "window.set_theme",
        trace_id: TRACE_ID,
        parent_span_id: SPAN_ID,
      }),
    ]);
  });

  it("drops a missing or malformed carrier, and the call starts its own trace", async () => {
    const { api, ipc, recorded } = await loadPreload();
    const received: unknown[][] = [];
    ipc.handle("ajour:check-for-updates", (_event, ...args) => {
      received.push(args);
      return null;
    });

    await api.checkForUpdates!("stable");
    await api.checkForUpdates!("stable", { traceparent: 42 });

    expect(received).toEqual([["stable"], ["stable"]]);
    expect(recorded).toHaveLength(2);
    for (const event of recorded) {
      expect(event.trace_id).not.toBe(TRACE_ID);
      expect(event.parent_span_id).toBeUndefined();
    }
  });
});
