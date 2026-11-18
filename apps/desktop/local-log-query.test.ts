import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The diagnostics viewer's query service (#442): what main answers from the
// local log file's day files. Each test writes generated day files in a
// temporary folder and reads them back through the service, as main does.

const require = createRequire(import.meta.url);
const {
  createLocalLogQuery,
  INVALID_LOG_QUERY,
} = require("./electron/local-log-query.cjs");

type LoggedEvent = Record<string, unknown> & {
  name: string;
  span_id: string;
  trace_id: string;
  started_at: string;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function logFolder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ajour-log-query-"));
  temporaryDirectories.push(root);
  const directory = path.join(root, "logs", "events");
  await fs.mkdir(directory, { recursive: true });
  return { root, directory };
}

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const LAUNCH = "launch-now";

let spanCounter = 0;
/** A fresh span ID, 16 hex characters. */
function spanId() {
  spanCounter += 1;
  return spanCounter.toString(16).padStart(16, "0");
}
/** A trace ID, 32 hex characters, from a number. */
function traceId(seed: number) {
  return seed.toString(16).padStart(32, "0");
}

/** An event line as the local log file writes it, with what the test sets. */
function event(fields: Partial<LoggedEvent> & { name: string }): LoggedEvent {
  return {
    schema: 1,
    kind: "command",
    runtime: "renderer",
    outcome: "ok",
    started_at: new Date(NOW - 60_000).toISOString(),
    duration_ms: 10,
    trace_id: traceId(1),
    span_id: spanId(),
    launch_id: LAUNCH,
    trigger: "user",
    app: { version: "1.2.0", channel: "stable", packaged: true },
    device: { platform: "win32" },
    ...fields,
  } as LoggedEvent;
}

const dayOf = (time: string) => time.slice(0, 10);

/** Writes the events to their day files: the UTC day each started. */
async function writeEvents(directory: string, events: LoggedEvent[]) {
  const byDay = new Map<string, string[]>();
  for (const logged of events) {
    const day = dayOf(logged.started_at);
    byDay.set(day, [...(byDay.get(day) ?? []), JSON.stringify(logged)]);
  }
  for (const [day, lines] of byDay) {
    await fs.appendFile(
      path.join(directory, `${day}.ndjson`),
      lines.map((line) => `${line}\n`).join(""),
    );
  }
}

/** Appends the events to the day file of `day`, whatever day they started. */
async function appendToDay(
  directory: string,
  day: string,
  events: LoggedEvent[],
) {
  await fs.appendFile(
    path.join(directory, `${day}.ndjson`),
    events.map((logged) => `${JSON.stringify(logged)}\n`).join(""),
  );
}

function service(directory: string, options: Record<string, unknown> = {}) {
  return createLocalLogQuery({
    directory,
    launch: {
      launch_id: LAUNCH,
      started_at_ms: NOW - 2 * 60 * 60 * 1000,
    },
    now: () => NOW,
    ...options,
  });
}

const at = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * A fixture backlog sync: the renderer's job, the local API's request, the
 * plugin's operation and three broker requests, the last of which timed out.
 */
function backlogSync(seed: number, startOffset: number) {
  const trace = traceId(seed);
  const job = event({
    name: "backlog.sync",
    kind: "job",
    runtime: "renderer",
    trace_id: trace,
    started_at: at(startOffset),
    duration_ms: 900,
    outcome: "error",
    connection: { id: "connection-a" },
  });
  const request = event({
    name: "backlog.sync",
    kind: "request",
    runtime: "api",
    trace_id: trace,
    parent_span_id: job.span_id,
    started_at: at(startOffset - 10),
    duration_ms: 850,
    outcome: "error",
    connection: { id: "connection-a" },
  });
  const operation = event({
    name: "backlog.sync",
    kind: "plugin_operation",
    runtime: "api",
    trace_id: trace,
    parent_span_id: request.span_id,
    started_at: at(startOffset - 20),
    duration_ms: 800,
    outcome: "error",
    plugin: { id: "ajour.jira" },
    connection: { id: "connection-a" },
  });
  const brokers = [0, 1, 2].map((index) =>
    event({
      name: "plugin.request",
      kind: "job",
      runtime: "api",
      trace_id: trace,
      parent_span_id: operation.span_id,
      started_at: at(startOffset - 30 - index * 100),
      duration_ms: 50,
      outcome: index === 2 ? "timeout" : "ok",
      plugin: { id: "ajour.jira" },
      connection: { id: "connection-a" },
    }),
  );
  return { job, request, operation, brokers };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error("Expected the call to be refused.");
}

