import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { catalog } from "../../packages/wide-events/catalog.ts";
import { createEmitter } from "../../packages/wide-events/index.ts";
import { asyncContextScope } from "../../packages/wide-events/node.ts";
import { createRecordingSink } from "../../packages/wide-events/sinks.ts";

const require = createRequire(import.meta.url);
const { createIpcListeners, refusedSender } =
  require("./electron/ipc-listeners.cjs") as {
    createIpcListeners: (
      ipcMain: FakeIpcMain,
      options: { events: unknown },
    ) => Ipc;
    refusedSender: (message: string) => Error;
  };
const { IPC_CHANNELS } = require("./electron/ipc-channels.cjs") as {
  IPC_CHANNELS: Record<string, { event: string; mode: string }>;
};

type Listener = (event: IpcEvent, ...args: unknown[]) => unknown;

interface Ipc {
  handle: (channel: string, listener: Listener) => void;
  onMessage: (channel: string, listener: Listener) => void;
  answerSync: (channel: string, listener: Listener) => void;
}

interface IpcEvent {
  sender: string;
  returnValue?: unknown;
}

/** `ipcMain`: `on` listeners are emitted, `handle` handlers are kept to invoke. */
class FakeIpcMain extends EventEmitter {
  handlers = new Map<string, Listener>();
  handle(channel: string, handler: Listener) {
    this.handlers.set(channel, handler);
  }
  invoke(channel: string, event: IpcEvent, ...args: unknown[]) {
    return Promise.resolve().then(() =>
      this.handlers.get(channel)!(event, ...args),
    );
  }
}

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

function setUp() {
  const ipcMain = new FakeIpcMain();
  const sink = createRecordingSink();
  const events = createEmitter({
    catalog,
    context: {
      runtime: "main",
      launch_id: "launch-1",
      app: { version: "1.2.0", channel: "stable", packaged: true },
      device: { platform: "win32" },
    },
    sink,
    scope: asyncContextScope(),
  });
  return {
    ipcMain,
    sink,
    events,
    ipc: createIpcListeners(ipcMain, { events }),
  };
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
      throw new Error("Menu item failed.");
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

  it("emits one event per call, named from the channel table", async () => {
    const { ipcMain, ipc, sink } = setUp();
    ipc.handle("ajour:get-update-state", () => ({ status: "idle" }));

    await expect(
      ipcMain.invoke("ajour:get-update-state", { sender: "window" }),
    ).resolves.toEqual({ status: "idle" });

    expect(sink.events).toMatchObject([
      {
        name: "update.get_state",
        kind: "ipc",
        outcome: "ok",
        ipc: {
          channel: "ajour:get-update-state",
          mode: "invoke",
          sender_accepted: true,
        },
      },
    ]);
  });

  it("records a refused sender as refused, not as a crash, and still rejects the invoke", async () => {
    const { ipcMain, ipc, sink } = setUp();
    ipc.handle("ajour:check-for-updates", () => {
      throw refusedSender(
        "Only the active Ajour window can check for application updates.",
      );
    });
    ipc.onMessage("ajour:set-theme-source", () => {
      throw refusedSender("Only the active Ajour window can update the theme.");
    });

    await expect(
      ipcMain.invoke("ajour:check-for-updates", { sender: "other" }, "stable"),
    ).rejects.toThrow("Only the active Ajour window");
    ipcMain.emit("ajour:set-theme-source", { sender: "other" }, "dark");

    expect(sink.events).toMatchObject([
      {
        name: "update.check",
        outcome: "refused",
        outcome_reason: "foreign_sender",
        ipc: { sender_accepted: false },
      },
      {
        name: "window.set_theme",
        outcome: "refused",
        outcome_reason: "foreign_sender",
        ipc: { mode: "message", sender_accepted: false },
      },
    ]);
  });

  it("records a failed call as an error", async () => {
    const { ipcMain, ipc, sink } = setUp();
    ipc.answerSync("ajour:get-runtime-info", () => {
      throw new TypeError("broken");
    });

    ipcMain.emit("ajour:get-runtime-info", { sender: "window" });

    expect(sink.events).toMatchObject([
      {
        name: "app.runtime_info",
        outcome: "error",
        error: { type: "TypeError" },
        ipc: { mode: "sync" },
      },
    ]);
  });

  it("takes an optional traceparent as the last argument and hides it from the listener", async () => {
    const { ipcMain, ipc, sink } = setUp();
    const received: unknown[][] = [];
    ipc.handle("ajour:check-for-updates", (_event, ...args) => {
      received.push(args);
      return null;
    });

    await ipcMain.invoke(
      "ajour:check-for-updates",
      { sender: "window" },
      "stable",
      { traceparent: TRACEPARENT },
    );
    await ipcMain.invoke(
      "ajour:check-for-updates",
      { sender: "window" },
      "nightly",
    );

    expect(received).toEqual([["stable"], ["nightly"]]);
    expect(sink.events[0]).toMatchObject({
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      parent_span_id: "b7ad6b7169203331",
    });
    expect(sink.events[1]!.parent_span_id).toBeUndefined();
  });

  it("lets the listener add to its event through the active unit", async () => {
    const { ipcMain, ipc, sink, events } = setUp();
    ipc.handle("ajour:show-context-menu", async () => {
      await Promise.resolve();
      events.current()?.set({ context_menu: { item_count: 3 } });
      return null;
    });

    await ipcMain.invoke("ajour:show-context-menu", { sender: "window" }, []);

    expect(sink.events[0]).toMatchObject({
      name: "context_menu.show",
      context_menu: { item_count: 3 },
    });
  });

  it("refuses a channel that has no entry in the table, or registers the wrong way", () => {
    const { ipc } = setUp();

    expect(() => ipc.handle("ajour:not-a-channel", () => null)).toThrow(
      /channel table/,
    );
    expect(() => ipc.handle("ajour:get-app-menu", () => null)).toThrow(/sync/);
  });
});

describe("the IPC channel table", () => {
  it("names every channel main.cjs registers, and only through the wrapper", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    const registered = [
      ...source.matchAll(/ipc\.(handle|onMessage|answerSync)\(\s*"([^"]+)"/g),
    ].map(([, method, channel]) => [channel, method]);

    expect(source).not.toMatch(/ipcMain\.(handle|on|once|handleOnce)\(/);
    expect(registered.map(([channel]) => channel).sort()).toEqual(
      Object.keys(IPC_CHANNELS).sort(),
    );
    const methodOf = {
      invoke: "handle",
      message: "onMessage",
      sync: "answerSync",
    };
    for (const [channel, method] of registered) {
      const mode = IPC_CHANNELS[channel!]!.mode as keyof typeof methodOf;
      expect([channel, methodOf[mode]]).toEqual([channel, method]);
    }
  });

  it("names each channel with an IPC event of the catalog", () => {
    for (const [channel, { event }] of Object.entries(IPC_CHANNELS)) {
      const spec = catalog.events[event as keyof typeof catalog.events];
      expect([channel, spec?.kinds]).toEqual([
        channel,
        expect.arrayContaining(["ipc"]),
      ]);
    }
  });

  it("covers every channel the preload sends to", async () => {
    const preload = await readFile(
      new URL("./electron/preload.cjs", import.meta.url),
      "utf8",
    );

    const sent = new Set(
      [
        ...preload.matchAll(
          /ipcRenderer\.(?:invoke|send|sendSync)\(\s*"([^"]+)"/g,
        ),
      ].map(([, channel]) => channel),
    );

    expect([...sent].sort()).toEqual(Object.keys(IPC_CHANNELS).sort());
  });
});
