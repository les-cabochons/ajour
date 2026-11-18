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
});

describe("logs.actions", () => {
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
    const filter = { from: "2026-11-11T00:00:00.000Z", outcome: "problems" };

    const coldStart = performance.now();
    const cold = await logs.query(filter);
    const coldMs = performance.now() - coldStart;
    expect(cold.file_count).toBe(7);
    expect(cold.match_count).toBeGreaterThan(1000);

    // Each query after it reads what the index holds.
    const timings: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      await logs.query(filter);
      await logs.query({ from: "2026-11-11T00:00:00.000Z" }, { limit: 500 });
      timings.push((performance.now() - start) / 2);
    }
    const aggregateStart = performance.now();
    await logs.aggregate({ range: "7d" });
    const aggregateMs = performance.now() - aggregateStart;
    const actionsStart = performance.now();
    await logs.actions({ show: "slow" });
    const actionsMs = performance.now() - actionsStart;
    const warmMs = Math.min(...timings);
    console.info(
      `local log query over 42,000 events: cold ${coldMs.toFixed(1)} ms, warm ${warmMs.toFixed(1)} ms, aggregate ${aggregateMs.toFixed(1)} ms, actions ${actionsMs.toFixed(1)} ms`,
    );
    expect(warmMs).toBeLessThan(200);
    expect(aggregateMs).toBeLessThan(200);
    expect(actionsMs).toBeLessThan(200);
  }, 60_000);
});