describe("logs.query", () => {
  it("answers the events newest first, filtered by each field", async () => {
    const { directory } = await logFolder();
    const sync = backlogSync(100, 30 * 60 * 1000);
    const others = [
      event({
        name: "time_entry.update",
        started_at: at(5 * 60 * 1000),
        trace_id: traceId(2),
      }),
      event({
        name: "time_entry.create",
        started_at: at(4 * 60 * 1000),
        trace_id: traceId(3),
        outcome: "refused",
        outcome_reason: "locked_week",
      }),
      event({
        name: "update.check",
        kind: "ipc",
        runtime: "main",
        started_at: at(3 * 60 * 1000),
        trace_id: traceId(4),
        launch_id: "launch-before",
      }),
      event({
        name: "app.launch",
        kind: "lifecycle",
        runtime: "main",
        started_at: at(2 * DAY),
        trace_id: traceId(5),
        launch_id: "launch-before",
        outcome: "noop",
      }),
    ];
    await writeEvents(directory, [
      sync.job,
      sync.request,
      sync.operation,
      ...sync.brokers,
      ...others,
    ]);
    const logs = service(directory);
    const names = async (filter: Record<string, unknown>) =>
      (await logs.query(filter)).events.map(
        ({ name, runtime }: LoggedEvent) => `${runtime}:${name}`,
      );

    const all = await logs.query({});
    expect(all.events).toHaveLength(10);
    expect(all.match_count).toBe(10);
    const times = all.events.map(({ started_at }: LoggedEvent) =>
      Date.parse(started_at),
    );
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(all.events[0]).toEqual(others[2]);

    expect(await names({ from: at(10 * 60 * 1000) })).toEqual([
      "main:update.check",
      "renderer:time_entry.create",
      "renderer:time_entry.update",
    ]);
    expect(await names({ from: at(3 * DAY), to: at(DAY) })).toEqual([
      "main:app.launch",
    ]);
    expect(await names({ launch_id: "launch-before" })).toEqual([
      "main:update.check",
      "main:app.launch",
    ]);
    expect(await names({ runtime: "main" })).toEqual([
      "main:update.check",
      "main:app.launch",
    ]);
    expect(await names({ runtime: ["api"], kind: "plugin_operation" })).toEqual(
      ["api:backlog.sync"],
    );
    expect(await names({ kind: ["ipc", "lifecycle"] })).toEqual([
      "main:update.check",
      "main:app.launch",
    ]);
    expect(await names({ outcome: "refused" })).toEqual([
      "renderer:time_entry.create",
    ]);
    // Problems only: anything not ok or noop.
    expect(await names({ outcome: "problems" })).toEqual([
      "renderer:time_entry.create",
      "api:plugin.request",
      "api:backlog.sync",
      "api:backlog.sync",
      "renderer:backlog.sync",
    ]);
    expect(await names({ name: "time_entry.update" })).toEqual([
      "renderer:time_entry.update",
    ]);
    expect(await names({ name_prefix: "time_entry." })).toEqual([
      "renderer:time_entry.create",
      "renderer:time_entry.update",
    ]);
    expect(await names({ trace_id: traceId(100) })).toHaveLength(6);
    expect(await names({ connection_id: "connection-a" })).toHaveLength(6);
    expect(await names({ plugin_id: "ajour.jira" })).toEqual([
      "api:plugin.request",
      "api:plugin.request",
      "api:plugin.request",
      "api:backlog.sync",
    ]);
    expect(
      await names({ plugin_id: "ajour.jira", outcome: "problems" }),
    ).toEqual(["api:plugin.request", "api:backlog.sync"]);
  });

  it("filters on one outcome_reason or several, as the Overview's links ask", async () => {
    const { directory } = await logFolder();
    await writeEvents(directory, [
      event({
        name: "time_entry.create",
        started_at: at(3 * 60 * 1000),
        outcome: "refused",
        outcome_reason: "locked_week",
      }),
      event({
        name: "backlog.sync",
        kind: "plugin_operation",
        runtime: "api",
        started_at: at(2 * 60 * 1000),
        outcome: "timeout",
        outcome_reason: "timeout",
      }),
      event({
        name: "backlog.sync",
        kind: "plugin_operation",
        runtime: "api",
        started_at: at(60 * 1000),
        outcome: "refused",
        outcome_reason: "capacity",
      }),
      event({ name: "time_entry.update", started_at: at(30 * 1000) }),
    ]);
    const logs = service(directory);
    const reasons = async (filter: Record<string, unknown>) =>
      (await logs.query(filter)).events.map(
        (logged: LoggedEvent) => logged.outcome_reason,
      );

    expect(await reasons({ outcome_reason: "locked_week" })).toEqual([
      "locked_week",
    ]);
    expect(
      await reasons({
        kind: "plugin_operation",
        outcome_reason: ["timeout", "capacity", "crashed"],
      }),
    ).toEqual(["capacity", "timeout"]);
    for (const refused of [
      { outcome_reason: "../x" },
      { outcome_reason: [] },
      { outcome_reason: ["timeout", 3] },
    ]) {
      expect((await rejection(logs.query(refused))).code).toBe(
        INVALID_LOG_QUERY,
      );
    }
  });

  it("refuses an outcome_reason list with an element outside its format, holes too, in a query and a tail", async () => {
    const { directory } = await logFolder();
    await writeEvents(directory, [event({ name: "time_entry.update" })]);
    const logs = service(directory);
    // A hole, read as undefined.
    const sparse = [, "timeout"];
    for (const outcome_reason of [[undefined], sparse, new Array(2)]) {
      expect((await rejection(logs.query({ outcome_reason }))).code).toBe(
        INVALID_LOG_QUERY,
      );
      expect(() => logs.subscribe({}, 1, { outcome_reason }, () => {})).toThrow(
        expect.objectContaining({ code: INVALID_LOG_QUERY }),
      );
    }
  });

  it("filters on the events without a reason when outcome_reason is null", async () => {
    const { directory } = await logFolder();
    await writeEvents(directory, [
      event({
        name: "backlog.sync",
        started_at: at(2 * 60 * 1000),
        outcome: "error",
        outcome_reason: "secret_unavailable",
      }),
      event({
        name: "backlog.sync",
        started_at: at(60 * 1000),
        outcome: "error",
      }),
    ]);
    const logs = service(directory);
    const { events } = await logs.query({
      name: "backlog.sync",
      outcome: ["error"],
      outcome_reason: null,
    });
    expect(
      events.map((logged: LoggedEvent) => logged.outcome_reason ?? "none"),
    ).toEqual(["none"]);
  });

  it("filters on a plugin's version, in its format", async () => {
    const { directory } = await logFolder();
    const operation = (version: string, offset: number) =>
      event({
        name: "backlog.sync",
        kind: "plugin_operation",
        runtime: "api",
        started_at: at(offset),
        outcome: "timeout",
        outcome_reason: "timeout",
        plugin: { id: "ajour.jira", version },
      });
    // A manifest's version may run to 80 characters.
    const long = "1.0.0-" + "a".repeat(74);
    await writeEvents(directory, [
      operation("2.0.0", 3 * 60 * 1000),
      operation("2.1.0-beta.1", 2 * 60 * 1000),
      operation(long, 60 * 1000),
    ]);
    const logs = service(directory);
    const versions = async (plugin_version: string) =>
      (
        await logs.query({ plugin_id: "ajour.jira", plugin_version })
      ).events.map(
        (logged: LoggedEvent) => (logged.plugin as { version: string }).version,
      );
    expect(await versions("2.0.0")).toEqual(["2.0.0"]);
    expect(await versions("2.1.0-beta.1")).toEqual(["2.1.0-beta.1"]);
    expect(await versions(long)).toEqual([long]);
    expect((await rejection(logs.query({ plugin_version: "2 0" }))).code).toBe(
      INVALID_LOG_QUERY,
    );
    expect(
      (await rejection(logs.query({ plugin_version: `${long}a` }))).code,
    ).toBe(INVALID_LOG_QUERY);
  });

  it("pages the results with a cursor, each event once", async () => {
    const { directory } = await logFolder();
    const events = Array.from({ length: 250 }, (_, index) =>
      event({
        name: "time_entry.update",
        // Across three days, with some sharing a start time.
        started_at: at(Math.floor(index / 2) * 30 * 60 * 1000),
        trace_id: traceId(1000 + index),
      }),
    );
    await writeEvents(directory, events);
    const logs = service(directory);

    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await logs.query({}, { limit: 100, cursor });
      seen.push(...page.events.map(({ span_id }: LoggedEvent) => span_id));
      expect(page.match_count).toBe(250);
      cursor = page.next_cursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(250);
    expect(seen).toHaveLength(250);
    // The default page is 100, and none holds more than 500.
    expect((await logs.query({})).events).toHaveLength(100);
    expect((await rejection(logs.query({}, { limit: 501 }))).code).toBe(
      INVALID_LOG_QUERY,
    );
  });

  it("skips and counts malformed lines and missing files, and never fails", async () => {
    const { directory } = await logFolder();
    const good = event({ name: "time_entry.update", started_at: at(HOUR) });
    await fs.writeFile(
      path.join(directory, `${dayOf(good.started_at)}.ndjson`),
      [
        "{not json",
        JSON.stringify(good),
        "[1, 2, 3]",
        JSON.stringify({ name: "time_entry.update" }),
        "",
        '"a string"',
      ].join("\n") + "\n",
    );
    const logs = service(directory);

    // Seven days asked, one file there.
    const result = await logs.query({ from: at(6 * DAY + HOUR) });
    expect(result.events).toEqual([good]);
    expect(result.skipped_line_count).toBe(4);
    expect(result.file_count).toBe(1);
    expect(result.missing_file_count).toBe(6);

    // A folder that doesn't exist answers nothing.
    const none = service(path.join(directory, "missing"));
    const empty = await none.query({ from: at(DAY) });
    expect(empty.events).toEqual([]);
    expect(empty.missing_file_count).toBe(2);
    expect((await none.aggregate({ range: "7d" })).counts).toEqual([]);
    expect((await none.trace(traceId(9))).roots).toEqual([]);
    expect((await none.actions({})).actions).toEqual([]);
  });

  it("follows a day file as it grows, and rebuilds one that was replaced", async () => {
    const { directory } = await logFolder();
    const first = event({ name: "time_entry.update", started_at: at(HOUR) });
    await writeEvents(directory, [first]);
    const logs = service(directory);
    expect((await logs.query({})).events).toEqual([first]);

    // A line half written is left until its end arrives.
    const second = event({ name: "time_entry.create", started_at: at(30_000) });
    const file = path.join(directory, `${dayOf(first.started_at)}.ndjson`);
    const line = JSON.stringify(second);
    await fs.appendFile(file, line.slice(0, 20));
    const partial = await logs.query({});
    expect(partial.events).toEqual([first]);
    expect(partial.skipped_line_count).toBe(0);
    await fs.appendFile(file, `${line.slice(20)}\n`);
    expect((await logs.query({})).events).toEqual([second, first]);

    // Deleted and written again: the index starts over.
    const third = event({ name: "update.check", started_at: at(10_000) });
    await fs.rm(file);
    await fs.writeFile(file, `${JSON.stringify(third)}\n`);
    expect((await logs.query({})).events).toEqual([third]);
  });

  it("reads a day file again only for what was appended", async () => {
    const { directory } = await logFolder();
    await writeEvents(
      directory,
      Array.from({ length: 50 }, (_, index) =>
        event({ name: "time_entry.update", started_at: at(index * 1000) }),
      ),
    );
    const bytesRead: number[] = [];
    const counting = {
      ...fs,
      open: async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        const read = handle.read.bind(handle);
        return Object.assign(handle, {
          read: async (...readArgs: Parameters<typeof handle.read>) => {
            const result = await read(...readArgs);
            bytesRead.push(result.bytesRead);
            return result;
          },
        });
      },
    };
    const logs = service(directory, { fs: counting });
    await logs.query({ name: "nothing.matches" });
    const firstRead = bytesRead.reduce((sum, bytes) => sum + bytes, 0);
    expect(firstRead).toBeGreaterThan(0);
    bytesRead.length = 0;
    await logs.query({ name: "nothing.matches" });
    expect(bytesRead.reduce((sum, bytes) => sum + bytes, 0)).toBe(0);
  });

  it("reads an event a quit wrote twice once, in queries, actions, aggregates and traces", async () => {
    const { directory } = await logFolder();
    const sync = backlogSync(110, HOUR);
    const other = event({
      name: "time_entry.update",
      trace_id: traceId(111),
      started_at: at(30 * 60 * 1000),
    });
    const day = dayOf(sync.job.started_at);
    // The quit's drain rewrote a batch whose append had already landed.
    await appendToDay(directory, day, [sync.job, sync.request, other]);
    await appendToDay(directory, day, [sync.job, sync.request, other]);
    await appendToDay(directory, day, [sync.operation, ...sync.brokers]);
    const logs = service(directory);

    const all = await logs.query({});
    expect(all.match_count).toBe(7);
    expect(
      all.events.filter(
        ({ span_id }: LoggedEvent) => span_id === sync.job.span_id,
      ),
    ).toHaveLength(1);
    expect(all.skipped_line_count).toBe(0);

    const actions = await logs.actions({ show: "all" });
    expect(
      actions.actions.map(({ event: root }: { event: LoggedEvent }) => root),
    ).toEqual([other, sync.job]);
    expect(actions.actions[1]).toMatchObject({
      span_count: 6,
      problem_count: 4,
    });

    const week = await logs.aggregate({ range: "7d" });
    expect(week.counts).toContainEqual({
      name: "time_entry.update",
      outcome: "ok",
      count: 1,
    });
    expect(week.counts).toContainEqual({
      name: "backlog.sync",
      outcome: "error",
      count: 3,
    });

    const trace = await logs.trace(traceId(110));
    expect(trace.event_count).toBe(6);
    expect(trace.roots).toHaveLength(1);
    expect(trace.roots[0].children).toHaveLength(1);
  });

  it("keeps a renderer event that reuses a main event's IDs beside it", async () => {
    const { directory } = await logFolder();
    const trace = traceId(120);
    const shared = "b000000000000001";
    // The renderer chose IDs a main event already has, and started first.
    const renderer = event({
      name: "route.change",
      kind: "navigation",
      runtime: "renderer",
      trace_id: trace,
      span_id: shared,
      started_at: at(HOUR + 1000),
    });
    const main = event({
      name: "update.check",
      kind: "ipc",
      runtime: "main",
      trace_id: trace,
      span_id: shared,
      started_at: at(HOUR),
      outcome: "error",
    });
    const request = event({
      name: "update.check",
      kind: "request",
      runtime: "api",
      trace_id: trace,
      parent_span_id: shared,
      started_at: at(HOUR - 10),
    });
    await writeEvents(directory, [renderer, main, request]);
    const logs = service(directory);

    const all = await logs.query({ trace_id: trace });
    expect(all.events).toEqual([request, main, renderer]);
    expect((await logs.query({ runtime: "main" })).events).toEqual([main]);
    expect(
      (await logs.actions({ show: "failed" })).actions.map(
        ({ event: root }: { event: LoggedEvent }) => root,
      ),
    ).toEqual([main, renderer]);
    expect((await logs.aggregate({ range: "24h" })).counts).toContainEqual({
      name: "update.check",
      outcome: "error",
      count: 1,
    });

    const result = await logs.trace(trace);
    expect(result.event_count).toBe(3);
    expect(result.runtimes).toEqual(["renderer", "main", "api"]);
    expect(
      result.roots.map(({ event: root }: { event: LoggedEvent }) => root),
    ).toEqual([renderer, main]);
    // The API's request is the main event's child, not the renderer's.
    expect(result.roots[0].children).toEqual([]);
    expect(
      result.roots[1].children.map(
        ({ event: child }: { event: LoggedEvent }) => child,
      ),
    ).toEqual([request]);
    expect(result.deepest_failure_span_id).toBe(shared);
    expect(result.roots[1].deepest_failure).toBe(true);
  });

  it("finds an event that started in the range and was written the next day", async () => {
    const { directory } = await logFolder();
    const midnight = Date.parse("2026-11-16T00:00:00.000Z");
    const lateSync = event({
      name: "backlog.sync",
      started_at: new Date(midnight - 1000).toISOString(),
      duration_ms: 5000,
    });
    const afterRange = event({
      name: "time_entry.update",
      started_at: new Date(midnight + 1000).toISOString(),
    });
    // Both were written after midnight, to the next day's file.
    await appendToDay(directory, "2026-11-16", [lateSync, afterRange]);
    const logs = service(directory);

    // The range is the 15th alone, which has no file of its own.
    const result = await logs.query({
      from: "2026-11-15T00:00:00.000Z",
      to: "2026-11-15T23:59:59.500Z",
    });
    expect(result.events).toEqual([lateSync]);
    expect(result.file_count).toBe(1);
    expect(result.missing_file_count).toBe(1);
    // A day after the end with no file isn't missing.
    const before = await logs.query({
      from: "2026-11-13T00:00:00.000Z",
      to: "2026-11-13T23:00:00.000Z",
    });
    expect(before.events).toEqual([]);
    expect(before.missing_file_count).toBe(1);
  });

  it("counts the days of a wide range without looking for each one", async () => {
    const { directory } = await logFolder();
    const only = event({ name: "time_entry.update", started_at: at(HOUR) });
    await writeEvents(directory, [only]);
    const looked: string[] = [];
    const watching = {
      ...fs,
      lstat: (file: string) => {
        looked.push(file);
        return fs.lstat(file);
      },
    };
    const logs = service(directory, { fs: watching });

    const result = await logs.query({ from: "0001-01-01T00:00:00.000Z" });
    expect(result.events).toEqual([only]);
    expect(result.file_count).toBe(1);
    expect(result.missing_file_count).toBe(
      (Date.parse("2026-11-17T00:00:00.000Z") -
        Date.parse("0001-01-01T00:00:00.000Z")) /
        DAY,
    );
    expect(looked).toHaveLength(1);

    const empty = service(path.join(directory, "missing"), { fs: watching });
    looked.length = 0;
    expect(
      (await empty.query({ from: "1000-01-01T00:00:00.000Z" }))
        .missing_file_count,
    ).toBe(
      (Date.parse("2026-11-17T00:00:00.000Z") -
        Date.parse("1000-01-01T00:00:00.000Z")) /
        DAY +
        1,
    );
    expect(looked).toEqual([]);
  });
});

