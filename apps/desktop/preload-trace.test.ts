import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { noWindowSession, recordingEvents } from "./recording-events.ts";

const require = createRequire(import.meta.url);
const { createIpcListeners } = require("./electron/ipc-listeners.cjs") as {
  createIpcListeners: (
    ipcMain: FakeIpcMain,
    options: { events: unknown; windowSession: () => unknown },
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
 * `window.ajourDesktop`, and the main process's recorded events. `runtime`
 * is main's answer to the runtime info request; `push` sends the page a
 * message from main.
 */
async function loadPreload({ runtime = null }: { runtime?: unknown } = {}) {
  const ipcMain = new FakeIpcMain();
  const { events, recorded } = recordingEvents();
  // The fake sender carries no session: the window's is none.
  const ipc = createIpcListeners(ipcMain, {
    events,
    windowSession: noWindowSession,
  });
  const sender = { sender: "window" };
  // IPC sends a structured clone, as Electron does. A handler's error
  // reaches the page as Electron 44 words it, naming the channel.
  const ipcRenderer = {
    invoke: (channel: string, ...args: unknown[]) =>
      Promise.resolve()
        .then(() =>
          ipcMain.handlers.get(channel)!(sender, ...structuredClone(args)),
        )
        .catch((error: unknown) => {
          throw new Error(
            `Error invoking remote method '${channel}': ${String(error)}`,
          );
        }),
    send: (channel: string, ...args: unknown[]) => {
      ipcMain.emit(channel, sender, ...structuredClone(args));
    },
    sendSync: (channel: string) =>
      channel === "ajour:get-runtime-info" ? structuredClone(runtime) : null,
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      pageListeners.set(channel, [
        ...(pageListeners.get(channel) ?? []),
        listener,
      ]);
    },
    removeListener: () => undefined,
  };
  const pageListeners = new Map<string, ((...args: unknown[]) => void)[]>();
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
  const push = (channel: string, ...args: unknown[]) => {
    for (const listener of pageListeners.get(channel) ?? []) {
      listener({}, ...structuredClone(args));
    }
  };
  return { api: exposed, ipc, recorded, push };
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

describe("the preload's wide events forwarding", () => {
  it("sends a batch on the forward channel, one way, and main records no event for it", async () => {
    const { api, ipc, recorded } = await loadPreload();
    const received: unknown[] = [];
    ipc.onMessage("ajour:forward-wide-events", (_event, batch) => {
      received.push(batch);
    });
    const batch = { events: [{ name: "route.change" }], unsent_event_count: 0 };

    expect(api.forwardWideEvents!(batch)).toBeUndefined();

    expect(received).toEqual([batch]);
    expect(recorded).toEqual([]);
  });

  it("tells the page at once whether logging is on, then each change main pushes", async () => {
    const { api, push } = await loadPreload({
      runtime: { wideEventsForwarding: true },
    });
    const seen: unknown[] = [];

    const stop = api.onWideEventsForwarding!((forwarding: unknown) =>
      seen.push(forwarding),
    ) as () => void;
    push("ajour:wide-events-forwarding", false);
    push("ajour:wide-events-forwarding", true);
    stop();
    push("ajour:wide-events-forwarding", false);

    expect(seen).toEqual([true, false, true]);
  });

  it("keeps the last value for a page that subscribes late, and reads anything else as off", async () => {
    const { api, push } = await loadPreload({ runtime: null });
    push("ajour:wide-events-forwarding", true);
    const late: unknown[] = [];
    api.onWideEventsForwarding!((forwarding: unknown) => late.push(forwarding));
    push("ajour:wide-events-forwarding", "yes");

    expect(late).toEqual([true, false]);
  });
});

describe("the preload's diagnostics reads (#442)", () => {
  it("passes a query's filter, page and traceparent on to main", async () => {
    const { api, ipc, recorded } = await loadPreload();
    const received: unknown[][] = [];
    ipc.handle("ajour:query-logs", (_event, ...args) => {
      received.push(args);
      return { events: [] };
    });

    await api.queryLogs!(
      { outcome: "problems" },
      { limit: 10 },
      { traceparent: TRACEPARENT },
    );

    expect(received).toEqual([[{ outcome: "problems" }, { limit: 10 }]]);
    expect(recorded).toEqual([
      expect.objectContaining({ name: "logs.query", trace_id: TRACE_ID }),
    ]);
  });

  it("hands each tail's pushed events to its own callback, until it stops", async () => {
    const { api, ipc, push } = await loadPreload();
    const calls: unknown[][] = [];
    ipc.handle("ajour:set-logs-tail", (_event, ...args) => {
      calls.push(args);
      return { id: args[0], subscribed: args[1] !== null };
    });
    const first: unknown[] = [];
    const second: unknown[] = [];

    const stopFirst = (await api.tailLogs!(
      { outcome: "problems" },
      (events: unknown[]) => first.push(...events),
    )) as () => void;
    await api.tailLogs!(undefined, (events: unknown[]) =>
      second.push(...events),
    );
    push("ajour:logs-tail-events", 1, [{ name: "backlog.sync" }]);
    push("ajour:logs-tail-events", 2, [{ name: "route.change" }]);
    push("ajour:logs-tail-events", 3, [{ name: "unknown.tail" }]);
    stopFirst();
    stopFirst();
    push("ajour:logs-tail-events", 1, [{ name: "after.stop" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(first).toEqual([{ name: "backlog.sync" }]);
    expect(second).toEqual([{ name: "route.change" }]);
    // Each tail has its number; no filter follows everything; stopping
    // twice tells main once.
    expect(calls).toEqual([
      [1, { outcome: "problems" }],
      [2, {}],
      [1, null],
    ]);
  });

  it("rejects a tail main refused, and keeps no callback for it", async () => {
    const { api, ipc, push } = await loadPreload();
    ipc.handle("ajour:set-logs-tail", () => {
      throw new Error("Invalid log query: The filter has no path.");
    });
    const seen: unknown[] = [];

    await expect(
      api.tailLogs!({ path: "x" }, (events: unknown[]) => seen.push(events)),
    ).rejects.toThrow(/^Invalid log query: The filter has no path\.$/);
    push("ajour:logs-tail-events", 1, [{ name: "backlog.sync" }]);

    expect(seen).toEqual([]);
  });
});

describe("the preload's errors", () => {
  it("rejects with the main process's own message, without Electron's prefix", async () => {
    const { api, ipc } = await loadPreload();
    ipc.handle("ajour:inspect-plugin-source", () => {
      throw new Error("Ajour found no ajour.json at the root.");
    });
    ipc.handle("ajour:remove-plugin-source", () => {
      throw new TypeError("The address is not a plugin source.");
    });

    await expect(
      api.inspectPluginSource!("https://github.com/alice/plugins"),
    ).rejects.toThrow(/^Ajour found no ajour\.json at the root\.$/);
    await expect(
      api.removePluginSource!("https://github.com/alice/plugins"),
    ).rejects.toThrow(/^The address is not a plugin source\.$/);
  });

  it("keeps a thrown string whole, even one that reads like an error type", async () => {
    const { api, ipc } = await loadPreload();
    ipc.handle("ajour:inspect-plugin-source", () => {
      throw "TypeError: literal text";
    });

    await expect(
      api.inspectPluginSource!("https://github.com/alice/plugins"),
    ).rejects.toThrow(/^TypeError: literal text$/);
  });
});
