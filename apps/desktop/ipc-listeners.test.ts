import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { catalog } from "../../packages/wide-events/catalog.ts";
import { recordingEvents } from "./recording-events.ts";

const require = createRequire(import.meta.url);
const { createIpcListeners, refusedSender } =
  require("./electron/ipc-listeners.cjs") as {
    createIpcListeners: (
      ipcMain: FakeIpcMain,
      options: { events: unknown; windowSession?: () => unknown },
    ) => Ipc;
    refusedSender: (message: string) => Error;
  };
const { IPC_CHANNELS } = require("./electron/ipc-channels.cjs") as {
  IPC_CHANNELS: Record<string, { event: string; mode: string }>;
};

type Listener = (event: IpcEvent | WindowEvent, ...args: unknown[]) => unknown;

interface Ipc {
  handle: (channel: string, listener: Listener) => void;
  onMessage: (channel: string, listener: Listener) => void;
  answerSync: (channel: string, listener: Listener) => void;
}

interface IpcEvent {
  sender: string;
  returnValue?: unknown;
}

interface WindowEvent {
  sender: { session: unknown };
  senderFrame?: { url?: string; origin?: string } | null;
  returnValue?: unknown;
}

/** `ipcMain`: `on` listeners are emitted, `handle` handlers are kept to invoke. */
class FakeIpcMain extends EventEmitter {
  handlers = new Map<string, Listener>();
  handle(channel: string, handler: Listener) {
    this.handlers.set(channel, handler);
  }
  invoke(channel: string, event: IpcEvent | WindowEvent, ...args: unknown[]) {
    return Promise.resolve().then(() =>
      this.handlers.get(channel)!(event, ...args),
    );
  }
}

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