describe("what the renderer can make main read", () => {
  it("refuses a path, an unknown key, or a value outside its format", async () => {
    const { directory } = await logFolder();
    const logs = service(directory);
    const refused = [
      () => logs.query({ path: "../../secrets" }),
      () => logs.query({ file: "C:\\Windows\\win.ini" }),
      () => logs.query({ directory: "/etc" }),
      () => logs.query({ from: "../../../etc/passwd" }),
      () => logs.query({ to: "2026-11-17/../../x" }),
      () => logs.query({ runtime: "renderer; rm -rf" }),
      () => logs.query({ kind: ["job", "file"] }),
      () => logs.query({ outcome: "everything" }),
      () => logs.query({ name: "time_entry.update || true" }),
      () => logs.query({ name_prefix: "../" }),
      () => logs.query({ trace_id: "not-a-trace" }),
      () => logs.query({ where: "outcome = 'error'" }),
      () => logs.query({ match: () => true }),
      () => logs.query(new Date() as never),
      () => logs.query(Object.create({ from: at(DAY) })),
      () => logs.query("2026-11-17.ndjson" as never),
      () => logs.query({}, { cursor: "../../2026-11-17.ndjson" }),
      () => logs.query({}, { cursor: "1:../x:3" }),
      () => logs.query({}, { offset: 10 }),
      () => logs.trace("../2026-11-17.ndjson"),
      () => logs.actions({ show: "everything" }),
      () => logs.aggregate({ range: "../.." }),
      () => logs.aggregate({ range: "24h", day: "2026-11-17" }),
    ];
    for (const call of refused) {
      expect((await rejection(call())).code).toBe(INVALID_LOG_QUERY);
    }
  });

  it("opens only the day files of the log folder", async () => {
    const { root, directory } = await logFolder();
    const inside = event({ name: "time_entry.update", started_at: at(HOUR) });
    await writeEvents(directory, [inside]);
    // Lines that look like events, where no day file belongs.
    const outside = event({ name: "outside.read", started_at: at(HOUR) });
    const day = dayOf(inside.started_at);
    await fs.writeFile(
      path.join(root, `${day}.ndjson`),
      `${JSON.stringify(outside)}\n`,
    );
    await fs.writeFile(
      path.join(directory, `${day}.ndjson.bak`),
      `${JSON.stringify(outside)}\n`,
    );
    await fs.writeFile(
      path.join(directory, "notes.ndjson"),
      `${JSON.stringify(outside)}\n`,
    );
    await fs.mkdir(path.join(directory, "2026-11-01.ndjson"));
    const opened: string[] = [];
    const watching = {
      ...fs,
      open: (file: string, ...rest: unknown[]) => {
        opened.push(path.resolve(file));
        return (fs.open as (...args: unknown[]) => unknown)(file, ...rest);
      },
    };
    const logs = service(directory, { fs: watching });

    const results = [
      (await logs.query({})).events,
      (await logs.query({ from: at(30 * DAY) })).events,
      (await logs.actions({ show: "all" })).actions.map(
        ({ event: root }: { event: LoggedEvent }) => root,
      ),
      (await logs.aggregate({ range: "7d" })).counts,
    ];
    expect(JSON.stringify(results)).not.toContain("outside.read");
    expect(opened.length).toBeGreaterThan(0);
    for (const file of opened) {
      expect(path.dirname(file)).toBe(path.resolve(directory));
      expect(path.basename(file)).toMatch(/^\d{4}-\d{2}-\d{2}\.ndjson$/);
    }
  });
});

