import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmitter } from "../index.ts";
import {
  createConsoleSink,
  nowhere,
  sinkFromSwitch,
  WIDE_EVENTS_SWITCH,
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
});
