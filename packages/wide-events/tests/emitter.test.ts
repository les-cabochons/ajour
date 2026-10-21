import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createEmitter, worstOutcome } from "../index.ts";
import { apiContext, recordingEmitter, testCatalog } from "./fixtures.ts";

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

describe("one event per unit of work", () => {
  it("emits one event with the envelope when a unit ends", () => {
    let now = Date.parse("2026-10-20T14:23:11.118Z");
    const { events, recorded } = recordingEmitter({ now: () => now });

    const result = events.run(
      "backlog.sync",
      { kind: "job", trigger: "schedule" },
      (unit) => {
        unit.set({ plugin: { id: "jira" }, sync: { mode: "backlog" } });
        unit.set({ sync: { received_count: 4 } });
        now += 42;
        return "synced";
      },
    );

    expect(result).toBe("synced");
    expect(recorded).toEqual([
      {
        schema: 1,
        name: "backlog.sync",
        kind: "job",
        runtime: "api",
        outcome: "ok",
        started_at: "2026-10-20T14:23:11.118Z",
        duration_ms: 42,
        trace_id: expect.stringMatching(TRACE_ID),
        span_id: expect.stringMatching(SPAN_ID),
        launch_id: "launch-1",
        trigger: "schedule",
        app: { version: "1.2.3", channel: "nightly", packaged: true },
        device: { platform: "win32", arch: "x64" },
        plugin: { id: "jira" },
        sync: { mode: "backlog", received_count: 4 },
      },
    ]);
  });

  // The desktop tests run main.cjs in a VM context, whose objects have their
  // own Object.prototype.
  it("merges nested fields made in another realm", () => {
    const { events, recorded } = recordingEmitter();

    events.run("backlog.sync", { kind: "job", trigger: "schedule" }, (unit) => {
      unit.set(runInNewContext('({ sync: { mode: "backlog" } })'));
      unit.set(runInNewContext("({ sync: { received_count: 4 } })"));
    });

    expect(recorded[0]!.sync).toEqual({ mode: "backlog", received_count: 4 });
  });

  it("replaces, never merges into, an object that is not an object literal", () => {
    const { events, recorded } = recordingEmitter();
    const notLiteral = Object.assign(Object.create(Object.create(null)), {
      received_count: 4,
    });

    events.run("backlog.sync", { kind: "job", trigger: "schedule" }, (unit) => {
      unit.set({ sync: { mode: "backlog" } });
      unit.set({ sync: notLiteral });
    });

    expect(recorded[0]!.sync).toBe(notLiteral);
  });

  it("names a renamed unit by its new name", () => {
    const { events } = recordingEmitter();

    const unit = events.start("api.request", {
      kind: "request",
      trigger: "system",
    });
    const renamed = unit.rename("agent_tool.call");

    expectTypeOf(unit.name).toEqualTypeOf<
      "backlog.sync" | "time_entry.update" | "api.request" | "agent_tool.call"
    >();
    expect([unit.name, renamed.name]).toEqual([
      "agent_tool.call",
      "agent_tool.call",
    ]);
  });

  it("describes an error made in another realm", () => {
    const { events, recorded } = recordingEmitter();

    events
      .start("backlog.sync", { kind: "job", trigger: "schedule" })
      .fail(runInNewContext('new TypeError("offline")'))
      .end();

    expect(recorded[0]!.error).toEqual({
      type: "TypeError",
      message: "offline",
    });
  });

  it("emits an error event once when the work throws, and rethrows", () => {
    const { events, recorded } = recordingEmitter();
    const failure = Object.assign(new TypeError("Bad state"), {
      code: "E_STATE",
    });

    expect(() =>
      events.run("backlog.sync", { kind: "job", trigger: "user" }, () => {
        throw failure;
      }),
    ).toThrow(failure);

    expect(recorded).toEqual([
      expect.objectContaining({
        name: "backlog.sync",
        outcome: "error",
        error: { type: "TypeError", code: "E_STATE", message: "Bad state" },
        duration_ms: expect.any(Number),
      }),
    ]);
  });

  it("ends an async unit when its work settles, in every path", async () => {
    let now = 0;
    const { events, recorded } = recordingEmitter({ now: () => now });

    const done = events.run(
      "backlog.sync",
      { kind: "job", trigger: "schedule" },
      async () => {
        await Promise.resolve();
        now += 30;
        return 7;
      },
    );
    expect(recorded).toEqual([]);
    await expect(done).resolves.toBe(7);

    await expect(
      events.run("backlog.sync", { kind: "job", trigger: "schedule" }, () =>
        Promise.reject(new RangeError("Too far")),
      ),
    ).rejects.toThrow("Too far");

    expect(recorded).toEqual([
      expect.objectContaining({ outcome: "ok", duration_ms: 30 }),
      expect.objectContaining({
        outcome: "error",
        error: { type: "RangeError", message: "Too far" },
      }),
    ]);
  });

  it("records a refusal, a cancellation and a timeout with their reasons", () => {
    const { events, recorded } = recordingEmitter();

    events.run(
      "time_entry.update",
      { kind: "command", trigger: "user" },
      (unit) => unit.refuse("locked_week"),
    );
    events.run("backlog.sync", { kind: "job", trigger: "user" }, (unit) =>
      unit.cancel("plugin_off"),
    );
    events.run(
      "backlog.sync",
      { kind: "plugin_operation", trigger: "user" },
      (unit) =>
        unit.fail(new Error("Took too long"), {
          outcome: "timeout",
          reason: "timeout",
          retriable: true,
        }),
    );
    events.run(
      "time_entry.update",
      { kind: "command", trigger: "user" },
      (unit) => unit.end("noop"),
    );

    expect(
      recorded.map(({ outcome, outcome_reason, error }) => ({
        outcome,
        outcome_reason,
        error,
      })),
    ).toEqual([
      { outcome: "refused", outcome_reason: "locked_week", error: undefined },
      { outcome: "cancelled", outcome_reason: "plugin_off", error: undefined },
      {
        outcome: "timeout",
        outcome_reason: "timeout",
        error: { type: "Error", message: "Took too long", retriable: true },
      },
      { outcome: "noop", outcome_reason: undefined, error: undefined },
    ]);
  });

  it("tells the outcome recorded so far, so a seam can weigh it", () => {
    const { events } = recordingEmitter();
    const unit = events.start("backlog.sync", { kind: "job", trigger: "user" });

    expect(unit.outcome).toBeUndefined();
    unit.refuse("plugin_off");
    expect(unit.outcome).toBe("refused");
    unit.fail(new Error("Slow"), { outcome: "timeout" });
    expect(unit.outcome).toBe("timeout");
    unit.end("error");
    expect(unit.outcome).toBe("error");
  });

  it("keeps a recorded outcome out of reach of code that writes to the unit", () => {
    const { events, recorded } = recordingEmitter();
    const unit = events.start("backlog.sync", { kind: "job", trigger: "user" });
    unit.fail(new Error("Down"));

    expect(() => Object.assign(unit, { outcome: "ok" })).toThrow(TypeError);
    unit.end();

    expect(recorded[0]!.outcome).toBe("error");
  });

  it("orders outcomes from worst to best: error, timeout, refused, cancelled", () => {
    expect(worstOutcome("ok", "refused", "timeout", "cancelled")).toBe(
      "timeout",
    );
    expect(worstOutcome("refused", "error", undefined)).toBe("error");
    expect(worstOutcome("cancelled", "noop")).toBe("cancelled");
    expect(worstOutcome(undefined, "noop")).toBe("noop");
    expect(worstOutcome()).toBe("ok");
  });

  it("emits a started unit once, at its first end, and ignores what comes after", () => {
    const { events, recorded } = recordingEmitter();

    const unit = events.start("backlog.sync", { kind: "job", trigger: "user" });
    unit.set({ plugin: { id: "jira" } });
    expect(recorded).toEqual([]);
    unit.end();
    unit.set({ plugin: { id: "github" } });
    unit.fail(new Error("Late"));
    unit.end("error");

    expect(recorded).toEqual([
      expect.objectContaining({ outcome: "ok", plugin: { id: "jira" } }),
    ]);
    expect(recorded[0]).not.toHaveProperty("error");
  });

  it("keeps the outcome the work recorded when it then throws", () => {
    const { events, recorded } = recordingEmitter();

    expect(() =>
      events.run(
        "time_entry.update",
        { kind: "command", trigger: "user" },
        (unit) => {
          unit.refuse("stale_window");
          throw new Error("Stale window");
        },
      ),
    ).toThrow();

    expect(recorded).toEqual([
      expect.objectContaining({
        outcome: "refused",
        outcome_reason: "stale_window",
        error: { type: "Error", message: "Stale window" },
      }),
    ]);
  });

  it("lets a seam refine the name once it knows the operation", () => {
    const { events, recorded } = recordingEmitter();

    events.run(
      "api.request",
      { kind: "request", trigger: "agent" },
      (request) => {
        const call = request.rename("agent_tool.call");
        call.set({ agent_tool: { name: "list_projects" } });
      },
    );
    events.run("backlog.sync", { kind: "job", trigger: "user" }, () => {
      events.run(
        "api.request",
        { kind: "request", trigger: "user" },
        (request) => request.rename("agent_tool.call"),
      );
    });

    expect(recorded).toEqual([
      expect.objectContaining({
        name: "agent_tool.call",
        kind: "request",
        agent_tool: { name: "list_projects" },
      }),
      expect.objectContaining({
        name: "backlog.sync",
        steps: ["agent_tool.call"],
      }),
    ]);
  });

  it("tells its name, refined or not, so a crash can say what was active", () => {
    const { events } = recordingEmitter();

    const names = events.run(
      "api.request",
      { kind: "request", trigger: "agent" },
      (request) => {
        const before = events.current()?.name;
        request.rename("agent_tool.call");
        return [before, events.current()?.name];
      },
    );

    expect(names).toEqual(["api.request", "agent_tool.call"]);
  });

  it("reads and scrubs a failure's message only when the event is built", () => {
    let reads = 0;
    const failure = new Error();
    Object.defineProperty(failure, "message", {
      get: () => {
        reads += 1;
        return "Bad token pat-7c1e9a";
      },
    });
    const dropped = createEmitter({
      catalog: testCatalog,
      context: apiContext,
    });
    dropped.run("backlog.sync", { kind: "job", trigger: "user" }, (unit) =>
      unit.fail(failure, { secrets: ["pat-7c1e9a"] }),
    );
    expect(reads).toBe(0);

    const { events, recorded } = recordingEmitter();
    events.run("backlog.sync", { kind: "job", trigger: "user" }, (unit) =>
      unit.fail(failure, { secrets: ["pat-7c1e9a"] }),
    );
    expect(recorded[0]!.error).toEqual({
      type: "Error",
      message: "Bad token [secret]",
    });
  });

  it("keeps working when the sink throws", () => {
    const { events } = recordingEmitter({
      sink: {
        emit() {
          throw new Error("Sink down");
        },
      },
    });

    expect(
      events.run("backlog.sync", { kind: "job", trigger: "user" }, () => 3),
    ).toBe(3);
  });
});