describe("logs.trace", () => {
  it("builds a fixture backlog sync's tree from parent_span_id, and marks the deepest failure", async () => {
    const { directory } = await logFolder();
    const sync = backlogSync(200, HOUR);
    const unrelated = backlogSync(201, 2 * HOUR);
    await writeEvents(directory, [
      // Written out of order, as runtimes end at different times.
      ...sync.brokers,
      sync.operation,
      sync.request,
      sync.job,
      unrelated.job,
    ]);
    const logs = service(directory);

    const trace = await logs.trace(traceId(200));
    expect(trace.event_count).toBe(6);
    expect(trace.roots).toHaveLength(1);
    const [job] = trace.roots;
    expect(job.event).toEqual(sync.job);
    expect(job.depth).toBe(0);
    expect(
      job.children.map(({ event: child }: { event: LoggedEvent }) => child),
    ).toEqual([sync.request]);
    const [request] = job.children;
    expect(
      request.children.map(({ event: child }: { event: LoggedEvent }) => child),
    ).toEqual([sync.operation]);
    const [operation] = request.children;
    expect(operation.depth).toBe(2);
    // The broker requests, in the order they started.
    expect(
      operation.children.map(
        ({ event: child }: { event: LoggedEvent }) => child,
      ),
    ).toEqual([sync.brokers[0], sync.brokers[1], sync.brokers[2]]);
    const timedOut = operation.children[2];
    expect(timedOut.depth).toBe(3);

    // The broker request that timed out is the deepest failed span.
    expect(trace.deepest_failure_span_id).toBe(sync.brokers[2]!.span_id);
    expect(timedOut.deepest_failure).toBe(true);
    const marked: string[] = [];
    const walk = (node: {
      event: LoggedEvent;
      deepest_failure: boolean;
      children: unknown[];
    }) => {
      if (node.deepest_failure) marked.push(node.event.span_id);
      node.children.forEach((child) => walk(child as typeof node));
    };
    trace.roots.forEach(walk);
    expect(marked).toEqual([sync.brokers[2]!.span_id]);
  });

  it("joins a trace across three runtimes and two day files", async () => {
    const { directory } = await logFolder();
    const trace = traceId(300);
    const midnight = Date.parse("2026-11-16T00:00:00.000Z");
    const command = event({
      name: "plugin.install",
      kind: "command",
      runtime: "renderer",
      trace_id: trace,
      started_at: new Date(midnight - 500).toISOString(),
      duration_ms: 900,
    });
    const ipc = event({
      name: "plugin.install",
      kind: "ipc",
      runtime: "main",
      trace_id: trace,
      parent_span_id: command.span_id,
      started_at: new Date(midnight - 400).toISOString(),
      duration_ms: 700,
    });
    const request = event({
      name: "plugin.install",
      kind: "request",
      runtime: "api",
      trace_id: trace,
      parent_span_id: ipc.span_id,
      started_at: new Date(midnight + 100).toISOString(),
      duration_ms: 100,
    });
    // A span whose parent was never written: it stays, as a root of its own.
    const orphan = event({
      name: "app.error",
      kind: "crash",
      runtime: "renderer",
      outcome: "error",
      trace_id: trace,
      parent_span_id: "ffffffffffffffff",
      started_at: new Date(midnight + 200).toISOString(),
    });
    await writeEvents(directory, [command, ipc, request, orphan]);
    const logs = service(directory);

    const result = await logs.trace(trace);
    expect(result.runtimes).toEqual(["renderer", "main", "api"]);
    expect(result.event_count).toBe(4);
    expect(
      result.roots.map(({ event: root }: { event: LoggedEvent }) => root),
    ).toEqual([command, orphan]);
    expect(result.roots[1].missing_parent).toBe(true);
    expect(result.roots[0].children[0].event).toEqual(ipc);
    expect(result.roots[0].children[0].children[0].event).toEqual(request);
    expect(result.deepest_failure_span_id).toBe(orphan.span_id);

    expect(await logs.trace(traceId(301))).toMatchObject({
      roots: [],
      event_count: 0,
      deepest_failure_span_id: null,
    });
  });

  it("breaks a cycle of parents, which no runtime writes, into a root", async () => {
    const { directory } = await logFolder();
    const trace = traceId(302);
    const first = event({
      name: "backlog.sync",
      trace_id: trace,
      span_id: "a000000000000001",
      parent_span_id: "a000000000000002",
      started_at: at(HOUR),
    });
    const second = event({
      name: "backlog.sync",
      trace_id: trace,
      span_id: "a000000000000002",
      parent_span_id: "a000000000000001",
      started_at: at(HOUR - 10),
    });
    await writeEvents(directory, [first, second]);

    const result = await service(directory).trace(trace);

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toMatchObject({
      event: first,
      depth: 0,
      missing_parent: true,
    });
    expect(result.roots[0].children).toMatchObject([
      { event: second, depth: 1, children: [] },
    ]);
  });

  it("gathers a trace spread over three day files, searching each once", async () => {
    const { directory } = await logFolder();
    const sync = backlogSync(303, 0);
    // A long job: the spans that ended first were written two days before
    // the root, the failure deepest in the tree with them.
    await appendToDay(directory, "2026-11-14", [...sync.brokers]);
    await appendToDay(directory, "2026-11-15", [sync.operation]);
    await appendToDay(directory, "2026-11-16", [sync.request, sync.job]);
    // A newer day without the trace, and an older one.
    await appendToDay(directory, "2026-11-17", [
      event({ name: "time_entry.update", trace_id: traceId(304) }),
    ]);
    await appendToDay(directory, "2026-11-10", [
      event({ name: "time_entry.update", trace_id: traceId(305) }),
    ]);
    const logs = service(directory);

    const result = await logs.trace(traceId(303));
    expect(result.event_count).toBe(6);
    expect(result.file_count).toBe(5);
    expect(
      result.roots.map(({ event: root }: { event: LoggedEvent }) => root),
    ).toEqual([sync.job]);
    expect(result.deepest_failure_span_id).toBe(sync.brokers[2]!.span_id);
  });

  it("finds a trace in a day file older than the indexes kept", async () => {
    const { directory } = await logFolder();
    const old = backlogSync(306, 40 * DAY);
    await writeEvents(directory, [
      old.job,
      old.request,
      old.operation,
      ...old.brokers,
    ]);
    for (let day = 0; day < 35; day += 1) {
      await writeEvents(directory, [
        event({
          name: "time_entry.update",
          trace_id: traceId(2000 + day),
          started_at: at(day * DAY),
        }),
      ]);
    }
    const logs = service(directory);
    // The recent days are indexed first, as the viewer opens on them.
    await logs.query({ from: at(30 * DAY) });

    const result = await logs.trace(traceId(306));
    expect(result.event_count).toBe(6);
    expect(result.file_count).toBe(36);
    expect(result.roots[0].event).toEqual(old.job);
    expect(result.deepest_failure_span_id).toBe(old.brokers[2]!.span_id);
  });

  it("keeps the recent days indexed after reading an older day for a trace", async () => {
    const { directory } = await logFolder();
    const old = backlogSync(307, 40 * DAY);
    await writeEvents(directory, [old.job, old.request, old.operation]);
    for (let day = 0; day < 35; day += 1) {
      await writeEvents(directory, [
        event({
          name: "time_entry.update",
          trace_id: traceId(3000 + day),
          started_at: at(day * DAY),
        }),
      ]);
    }
    let bytes = 0;
    const counting = {
      ...fs,
      open: async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        const read = handle.read.bind(handle);
        return Object.assign(handle, {
          read: async (...readArgs: Parameters<typeof handle.read>) => {
            const result = await read(...readArgs);
            bytes += result.bytesRead;
            return result;
          },
        });
      },
    };
    const logs = service(directory, { fs: counting });
    await logs.query({ from: at(30 * DAY), name: "nothing.matches" });
    expect((await logs.trace(traceId(307))).event_count).toBe(3);

    bytes = 0;
    // No row matches, so only indexing would read.
    await logs.query({ from: at(30 * DAY), name: "nothing.matches" });
    expect(bytes).toBe(0);
  });
});

