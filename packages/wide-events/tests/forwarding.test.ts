import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../catalog.ts";
import {
  createForwardedBatchReader,
  createForwardingSink,
  FORWARD_BATCH_SIZE,
  FORWARD_FLUSH_MS,
  MAX_FORWARDED_EVENT_CHARS,
  type ForwardedBatch,
} from "../forwarding.ts";
import { createEmitter } from "../index.ts";

// Forwarding the renderer's events to the desktop main process's local log
// file (#440): the renderer's batching sink, and the reader main runs on
// every batch before the file sees it.

afterEach(() => {
  vi.useRealTimers();
});

const rendererContext = {
  runtime: "renderer",
  launch_id: "launch-1",
  window_id: "6f9c1b6e-8a51-4c2e-9d7e-2b4f0f3c1a10",
  app: { version: "1.2.3", channel: "stable", packaged: true },
  device: { platform: "win32", arch: "x64" },
} as const;

/** The renderer's emitter, sending its events through a forwarding sink. */
function forwarding({
  on = true,
  send = () => {},
}: {
  on?: boolean;
  send?: (batch: ForwardedBatch) => void;
} = {}) {
  let accepting = on;
  const batches: ForwardedBatch[] = [];
  const sink = createForwardingSink({
    send: (batch) => {
      send(batch);
      batches.push(batch);
    },
    accepting: () => accepting,
  });
  const events = createEmitter({ catalog, context: rendererContext, sink });
  const command = () =>
    events.run("week.reopen", { kind: "command", trigger: "user" }, () => 7);
  return {
    sink,
    events,
    batches,
    command,
    turn: (next: boolean) => {
      accepting = next;
    },
  };
}

