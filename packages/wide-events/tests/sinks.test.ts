import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmitter } from "../index.ts";
import {
  createConsoleSink,
  createRecordingSink,
  fanOut,
  nowhere,
  sinkFromSwitch,
  WIDE_EVENTS_SWITCH,
  type Sink,
} from "../sinks.ts";
import { apiContext, testCatalog } from "./fixtures.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sinks", () => {
  it("drops every event by default, and prints nothing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const events = createEmitter({ catalog: testCatalog, context: apiContext });

    events.run("backlog.sync", { kind: "job", trigger: "user" }, () => {});

    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("prints one JSON line per event to the console", () => {
    const lines: string[] = [];
    const events = createEmitter({
      catalog: testCatalog,
      context: apiContext,
      sink: createConsoleSink((line) => lines.push(line)),
    });

    events.run("backlog.sync", { kind: "job", trigger: "user" }, (unit) =>
      unit.set({ plugin: { id: "jira" } }),
    );
    events.run("api.request", { kind: "request", trigger: "user" }, () => {});

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ name: "backlog.sync", plugin: { id: "jira" } }),
      expect.objectContaining({ name: "api.request" }),
    ]);
  });

  it("writes to console.log unless told otherwise", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const events = createEmitter({
      catalog: testCatalog,
      context: apiContext,
      sink: createConsoleSink(),
    });

    events.run("api.request", { kind: "request", trigger: "user" }, () => {});

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({
      name: "api.request",
    });
  });

  it("turns the console sink on only when the developer switch says console", () => {
    expect(WIDE_EVENTS_SWITCH).toBe("AJOUR_WIDE_EVENTS");
    expect(sinkFromSwitch(undefined)).toBe(nowhere);
    expect(sinkFromSwitch("")).toBe(nowhere);
    expect(sinkFromSwitch("1")).toBe(nowhere);

    const lines: string[] = [];
    const sink = sinkFromSwitch(" Console ", (line) => lines.push(line));
    createEmitter({ catalog: testCatalog, context: apiContext, sink }).run(
      "api.request",
      { kind: "request", trigger: "user" },
      () => {},
    );
    expect(lines).toHaveLength(1);
  });

  it("builds no event while the sink is off, and builds them again once it is on", () => {
    let on = false;
    const emit = vi.fn();
    const events = createEmitter({
      catalog: testCatalog,
      context: apiContext,
      sink: { emit, accepting: () => on },
    });
    const failing = () => {
      throw new Error("failed");
    };

    expect(() =>
      events.run("backlog.sync", { kind: "job", trigger: "user" }, failing),
    ).toThrow("failed");
    expect(emit).not.toHaveBeenCalled();

    on = true;
    events.run("backlog.sync", { kind: "job", trigger: "user" }, () => {});
    expect(emit).toHaveBeenCalledOnce();
  });

  it("treats a sink whose accepting throws as off: the work still resolves with its result", async () => {
    const emit = vi.fn();
    const events = createEmitter({
      catalog: testCatalog,
      context: apiContext,
      sink: {
        emit,
        accepting() {
          throw new Error("accepting failed");
        },
      },
    });

    expect(
      events.run("backlog.sync", { kind: "job", trigger: "user" }, () => 1),
    ).toBe(1);
    await expect(
      events.run(
        "backlog.sync",
        { kind: "job", trigger: "user" },
        async () => 2,
      ),
    ).resolves.toBe(2);
    await expect(
      events.run("backlog.sync", { kind: "job", trigger: "user" }, async () => {
        throw new Error("the work's own failure");
      }),
    ).rejects.toThrow("the work's own failure");
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("fanOut", () => {
  it("hands each event to every sink, past one that throws", () => {
    const first = createRecordingSink();
    const second = createRecordingSink();
    const throwing: Sink = {
      emit() {
        throw new Error("disk full");
      },
    };
    const events = createEmitter({
      catalog: testCatalog,
      context: apiContext,
      sink: fanOut(first, throwing, second),
    });

    expect(
      events.run("api.request", { kind: "request", trigger: "user" }, () => 1),
    ).toBe(1);

    expect(first.events).toMatchObject([{ name: "api.request" }]);
    expect(second.events).toMatchObject([{ name: "api.request" }]);
  });

  it("hands events to the other sinks when one sink's accepting throws", async () => {
    const first = createRecordingSink();
    const second = createRecordingSink();
    const throwing: Sink = {
      emit: vi.fn(),
      accepting() {
        throw new Error("accepting failed");
      },
    };
    const sink = fanOut(first, throwing, second);
    const events = createEmitter({
      catalog: testCatalog,
      context: apiContext,
      sink,
    });

    expect(
      events.run("api.request", { kind: "request", trigger: "user" }, () => 1),
    ).toBe(1);
    await expect(
      events.run(
        "api.request",
        { kind: "request", trigger: "user" },
        async () => 2,
      ),
    ).resolves.toBe(2);

    expect(first.events).toMatchObject([
      { name: "api.request" },
      { name: "api.request" },
    ]);
    expect(second.events).toHaveLength(2);
    expect(throwing.emit).not.toHaveBeenCalled();
    expect(sink.accepting?.()).toBe(true);
    expect(fanOut(throwing, throwing).accepting?.()).toBe(false);
  });

  it("skips a sink that is off, and is off only when every sink is", () => {
    let fileOn = false;
    const file = { ...createRecordingSink(), accepting: () => fileOn };
    const terminal = createRecordingSink();

    const both = fanOut(terminal, file);
    const fileOnly = fanOut(nowhere, file);
    const events = createEmitter({
      catalog: testCatalog,
      context: apiContext,
      sink: both,
    });
    events.run("api.request", { kind: "request", trigger: "user" }, () => {});

    expect(terminal.events).toHaveLength(1);
    expect(file.events).toHaveLength(0);
    expect(both.accepting?.()).toBe(true);
    expect(fileOnly).toBe(file);
    fileOn = true;
    events.run("api.request", { kind: "request", trigger: "user" }, () => {});
    expect(file.events).toHaveLength(1);
  });

  it("is nowhere when it has no sink but nowhere", () => {
    expect(fanOut()).toBe(nowhere);
    expect(fanOut(nowhere, nowhere)).toBe(nowhere);
  });
});