describe("logs.actions", () => {
  it("takes no outcome_reason or plugin_version, which only logs.query and logs.tail filter on", async () => {
    const { directory } = await logFolder();
    const logs = service(directory);
    for (const filter of [
      { outcome_reason: "timeout" },
      { plugin_version: "1.0.0" },
    ]) {
      expect(
        (await rejection(logs.actions({ show: "all", ...filter }))).code,
      ).toBe(INVALID_LOG_QUERY);
      expect(() => logs.subscribe({}, 1, filter, () => {})).not.toThrow();
    }
  });

  it("lists one row per trace root, with All, Failed and Slow", async () => {
    const { directory } = await logFolder();
    const failing = backlogSync(400, HOUR);
    const roots = Array.from({ length: 40 }, (_, index) =>
      event({
        name: "time_entry.update",
        trace_id: traceId(500 + index),
        started_at: at(2 * HOUR + index * 1000),
        // 1 to 40 ms: the p95 is 38 ms, so 38, 39 and 40 are slow. The
        // longer ones started earlier.
        duration_ms: index + 1,
      }),
    );
    // A child in a root's trace: it is not a row of its own.
    const child = event({
      name: "update.check",
      kind: "ipc",
      runtime: "main",
      trace_id: traceId(500),
      parent_span_id: roots[0]!.span_id,
      started_at: at(2 * HOUR - 5),
    });
    await writeEvents(directory, [
      failing.job,
      failing.request,
      failing.operation,
      ...failing.brokers,
      ...roots,
      child,
    ]);
    const logs = service(directory);

    const all = await logs.actions({ show: "all" });
    expect(all.match_count).toBe(41);
    expect(all.actions[0].event).toEqual(failing.job);
    expect(all.actions[0]).toMatchObject({
      span_count: 6,
      problem_count: 4,
      runtimes: ["renderer", "api"],
    });
    const withChild = all.actions.find(
      ({ event: root }: { event: LoggedEvent }) =>
        root.span_id === roots[0]!.span_id,
    );
    expect(withChild).toMatchObject({ span_count: 2, problem_count: 0 });

    const failed = await logs.actions({ show: "failed" });
    expect(
      failed.actions.map(({ event: root }: { event: LoggedEvent }) => root),
    ).toEqual([failing.job]);

    const slow = await logs.actions({ show: "slow" });
    expect(
      slow.actions.map(
        ({ event: root }: { event: LoggedEvent }) => root.duration_ms,
      ),
    ).toEqual([38, 39, 40]);
    expect(slow.actions[0]).toMatchObject({ slow: true, p95_ms: 38 });
    // A name with too few roots has no p95 to be slow against.
    expect(
      slow.actions.some(
        ({ event: root }: { event: LoggedEvent }) =>
          root.name === "backlog.sync",
      ),
    ).toBe(false);

    const paged = await logs.actions({ show: "all" }, { limit: 30 });
    expect(paged.actions).toHaveLength(30);
    const rest = await logs.actions(
      { show: "all" },
      { limit: 30, cursor: paged.next_cursor },
    );
    expect(rest.actions).toHaveLength(11);
    expect(rest.next_cursor).toBeNull();
  });

  it("calls the slowest of a few runs slow, but never a name run once", async () => {
    const { directory } = await logFolder();
    const runs = [...Array.from({ length: 9 }, () => 100), 5000].map(
      (duration_ms, index) =>
        event({
          name: "calendar.fetch",
          trace_id: traceId(800 + index),
          started_at: at((index + 1) * 60_000),
          duration_ms,
        }),
    );
    const lone = event({
      name: "backlog.sync",
      trace_id: traceId(820),
      started_at: at(30_000),
      duration_ms: 9000,
    });
    await writeEvents(directory, [...runs, lone]);
    const slow = await service(directory).actions({ show: "slow" });
    expect(
      slow.actions.map(
        ({ event: root }: { event: LoggedEvent }) => root.trace_id,
      ),
    ).toEqual([traceId(809)]);
  });

  it("computes Slow's p95 from the roots that started inside the range", async () => {
    const { directory } = await logFolder();
    const to = Date.parse("2026-11-17T06:00:00.000Z");
    // Inside: 1 to 20 ms, so the p95 is 19 ms.
    const inside = Array.from({ length: 20 }, (_, index) =>
      event({
        name: "calendar.fetch",
        trace_id: traceId(600 + index),
        started_at: new Date(to - (index + 1) * 60_000).toISOString(),
        duration_ms: index + 1,
      }),
    );
    // At or after the range's end, on its last day: far longer.
    const after = Array.from({ length: 20 }, (_, index) =>
      event({
        name: "calendar.fetch",
        trace_id: traceId(700 + index),
        started_at: new Date(to + index * 60_000).toISOString(),
        duration_ms: 5000,
      }),
    );
    await writeEvents(directory, [...inside, ...after]);
    const logs = service(directory);

    const slow = await logs.actions({
      show: "slow",
      from: "2026-11-17T00:00:00.000Z",
      to: new Date(to).toISOString(),
    });
    expect(
      slow.actions.map(
        ({ event: root }: { event: LoggedEvent }) => root.duration_ms,
      ),
    ).toEqual([19, 20]);
    expect(slow.actions[0]).toMatchObject({ slow: true, p95_ms: 19 });
  });
});