function setUp() {
  const ipcMain = new FakeIpcMain();
  const { events, recorded } = recordingEvents();
  return {
    ipcMain,
    recorded,
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
    const { ipcMain, ipc, recorded } = setUp();
    ipc.handle("ajour:get-update-state", () => ({ status: "idle" }));

    await expect(
      ipcMain.invoke("ajour:get-update-state", { sender: "window" }),
    ).resolves.toEqual({ status: "idle" });

    expect(recorded).toMatchObject([
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
    const { ipcMain, ipc, recorded } = setUp();
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

    expect(recorded).toMatchObject([
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
    const { ipcMain, ipc, recorded } = setUp();
    ipc.answerSync("ajour:get-runtime-info", () => {
      throw new TypeError("broken");
    });

    ipcMain.emit("ajour:get-runtime-info", { sender: "window" });

    expect(recorded).toMatchObject([
      {
        name: "app.runtime_info",
        outcome: "error",
        error: { type: "TypeError" },
        ipc: { mode: "sync" },
      },
    ]);
  });

  it("takes an optional traceparent as the last argument and hides it from the listener", async () => {
    const { ipcMain, ipc, recorded } = setUp();
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
    expect(recorded[0]).toMatchObject({
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      parent_span_id: "b7ad6b7169203331",
    });
    expect(recorded[1]!.parent_span_id).toBeUndefined();
  });

  it("lets the listener add to its event through the active unit", async () => {
    const { ipcMain, ipc, recorded, events } = setUp();
    ipc.handle("ajour:show-context-menu", async () => {
      await Promise.resolve();
      events.current()?.set({ context_menu: { item_count: 3 } });
      return null;
    });

    await ipcMain.invoke("ajour:show-context-menu", { sender: "window" }, []);

    expect(recorded[0]).toMatchObject({
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

describe("which pages may use the window's channels", () => {
  const windowSession = { name: "default" };
  const pluginSession = { name: "plugin" };

  function setUpWithSession() {
    const ipcMain = new FakeIpcMain();
    const { events, recorded } = recordingEvents();
    const ipc = createIpcListeners(ipcMain, {
      events,
      windowSession: () => windowSession,
    });
    return { ipcMain, recorded, ipc };
  }

  const fromWindow = (): WindowEvent => ({
    sender: { session: windowSession },
    senderFrame: {
      url: "http://127.0.0.1:8787/",
      origin: "http://127.0.0.1:8787",
    },
  });
  const fromPluginPage = (): WindowEvent => ({
    sender: { session: pluginSession },
    senderFrame: {
      url: "ajour-plugin://acme/host.html",
      origin: "ajour-plugin://acme",
    },
  });

  it("answers a sync channel only to the window, and leaks nothing to a plugin's page", () => {
    const { ipcMain, ipc, recorded } = setUpWithSession();
    let ran = 0;
    ipc.answerSync("ajour:get-bootstrap-local-state", () => {
      ran += 1;
      return { secret: "state" };
    });

    const window = fromWindow();
    ipcMain.emit("ajour:get-bootstrap-local-state", window);
    const plugin = fromPluginPage();
    ipcMain.emit("ajour:get-bootstrap-local-state", plugin);

    expect(window.returnValue).toEqual({ secret: "state" });
    expect(plugin.returnValue).toBeNull();
    expect(ran).toBe(1);
    expect(recorded[1]).toMatchObject({
      outcome: "refused",
      outcome_reason: "foreign_sender",
      ipc: { sender_accepted: false },
    });
  });

  it("refuses a page that is not in the window's session even at a web origin", () => {
    const { ipcMain, ipc } = setUpWithSession();
    ipc.answerSync("ajour:get-runtime-info", () => ({ version: "1" }));
    const event: WindowEvent = {
      sender: { session: pluginSession },
      senderFrame: {
        url: "https://example.com/",
        origin: "https://example.com",
      },
    };

    ipcMain.emit("ajour:get-runtime-info", event);

    expect(event.returnValue).toBeNull();
  });

  it("refuses a plugin page's frame even when the sender is in the window's session", () => {
    const { ipcMain, ipc } = setUpWithSession();
    ipc.answerSync("ajour:get-app-menu", () => ({ menus: [] }));
    const event: WindowEvent = {
      sender: { session: windowSession },
      senderFrame: { url: "ajour-plugin://acme/host.html" },
    };

    ipcMain.emit("ajour:get-app-menu", event);

    expect(event.returnValue).toBeNull();
  });

  it("rejects an invoke and drops a message from a plugin's page", async () => {
    const { ipcMain, ipc } = setUpWithSession();
    const ran: string[] = [];
    ipc.handle("ajour:get-update-state", () => {
      ran.push("invoke");
      return { status: "idle" };
    });
    ipc.onMessage("ajour:run-menu-item", () => {
      ran.push("message");
    });

    await expect(
      ipcMain.invoke("ajour:get-update-state", fromPluginPage()),
    ).rejects.toThrow();
    ipcMain.emit("ajour:run-menu-item", fromPluginPage(), "zoom-in");
    await ipcMain.invoke("ajour:get-update-state", fromWindow());
    ipcMain.emit("ajour:run-menu-item", fromWindow(), "zoom-in");

    expect(ran).toEqual(["invoke", "message"]);
  });

  it("leaves the plugin renderer channel to the runtime's own sender check", async () => {
    const { ipcMain, ipc } = setUpWithSession();
    ipc.handle("ajour:plugin-renderer", () => "reached");

    await expect(
      ipcMain.invoke("ajour:plugin-renderer", fromPluginPage()),
    ).resolves.toBe("reached");
  });

  it("is given the default session by main.cjs", async () => {
    const source = await readFile(
      new URL("./electron/main.cjs", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /createIpcListeners\(ipcMain,\s*\{[^}]*windowSession:\s*\(\)\s*=>\s*session\.defaultSession/,
    );
  });
});

describe("the channel that forwards the renderer's events", () => {
  const windowSession = { name: "window" };
  const fromWindow = (): WindowEvent => ({
    sender: { session: windowSession },
    senderFrame: { url: "app://ajour/", origin: "app://ajour" },
  });

  function setUpForwarding() {
    const ipcMain = new FakeIpcMain();
    const { events, recorded } = recordingEvents();
    const ipc = createIpcListeners(ipcMain, {
      events,
      windowSession: () => windowSession,
    });
    return { ipcMain, recorded, ipc };
  }

  it("emits no event for a batch it takes, so forwarding never writes a line per batch", () => {
    const { ipcMain, ipc, recorded } = setUpForwarding();
    const received: unknown[] = [];
    ipc.onMessage("ajour:forward-wide-events", (_event, batch) => {
      received.push(batch);
    });

    ipcMain.emit("ajour:forward-wide-events", fromWindow(), { events: [] });

    expect(received).toEqual([{ events: [] }]);
    expect(recorded).toEqual([]);
  });

  it("refuses a page outside the window's session, and records that one", () => {
    const { ipcMain, ipc, recorded } = setUpForwarding();
    const received: unknown[] = [];
    ipc.onMessage("ajour:forward-wide-events", (_event, batch) => {
      received.push(batch);
    });

    expect(() =>
      ipcMain.emit(
        "ajour:forward-wide-events",
        {
          sender: { session: { name: "plugin" } },
          senderFrame: { origin: "ajour-plugin://acme" },
        },
        { events: [] },
      ),
    ).not.toThrow();

    expect(received).toEqual([]);
    expect(recorded).toMatchObject([
      {
        name: "wide_events.forward",
        kind: "ipc",
        outcome: "refused",
        outcome_reason: "foreign_sender",
        ipc: {
          channel: "ajour:forward-wide-events",
          mode: "message",
          sender_accepted: false,
        },
      },
    ]);
  });

  it("records a refusal the listener throws, and a failure, never the batch", () => {
    const { ipcMain, ipc, recorded } = setUpForwarding();
    const failures = [
      refusedSender("Only the active Ajour window can forward wide events."),
      new TypeError("broken"),
    ];
    ipc.onMessage("ajour:forward-wide-events", () => {
      throw failures.shift();
    });

    ipcMain.emit("ajour:forward-wide-events", fromWindow(), { events: [] });
    ipcMain.emit("ajour:forward-wide-events", fromWindow(), { events: [] });

    expect(recorded).toMatchObject([
      {
        name: "wide_events.forward",
        outcome: "refused",
        outcome_reason: "foreign_sender",
        ipc: { sender_accepted: false },
      },
      {
        name: "wide_events.forward",
        outcome: "error",
        error: { type: "TypeError" },
        ipc: { sender_accepted: true },
      },
    ]);
  });
});

describe("the IPC channel table", () => {
  it("names every channel main.cjs registers, and only through the wrapper", async () => {
    // The plugin renderer runtime registers its page's channel itself.
    const source = (
      await Promise.all(
        ["./electron/main.cjs", "./electron/plugin-renderer-runtime.cjs"].map(
          (file) => readFile(new URL(file, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");

    const registered = [
      ...source.matchAll(
        /\b(?:ipc|ipcListeners)\.(handle|onMessage|answerSync)\(\s*"([^"]+)"/g,
      ),
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

  it("covers every channel the preloads send to", async () => {
    // The window's preload, and the one of each plugin's hidden page.
    const preload = (
      await Promise.all(
        ["./electron/preload.cjs", "./electron/plugin-host/preload.cjs"].map(
          (file) => readFile(new URL(file, import.meta.url), "utf8"),
        ),
      )
    ).join("\n");

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