describe("the renderer's forwarding sink", () => {
  it("sends one batch a second after the first event waits, and sets no timer while none waits", () => {
    vi.useFakeTimers();
    const renderer = forwarding();
    expect(vi.getTimerCount()).toBe(0);

    renderer.command();
    vi.advanceTimersByTime(FORWARD_FLUSH_MS / 2);
    renderer.command();
    expect(renderer.batches).toEqual([]);

    vi.advanceTimersByTime(FORWARD_FLUSH_MS / 2);
    expect(renderer.batches).toHaveLength(1);
    expect(renderer.batches[0]).toEqual({
      events: [
        expect.objectContaining({ name: "week.reopen", runtime: "renderer" }),
        expect.objectContaining({ name: "week.reopen", runtime: "renderer" }),
      ],
      unsent_event_count: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends at once when 100 events wait", () => {
    vi.useFakeTimers();
    const renderer = forwarding();

    for (let index = 0; index < FORWARD_BATCH_SIZE + 1; index += 1) {
      renderer.command();
    }

    expect(renderer.batches.map(({ events }) => events.length)).toEqual([
      FORWARD_BATCH_SIZE,
    ]);
    vi.advanceTimersByTime(FORWARD_FLUSH_MS);
    expect(renderer.batches.map(({ events }) => events.length)).toEqual([
      FORWARD_BATCH_SIZE,
      1,
    ]);
  });

  it("sends what waits when flushed, as the page does when it hides", () => {
    vi.useFakeTimers();
    const renderer = forwarding();

    renderer.command();
    renderer.sink.flush();
    renderer.sink.flush();

    expect(renderer.batches).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a batch it can't send, counts it in the next one, and never sends it again", () => {
    vi.useFakeTimers();
    let fail = true;
    const renderer = forwarding({
      send: () => {
        if (fail) throw new Error("The window is gone.");
      },
    });

    renderer.command();
    renderer.command();
    // The work never sees the failure, and nothing waits on it.
    expect(() => vi.advanceTimersByTime(FORWARD_FLUSH_MS)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);

    fail = false;
    renderer.command();
    vi.advanceTimersByTime(FORWARD_FLUSH_MS);

    expect(renderer.batches).toEqual([
      { events: [expect.any(Object)], unsent_event_count: 2 },
    ]);
    renderer.command();
    vi.advanceTimersByTime(FORWARD_FLUSH_MS);
    expect(renderer.batches[1]!.unsent_event_count).toBe(0);
  });

  it("builds no event while off, and drops what waited when turned off", () => {
    vi.useFakeTimers();
    const renderer = forwarding({ on: false });
    let reads = 0;
    // Building an event reads its error's message, to scrub it.
    const error = new Error();
    Object.defineProperty(error, "message", {
      get() {
        reads += 1;
        return "failed";
      },
    });
    const fail = () =>
      renderer.events
        .start("week.reopen", { kind: "command", trigger: "user" })
        .fail(error)
        .end();

    fail();
    vi.advanceTimersByTime(FORWARD_FLUSH_MS);
    expect(reads).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    renderer.turn(true);
    fail();
    expect(reads).toBe(1);
    renderer.turn(false);
    vi.advanceTimersByTime(FORWARD_FLUSH_MS);

    expect(renderer.batches).toEqual([]);
  });

  it("never changes the work when its accepting throws", async () => {
    const sink = createForwardingSink({
      send: () => {},
      accepting: () => {
        throw new Error("The bridge is gone.");
      },
    });
    const events = createEmitter({ catalog, context: rendererContext, sink });

    expect(
      events.run("week.reopen", { kind: "command", trigger: "user" }, () => 7),
    ).toBe(7);
    await expect(
      events.run(
        "backlog.sync",
        { kind: "job", trigger: "user" },
        async () => "synced",
      ),
    ).resolves.toBe("synced");
  });
});

/** A renderer event as the forwarding sink sends it. */
function rendererEvent(fields: Record<string, unknown> = {}) {
  return {
    schema: 1,
    name: "time_entry.update",
    kind: "command",
    runtime: "renderer",
    outcome: "refused",
    outcome_reason: "locked_week",
    started_at: "2026-10-26T12:00:00.000Z",
    duration_ms: 3,
    trace_id: "0af7651916cd43dd8448eb211c80319c",
    span_id: "b7ad6b7169203331",
    launch_id: "launch-1",
    window_id: rendererContext.window_id,
    trigger: "user",
    surface: "editor",
    app: rendererContext.app,
    device: rendererContext.device,
    ...fields,
  };
}

const FROM = { runtime: "renderer", launch_id: "launch-1" } as const;

describe("the forwarded batch reader", () => {
  const read = createForwardedBatchReader(catalog);

  it("passes the events whose envelope is valid for the renderer's launch", () => {
    const event = rendererEvent({ parent_span_id: "00f067aa0ba902b7" });

    expect(read({ events: [event], unsent_event_count: 4 }, FROM)).toEqual({
      events: [event],
      rejected_event_count: 0,
      unsent_event_count: 4,
    });
  });

  it.each([
    ["another runtime", { runtime: "main" }],
    ["another launch", { launch_id: "launch-2" }],
    ["a name the catalog lacks", { name: "user.note" }],
    ["a kind its name doesn't allow", { kind: "job" }],
    ["an unknown kind", { kind: "telemetry" }],
    ["another schema", { schema: 2 }],
    ["an unknown outcome", { outcome: "maybe" }],
    ["an unknown trigger", { trigger: "plugin" }],
    ["an unknown surface", { surface: "tray" }],
    ["a start that isn't an ISO time", { started_at: "yesterday" }],
    ["a negative duration", { duration_ms: -1 }],
    ["a duration that isn't a number", { duration_ms: "3" }],
    ["a trace ID that isn't 32 hex", { trace_id: "C:\\Users\\ada" }],
    ["a span ID that isn't 16 hex", { span_id: "span" }],
    ["a parent span that isn't 16 hex", { parent_span_id: "x" }],
    ["a window ID that isn't one", { window_id: "https://example.com" }],
    ["no app", { app: "Ajour" }],
    ["no device", { device: undefined }],
    [
      "more than one event may hold",
      { route: { to_id: "x".repeat(MAX_FORWARDED_EVENT_CHARS) } },
    ],
  ])("leaves out an event with %s, and counts it", (_case, fields) => {
    expect(
      read({ events: [rendererEvent(fields), rendererEvent()] }, FROM),
    ).toEqual({
      events: [rendererEvent()],
      rejected_event_count: 1,
      unsent_event_count: 0,
    });
  });

  it("leaves out what isn't an event, and a cycle a structured clone can carry", () => {
    const cycle: Record<string, unknown> = rendererEvent();
    cycle.self = cycle;

    expect(
      read({ events: [null, "event", [rendererEvent()], cycle] }, FROM),
    ).toMatchObject({ events: [], rejected_event_count: 4 });
  });

  it.each([null, "batch", [], { events: "all" }, { events: {} }])(
    "reads %j as an empty batch",
    (batch) => {
      expect(read(batch, FROM)).toEqual({
        events: [],
        rejected_event_count: 0,
        unsent_event_count: 0,
      });
    },
  );

  it("reads only the first 100 events of a batch, and counts the rest", () => {
    const events = Array.from({ length: FORWARD_BATCH_SIZE + 5 }, () =>
      rendererEvent(),
    );

    const result = read({ events }, FROM);

    expect(result.events).toHaveLength(FORWARD_BATCH_SIZE);
    expect(result.rejected_event_count).toBe(5);
  });

  it.each([-1, 1.5, "3", Number.MAX_VALUE])(
    "reads an unsent count of %j as none",
    (unsent) => {
      expect(
        read({ events: [], unsent_event_count: unsent }, FROM)
          .unsent_event_count,
      ).toBe(0);
    },
  );

  it("drops a reason outside the name's closed set, and an error's message", () => {
    const [event] = read(
      {
        events: [
          rendererEvent({
            outcome: "error",
            outcome_reason: "C:\\Users\\ada\\notes.txt",
            error: { type: "Error", code: "EPERM", message: "Ada's notes" },
          }),
        ],
      },
      FROM,
    ).events;

    expect(event).not.toHaveProperty("outcome_reason");
    expect(event!.error).toEqual({ type: "Error", code: "EPERM" });
  });

  it("never changes the batch it reads", () => {
    const event = rendererEvent({
      error: { type: "Error", message: "Ada's notes" },
    });
    const copy = structuredClone(event);

    read({ events: [event] }, FROM);

    expect(event).toEqual(copy);
  });
});