describe("logs.aggregate", () => {
  it("answers the Overview's counts, problems per hour, durations, launch and crashes", async () => {
    const { directory } = await logFolder();
    const launchBefore = event({
      name: "app.launch",
      kind: "lifecycle",
      runtime: "main",
      launch_id: "launch-before",
      started_at: at(3 * DAY),
      launch: { ready_ms: 900, api_start_ms: 300 },
    });
    const launchNow = event({
      name: "app.launch",
      kind: "lifecycle",
      runtime: "main",
      started_at: at(2 * HOUR - 1000),
      duration_ms: 1800,
      launch: {
        ready_ms: 400,
        api_start_ms: 200,
        window_ms: 600,
        renderer_load_ms: 500,
        renderer_source: "app_protocol",
      },
    });
    const updates = [10, 20, 30, 40].map((duration, index) =>
      event({
        name: "time_entry.update",
        started_at: at(HOUR + index * 1000),
        duration_ms: duration,
      }),
    );
    const refused = [0, 1].map((index) =>
      event({
        name: "time_entry.update",
        started_at: at(30 * 60 * 1000 + index * 1000),
        duration_ms: 5,
        outcome: "refused",
        outcome_reason: "locked_week",
      }),
    );
    const crash = event({
      name: "process.gone",
      kind: "crash",
      runtime: "main",
      outcome: "error",
      started_at: at(10 * 60 * 1000),
    });
    const oldCrash = event({
      name: "app.error",
      kind: "crash",
      runtime: "renderer",
      outcome: "error",
      launch_id: "launch-before",
      started_at: at(5 * DAY),
    });
    const tooOld = event({
      name: "time_entry.update",
      started_at: at(8 * DAY),
      outcome: "error",
    });
    await writeEvents(directory, [
      tooOld,
      oldCrash,
      launchBefore,
      launchNow,
      ...updates,
      ...refused,
      crash,
    ]);
    const logs = service(directory);

    const week = await logs.aggregate({ range: "7d" });
    expect(week.counts).toEqual([
      { name: "time_entry.update", outcome: "ok", count: 4 },
      {
        name: "app.launch",
        outcome: "ok",
        count: 2,
      },
      {
        name: "time_entry.update",
        outcome: "refused",
        outcome_reason: "locked_week",
        count: 2,
      },
      { name: "app.error", outcome: "error", count: 1 },
      { name: "process.gone", outcome: "error", count: 1 },
    ]);
    expect(week.durations).toContainEqual({
      name: "time_entry.update",
      count: 6,
      p50_ms: 10,
      p95_ms: 40,
    });
    expect(week.latest_launch).toEqual(launchNow);
    expect(week.crash_count).toBe(2);
    expect(week.crashes).toEqual([crash, oldCrash]);
    // One bucket per hour of the range, oldest first.
    expect(week.problems_per_hour).toHaveLength(7 * 24 + 1);
    const withProblems = week.problems_per_hour.filter(
      ({ counts }: { counts: Record<string, number> }) =>
        Object.keys(counts).length > 0,
    );
    expect(withProblems).toEqual([
      { hour: "2026-11-12T12:00:00.000Z", counts: { error: 1 } },
      { hour: "2026-11-17T11:00:00.000Z", counts: { refused: 2, error: 1 } },
    ]);

    const day = await logs.aggregate({ range: "24h" });
    expect(day.crashes).toEqual([crash]);
    expect(day.latest_launch).toEqual(launchNow);

    // This launch: only its own events.
    const launch = await logs.aggregate({ range: "launch" });
    expect(launch.counts).toEqual([
      { name: "time_entry.update", outcome: "ok", count: 4 },
      {
        name: "time_entry.update",
        outcome: "refused",
        outcome_reason: "locked_week",
        count: 2,
      },
      { name: "app.launch", outcome: "ok", count: 1 },
      { name: "process.gone", outcome: "error", count: 1 },
    ]);
    expect(launch.problems_per_hour[0].hour).toBe("2026-11-17T10:00:00.000Z");
  });

  it("answers each connection's syncs, the plugins' timeouts, crashes and refusals, and where problems happened", async () => {
    const { directory } = await logFolder();
    // Connection A: two syncs failed, each a job, a request and an operation
    // in one trace, the operation (the innermost hop) with the reason.
    const failedSync = (seed: number, offset: number, reason: string) => {
      const sync = backlogSync(seed, offset);
      return [
        sync.job,
        { ...sync.request, outcome_reason: "plugin_error" },
        {
          ...sync.operation,
          outcome: reason === "timeout" ? "timeout" : "error",
          outcome_reason: reason,
          plugin: { id: "ajour.jira", version: "2.1.0" },
        },
      ];
    };
    const okSync = (seed: number, offset: number, connection: string) =>
      event({
        name: "backlog.sync",
        kind: "job",
        trace_id: traceId(seed),
        started_at: at(offset),
        connection: { id: connection },
      });
    const pluginOperation = (
      offset: number,
      fields: Partial<LoggedEvent> & { version?: string },
    ) => {
      const { version = "2.1.0", ...rest } = fields;
      return event({
        name: "assignee.search",
        kind: "plugin_operation",
        runtime: "api",
        trace_id: traceId(900 + offset),
        started_at: at(offset),
        plugin: { id: "ajour.jira", version },
        connection: { id: "connection-a" },
        ...rest,
      });
    };
    await writeEvents(directory, [
      okSync(1, 5 * HOUR, "connection-a"),
      ...failedSync(2, 3 * HOUR, "plugin_error"),
      ...failedSync(3, HOUR, "timeout"),
      okSync(4, 4 * HOUR, "connection-b"),
      ...failedSync(5, 3 * DAY, "crashed").map((hop) => ({
        ...hop,
        connection: { id: "connection-b" },
      })),
      okSync(6, 2 * HOUR, "connection-b"),
      pluginOperation(40 * 60 * 1000, {
        outcome: "refused",
        outcome_reason: "capacity",
      }),
      pluginOperation(50 * 60 * 1000, {
        outcome: "refused",
        outcome_reason: "capacity",
      }),
      pluginOperation(20 * 60 * 1000, {
        outcome: "refused",
        outcome_reason: "capacity",
        version: "2.2.0",
      }),
      // Refused for another reason: not the plugins' figure.
      pluginOperation(10 * 60 * 1000, {
        outcome: "refused",
        outcome_reason: "access_off",
      }),
    ]);
    const logs = service(directory);

    const week = await logs.aggregate({ range: "7d" });
    expect(week.syncs).toEqual([
      {
        connection_id: "connection-a",
        sync_count: 3,
        failed_count: 2,
        last: {
          started_at: at(HOUR),
          outcome: "timeout",
          outcome_reason: "timeout",
        },
        last_failure: {
          started_at: at(HOUR),
          outcome: "timeout",
          outcome_reason: "timeout",
        },
      },
      {
        connection_id: "connection-b",
        sync_count: 3,
        failed_count: 1,
        // Its last sync ended well, after the one that failed.
        last: { started_at: at(2 * HOUR), outcome: "ok" },
        last_failure: {
          started_at: at(3 * DAY),
          outcome: "error",
          outcome_reason: "crashed",
        },
      },
    ]);
    expect(week.plugin_problems).toEqual([
      {
        plugin_id: "ajour.jira",
        plugin_version: "2.1.0",
        outcome: "refused",
        outcome_reason: "capacity",
        count: 2,
        last_at: at(40 * 60 * 1000),
      },
      {
        plugin_id: "ajour.jira",
        plugin_version: "2.2.0",
        outcome: "refused",
        outcome_reason: "capacity",
        count: 1,
        last_at: at(20 * 60 * 1000),
      },
      {
        plugin_id: "ajour.jira",
        plugin_version: "2.1.0",
        outcome: "timeout",
        outcome_reason: "timeout",
        count: 1,
        last_at: at(HOUR - 20),
      },
      {
        plugin_id: "ajour.jira",
        plugin_version: "2.1.0",
        outcome: "error",
        outcome_reason: "crashed",
        count: 1,
        last_at: at(3 * DAY - 20),
      },
    ]);
    // Problems by name, outcome and reason, most first, then the latest,
    // with where they happened: the connection, else the plugin.
    expect(week.problems.slice(0, 3)).toEqual([
      {
        name: "backlog.sync",
        outcome: "error",
        outcome_reason: "plugin_error",
        count: 4,
        last_at: at(HOUR - 10),
        places: [
          { connection_id: "connection-a", count: 3 },
          { connection_id: "connection-b", count: 1 },
        ],
      },
      {
        name: "assignee.search",
        outcome: "refused",
        outcome_reason: "capacity",
        count: 3,
        last_at: at(20 * 60 * 1000),
        places: [{ connection_id: "connection-a", count: 3 }],
      },
      {
        name: "backlog.sync",
        outcome: "error",
        count: 3,
        last_at: at(HOUR),
        places: [
          { connection_id: "connection-a", count: 2 },
          { connection_id: "connection-b", count: 1 },
        ],
      },
    ]);
    expect(week.problems).toHaveLength(6);
    expect(week.problems.at(-1)).toMatchObject({
      name: "backlog.sync",
      outcome: "error",
      outcome_reason: "crashed",
      count: 1,
    });

    // A day leaves out connection B's failed sync, three days ago.
    const day = await logs.aggregate({ range: "24h" });
    expect(
      day.syncs.map((sync: { connection_id: string; failed_count: number }) => [
        sync.connection_id,
        sync.failed_count,
      ]),
    ).toEqual([
      ["connection-a", 2],
      ["connection-b", 0],
    ]);
  });
});

