import { describe, expect, it } from "vitest";
import { asyncContextScope } from "../node.ts";
import { recordingEmitter } from "./fixtures.ts";

describe("nested units fold into the outer one", () => {
  it("adds a nested unit's name to steps and its counts to the outer counts, and emits only the outer", () => {
    const { events, recorded } = recordingEmitter();

    events.run("backlog.sync", { kind: "job", trigger: "schedule" }, (sync) => {
      sync.count("api_call_count");
      events.run(
        "time_entry.update",
        { kind: "command", trigger: "system" },
        (update) => {
          update.count("store_write_count", 2);
          update.set({ time_entry: { id: "e1" } });
          // A unit nested in a nested unit folds into the outermost one.
          events.run(
            "api.request",
            { kind: "request", trigger: "system" },
            (request) => request.count("api_call_count"),
          );
        },
      );
      events.run(
        "time_entry.update",
        { kind: "command", trigger: "system" },
        (update) => update.count("store_write_count"),
      );
    });

    expect(recorded).toEqual([
      expect.objectContaining({
        name: "backlog.sync",
        steps: ["time_entry.update", "api.request", "time_entry.update"],
        counts: { api_call_count: 2, store_write_count: 3 },
      }),
    ]);
    // A nested unit's own fields stay out of the outer event.
    expect(recorded[0]).not.toHaveProperty("time_entry");
  });

  it("emits a plugin operation of its own, as a child span of the outer unit", () => {
    const { events, recorded } = recordingEmitter();

    events.run("backlog.sync", { kind: "request", trigger: "system" }, () => {
      events.run(
        "backlog.sync",
        { kind: "plugin_operation", trigger: "system" },
        (operation) => operation.count("api_call_count"),
      );
    });

    const [operation, request] = recorded;
    expect(recorded.map((event) => event.kind)).toEqual([
      "plugin_operation",
      "request",
    ]);
    expect(operation).toMatchObject({
      trace_id: request!.trace_id,
      parent_span_id: request!.span_id,
      counts: { api_call_count: 1 },
    });
    expect(operation!.span_id).not.toBe(request!.span_id);
    expect(request).not.toHaveProperty("steps");
    expect(request).not.toHaveProperty("parent_span_id");
  });

  it("emits a detached unit of its own, as a child span, for work that outlives the outer unit", () => {
    const { events, recorded } = recordingEmitter();

    const job = events.run(
      "api.request",
      { kind: "request", trigger: "user" },
      () =>
        events.start("backlog.sync", {
          kind: "job",
          trigger: "user",
          detached: true,
        }),
    );
    job.end();

    const [request, sync] = recorded;
    expect(recorded.map((event) => event.name)).toEqual([
      "api.request",
      "backlog.sync",
    ]);
    expect(sync).toMatchObject({
      trace_id: request!.trace_id,
      parent_span_id: request!.span_id,
    });
  });

  it("starts a unit of its own once the outer unit has ended", () => {
    const { events, recorded } = recordingEmitter();

    const outer = events.start("backlog.sync", {
      kind: "job",
      trigger: "user",
    });
    outer.enter(() => {
      outer.end();
      events.run(
        "time_entry.update",
        { kind: "command", trigger: "user" },
        () => {},
      );
    });

    expect(recorded.map((event) => event.name)).toEqual([
      "backlog.sync",
      "time_entry.update",
    ]);
    expect(recorded[1]!.trace_id).not.toBe(recorded[0]!.trace_id);
  });

  it("gives the active unit to the code doing the work", () => {
    const { events, recorded } = recordingEmitter();

    expect(events.current()).toBeUndefined();
    events.run("api.request", { kind: "request", trigger: "user" }, () => {
      events.current()?.set({ http: { status: 200 } });
    });

    expect(recorded[0]).toMatchObject({ http: { status: 200 } });
  });
});

describe("the browser's synchronous scope", () => {
  it("leaves a unit's scope at its first await, and re-enters it around later work", async () => {
    const { events, recorded } = recordingEmitter();

    await events.run(
      "backlog.sync",
      { kind: "job", trigger: "schedule" },
      async (sync) => {
        await Promise.resolve();
        // After an await the sync is no longer active: this is its own event.
        events.run(
          "time_entry.update",
          { kind: "command", trigger: "system" },
          () => {},
        );
        sync.enter(() =>
          events.run(
            "time_entry.update",
            { kind: "command", trigger: "system" },
            () => {},
          ),
        );
      },
    );

    expect(recorded.map(({ name, steps }) => ({ name, steps }))).toEqual([
      { name: "time_entry.update", steps: undefined },
      { name: "backlog.sync", steps: ["time_entry.update"] },
    ]);
  });
});

describe("Node's async context", () => {
  it("keeps the unit active across awaits, so nested units fold after one", async () => {
    const { events, recorded } = recordingEmitter({
      scope: asyncContextScope(),
    });

    await events.run(
      "backlog.sync",
      { kind: "request", trigger: "system" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await events.run(
          "time_entry.update",
          { kind: "command", trigger: "system" },
          async (update) => {
            await Promise.resolve();
            update.count("store_write_count");
          },
        );
      },
    );
    // Two requests at once keep their own units.
    await Promise.all(
      ["a", "b"].map((id) =>
        events.run(
          "backlog.sync",
          { kind: "request", trigger: "system" },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            events.current()?.set({ connection: { id } });
          },
        ),
      ),
    );

    expect(recorded).toEqual([
      expect.objectContaining({
        name: "backlog.sync",
        steps: ["time_entry.update"],
        counts: { store_write_count: 1 },
      }),
      expect.objectContaining({ connection: { id: "a" } }),
      expect.objectContaining({ connection: { id: "b" } }),
    ]);
  });
});