describe("logs.tail", () => {
  it("delivers the written events that match each subscription, until it stops", async () => {
    const { directory } = await logFolder();
    const logs = service(directory);
    const window = {};
    const other = {};
    const delivered: { id: number; names: string[] }[] = [];
    const deliver = (id: number) => (events: LoggedEvent[]) =>
      delivered.push({ id, names: events.map(({ name }) => name) });
    logs.subscribe(window, 1, { outcome: "problems" }, deliver(1));
    logs.subscribe(window, 2, { name_prefix: "time_entry." }, deliver(2));
    logs.subscribe(other, 1, {}, deliver(3));

    const lines = [
      event({ name: "time_entry.update" }),
      event({ name: "backlog.sync", outcome: "error" }),
      // The viewer's own reads never reach a tail, so watching it adds nothing to it.
      event({ name: "logs.query", kind: "ipc", runtime: "main" }),
      event({ name: "logs.tail", kind: "ipc", runtime: "main" }),
      event({ name: "logs.aggregate", kind: "ipc", runtime: "main" }),
    ].map((logged) => JSON.stringify(logged));
    logs.written([...lines, "{malformed"]);
    expect(delivered).toEqual([
      { id: 1, names: ["backlog.sync"] },
      { id: 2, names: ["time_entry.update"] },
      { id: 3, names: ["time_entry.update", "backlog.sync"] },
    ]);

    delivered.length = 0;
    logs.unsubscribe(window, 2);
    logs.dropOwner(other);
    logs.written(lines);
    expect(delivered).toEqual([{ id: 1, names: ["backlog.sync"] }]);

    // Nothing matched: nothing is sent.
    delivered.length = 0;
    logs.written([JSON.stringify(event({ name: "time_entry.update" }))]);
    expect(delivered).toEqual([]);
  });

  it("refuses a filter outside its format, or a range, which a tail has no use for", async () => {
    const { directory } = await logFolder();
    const logs = service(directory);
    for (const filter of [
      { from: at(HOUR) },
      { path: "x" },
      { outcome: "x" },
      null,
    ]) {
      expect(() => logs.subscribe({}, 1, filter, () => {})).toThrow(
        expect.objectContaining({ code: INVALID_LOG_QUERY }),
      );
    }
    expect(() => logs.subscribe({}, -1, {}, () => {})).toThrow(
      expect.objectContaining({ code: INVALID_LOG_QUERY }),
    );
    // A window holds a bounded number of tails.
    const owner = {};
    for (let id = 1; id <= 8; id += 1) logs.subscribe(owner, id, {}, () => {});
    expect(() => logs.subscribe(owner, 9, {}, () => {})).toThrow(
      expect.objectContaining({ code: INVALID_LOG_QUERY }),
    );
    expect(logs.subscriptionCount(owner)).toBe(8);
  });

  it("keeps delivering when one subscriber throws", async () => {
    const { directory } = await logFolder();
    const logs = service(directory);
    const delivered: string[] = [];
    logs.subscribe({}, 1, {}, () => {
      throw new Error("gone");
    });
    logs.subscribe({}, 2, {}, (events: LoggedEvent[]) =>
      delivered.push(...events.map(({ name }) => name)),
    );
    logs.written([JSON.stringify(event({ name: "time_entry.update" }))]);
    expect(delivered).toEqual(["time_entry.update"]);
  });
});

/** A seeded generator, so the fixture is the same on every run. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const FIXTURE_NAMES = [
  "time_entry.update",
  "time_entry.create",
  "backlog.sync",
  "plugin.request",
  "calendar.fetch",
  "route.change",
  "update.check",
  "agent_tool.call",
];

/** About `perDay` events a day for `days` days, as traces of one to six spans. */
async function writeGeneratedDays(
  directory: string,
  days: number,
  perDay: number,
) {
  const random = seeded(442);
  let trace = 10_000;
  for (let day = days - 1; day >= 0; day -= 1) {
    const dayStart = Date.parse("2026-11-17T00:00:00.000Z") - day * DAY;
    const lines: string[] = [];
    while (lines.length < perDay) {
      trace += 1;
      const spans = 1 + Math.floor(random() * 6);
      const started = dayStart + Math.floor(random() * (DAY - 60_000));
      let parent: string | undefined;
      for (let span = 0; span < spans && lines.length < perDay; span += 1) {
        const roll = random();
        const logged = event({
          name: FIXTURE_NAMES[Math.floor(random() * FIXTURE_NAMES.length)]!,
          kind: span === 0 ? "job" : "request",
          runtime: (["renderer", "api", "main"] as const)[span % 3],
          outcome: roll < 0.9 ? "ok" : roll < 0.95 ? "noop" : "error",
          started_at: new Date(started + span * 5).toISOString(),
          duration_ms: Math.floor(random() * 2000),
          trace_id: traceId(trace),
          ...(parent ? { parent_span_id: parent } : {}),
          launch_id: `launch-${day}`,
          steps: ["time_entry.update", "store.write"],
          counts: { entries_written: 3 },
          connection: { id: `connection-${trace % 7}` },
          plugin: { id: "ajour.azure-devops", version: "4.2.0" },
          http: { route: "/api/plugins/:id/sync", status_code: 200 },
        });
        parent = logged.span_id;
        lines.push(JSON.stringify(logged));
      }
    }
    await fs.writeFile(
      path.join(
        directory,
        `${new Date(dayStart).toISOString().slice(0, 10)}.ndjson`,
      ),
      lines.map((line) => `${line}\n`).join(""),
    );
  }
}

describe("performance", () => {
  it("answers a query over 7 days of 42,000 events within 200 ms", async () => {
    const { directory } = await logFolder();
    await writeGeneratedDays(directory, 7, 6000);
    const logs = createLocalLogQuery({
      directory,
      launch: { launch_id: "launch-0", started_at_ms: NOW - HOUR },
      now: () => Date.parse("2026-11-17T23:59:00.000Z"),
    });
    const filter = { from: "2026-11-11T00:00:00.000Z" };

    // The first query indexes the 7 days.
    const coldStart = performance.now();
    const cold = await logs.query(filter);
    const coldMs = performance.now() - coldStart;
    expect(cold.file_count).toBe(7);
    expect(cold.match_count).toBe(42_000);

    // The same query again answers from the index.
    const start = performance.now();
    const indexed = await logs.query(filter);
    const indexedMs = performance.now() - start;
    expect(indexed.match_count).toBe(42_000);
    console.info(
      `local log query over 42,000 events: cold ${coldMs.toFixed(1)} ms, indexed ${indexedMs.toFixed(1)} ms`,
    );
    expect(indexedMs).toBeLessThan(200);
  }, 60_000);
});
