import { describe, expect, it } from "vitest";
import type { LoggedEvent } from "@/lib/desktop-bridge";
import {
  DEFAULT_EVENTS_VIEW,
  describeQueryError,
  domainFieldsOf,
  eventKey,
  eventsSearchOf,
  formatEventDuration,
  formatEventTime,
  formatQuery,
  missingSensitiveFields,
  joinedNameOf,
  logFilterOf,
  parseEventsView,
  parseQuery,
  tailFilterOf,
  visibleRows,
} from "./diagnostics-events-model";

const TRACE = "0af7651916cd43dd8448eb211c80319c";
const NOW = Date.parse("2026-11-18T12:00:00.000Z");

function event(fields: Partial<LoggedEvent> = {}): LoggedEvent {
  return {
    schema: 1,
    name: "backlog.sync",
    kind: "job",
    runtime: "renderer",
    outcome: "ok",
    started_at: "2026-11-18T11:59:00.000Z",
    duration_ms: 42,
    trace_id: TRACE,
    span_id: "b7ad6b7169203331",
    trigger: "user",
    launch_id: "launch-1",
    app: { version: "1.0.0", channel: "stable", packaged: true },
    device: { platform: "win32" },
    ...fields,
  } as LoggedEvent;
}

describe("the query box", () => {
  it("takes at most 16 reasons, as main does, and says so", () => {
    const reasons = (count: number) =>
      Array.from({ length: count }, (_, index) => `reason_${index}`).join(",");
    expect(parseQuery(`reason:${reasons(16)}`).ok).toBe(true);
    const parsed = parseQuery(`reason:${reasons(17)}`);
    expect(parsed).toEqual({
      ok: false,
      error: { kind: "too_many_values", term: "reason", max: 16 },
    });
    expect(
      describeQueryError({ kind: "too_many_values", term: "reason", max: 16 }),
    ).toBe("reason: takes at most 16 reasons.");
    // Repeats count once.
    expect(parseQuery(`reason:${reasons(16)},reason_0`).ok).toBe(true);
    expect(parseEventsView({ reason: reasons(17) }).terms.reason).toBe(
      undefined,
    );
  });

  it("reads each term onto its key", () => {
    expect(
      parseQuery(
        `name:backlog.sync outcome:error,timeout trace:${TRACE} connection:conn-1 plugin:jira`,
      ),
    ).toEqual({
      ok: true,
      terms: {
        name: "backlog.sync",
        outcome: ["error", "timeout"],
        trace: TRACE,
        connection: "conn-1",
        plugin: "jira",
      },
    });
  });

  it("reads an empty box as no terms", () => {
    expect(parseQuery("   ")).toEqual({ ok: true, terms: {} });
  });

  it("reads a bare word, or a name ending in *, as the start of a name", () => {
    expect(parseQuery("backlog.")).toEqual({
      ok: true,
      terms: { name: "backlog.*" },
    });
    expect(parseQuery("name:connection.*")).toEqual({
      ok: true,
      terms: { name: "connection.*" },
    });
  });

  it.each([
    ["colour:red", { kind: "unknown_term", term: "colour" }],
    ["outcome:broken", { kind: "invalid_value", term: "outcome" }],
    ["trace:abc", { kind: "invalid_value", term: "trace" }],
    ["name:Bad Name!", { kind: "invalid_value", term: "name" }],
    ["connection:", { kind: "invalid_value", term: "connection" }],
    ["plugin:a plugin:b", { kind: "repeated_term", term: "plugin" }],
  ])("refuses %s", (text, error) => {
    expect(parseQuery(text)).toEqual({ ok: false, error });
  });

  it("reads reason: as one outcome reason or several", () => {
    expect(parseQuery("reason:timeout,capacity")).toEqual({
      ok: true,
      terms: { reason: ["timeout", "capacity"] },
    });
    expect(parseQuery("reason:Not-A-Reason")).toEqual({
      ok: false,
      error: { kind: "invalid_value", term: "reason" },
    });
    expect(describeQueryError({ kind: "invalid_value", term: "reason" })).toBe(
      "reason: takes an outcome reason such as timeout, several separated by commas, or none for the events without one.",
    );
  });

  it("says what is wrong with a term", () => {
    expect(describeQueryError({ kind: "unknown_term", term: "colour" })).toBe(
      "Ajour doesn't know colour:. Use name:, outcome:, reason:, trace:, connection:, plugin: or version:.",
    );
    expect(describeQueryError({ kind: "invalid_value", term: "trace" })).toBe(
      "trace: takes a trace ID of 32 hex characters.",
    );
    expect(describeQueryError({ kind: "repeated_term", term: "name" })).toBe(
      "name: appears twice.",
    );
  });

  it("writes terms back as the text it reads", () => {
    const terms = {
      name: "backlog.*",
      outcome: ["error" as const],
      trace: TRACE,
      connection: "c",
      plugin: "p",
    };
    const text = formatQuery(terms);
    expect(text).toBe(
      `name:backlog.* outcome:error trace:${TRACE} connection:c plugin:p`,
    );
    expect(parseQuery(text)).toEqual({ ok: true, terms });
  });
});

describe("the Events search keys", () => {
  it("default to this launch, any time, every runtime and kind, all outcomes", () => {
    expect(parseEventsView({})).toEqual(DEFAULT_EVENTS_VIEW);
    expect(eventsSearchOf(DEFAULT_EVENTS_VIEW)).toEqual({});
  });

  it("read every key a link may set, and write them back", () => {
    const search = {
      problems: "1",
      runtime: "main",
      kind: "ipc",
      launch: "all",
      range: "24h",
      name: "logs.query",
      outcome: "error,refused",
      trace: TRACE,
      connection: "conn-1",
      plugin: "jira",
    };
    const view = parseEventsView(search);
    expect(view).toEqual({
      problems: true,
      runtime: "main",
      kind: "ipc",
      launch: "all",
      range: "24h",
      terms: {
        name: "logs.query",
        outcome: ["error", "refused"],
        trace: TRACE,
        connection: "conn-1",
        plugin: "jira",
      },
    });
    expect(eventsSearchOf(view)).toEqual(search);
  });

  it("reads an hour, which a bar of the Overview's chart opens, in place of a range", () => {
    const hour = "2026-11-18T09:00:00.000Z";
    const view = parseEventsView({
      hour,
      range: "24h",
      reason: "timeout",
    });
    expect(view).toMatchObject({ hour, terms: { reason: ["timeout"] } });
    expect(view.range).toBeUndefined();
    expect(eventsSearchOf(view)).toEqual({ hour, reason: "timeout" });
    expect(parseEventsView({ hour: "2026-11-18T09:30:00.000Z" }).hour).toBe(
      undefined,
    );
    expect(parseEventsView({ hour: "yesterday" }).hour).toBe(undefined);
  });

  it("reads from and to that narrow an hour to the part an Overview bar counted", () => {
    const hour = "2026-11-18T09:00:00.000Z";
    const view = parseEventsView({
      hour,
      from: "2026-11-18T09:23:00.000Z",
      to: "2026-11-18T09:40:00.001Z",
    });
    expect(view).toMatchObject({
      hour,
      hourFrom: "2026-11-18T09:23:00.000Z",
      hourTo: "2026-11-18T09:40:00.001Z",
    });
    expect(eventsSearchOf(view)).toEqual({
      hour,
      from: "2026-11-18T09:23:00.000Z",
      to: "2026-11-18T09:40:00.001Z",
    });
    expect(
      logFilterOf({ ...view, launch: "all" }, { now: NOW, launchId: "l" }),
    ).toEqual({
      from: "2026-11-18T09:23:00.000Z",
      to: "2026-11-18T09:40:00.001Z",
    });
    // Outside the hour, reversed, or without an hour: left out.
    for (const search of [
      { hour, from: "2026-11-18T08:59:00.000Z" },
      { hour, to: "2026-11-18T10:00:00.001Z" },
      {
        hour,
        from: "2026-11-18T09:40:00.000Z",
        to: "2026-11-18T09:20:00.000Z",
      },
      { from: "2026-11-18T09:23:00.000Z" },
    ]) {
      const read = parseEventsView(search);
      expect([read.hourFrom, read.hourTo]).toEqual([undefined, undefined]);
    }
  });

  it("reads reason=none, alone, as the events without a reason", () => {
    const view = parseEventsView({ reason: "none", launch: "all" });
    expect(view.terms.reason).toEqual(["none"]);
    expect(logFilterOf(view, { now: NOW, launchId: "l" })).toEqual({
      outcome_reason: null,
    });
    expect(parseEventsView({ reason: "none,timeout" }).terms.reason).toBe(
      undefined,
    );
  });

  it("keeps a version as long as a manifest allows, 80 characters", () => {
    const long = "1.0.0-" + "a".repeat(74);
    expect(parseEventsView({ version: long }).terms.version).toBe(long);
    expect(
      parseEventsView({ version: `${long}a` }).terms.version,
    ).toBeUndefined();
  });

  it("reads a plugin's version and asks for it as plugin_version", () => {
    const view = parseEventsView({
      plugin: "ajour.jira",
      version: "2.1.0-beta.1",
      launch: "all",
    });
    expect(view.terms.version).toBe("2.1.0-beta.1");
    expect(eventsSearchOf(view)).toEqual({
      launch: "all",
      plugin: "ajour.jira",
      version: "2.1.0-beta.1",
    });
    expect(logFilterOf(view, { now: NOW, launchId: "l" })).toEqual({
      plugin_id: "ajour.jira",
      plugin_version: "2.1.0-beta.1",
    });
    expect(parseQuery("plugin:ajour.jira version:2.1.0")).toEqual({
      ok: true,
      terms: { plugin: "ajour.jira", version: "2.1.0" },
    });
    expect(parseEventsView({ version: "2 1" }).terms.version).toBe(undefined);
  });

  it("reads a router's parsed numbers, and keeps a launch ID for Same launch", () => {
    expect(parseEventsView({ problems: 1, launch: "launch-7" })).toMatchObject({
      problems: true,
      launch: "launch-7",
    });
  });

  it("drops a value outside its format, so main is never asked to refuse it", () => {
    expect(
      parseEventsView({
        runtime: "browser",
        kind: "everything",
        range: "forever",
        launch: "not a launch!",
        trace: "nope",
        outcome: "fine",
        name: "Not A Name",
        problems: "yes",
      }),
    ).toEqual(DEFAULT_EVENTS_VIEW);
  });
});

describe("the logs.query filter", () => {
  const context = { now: NOW, launchId: "launch-1" };

  it("is this launch alone by default", () => {
    expect(logFilterOf(DEFAULT_EVENTS_VIEW, context)).toEqual({
      launch_id: "launch-1",
    });
  });

  it("asks for every launch with launch=all, and has no launch to ask for outside the desktop app", () => {
    expect(
      logFilterOf({ ...DEFAULT_EVENTS_VIEW, launch: "all" }, context),
    ).toEqual({});
    expect(
      logFilterOf(DEFAULT_EVENTS_VIEW, { now: NOW, launchId: undefined }),
    ).toEqual({});
  });

  it("maps each chip and term onto its key", () => {
    expect(
      logFilterOf(
        {
          problems: true,
          runtime: "api",
          kind: "request",
          launch: "launch-9",
          range: "1h",
          terms: {
            name: "http.request",
            trace: TRACE,
            connection: "c1",
            plugin: "p1",
          },
        },
        context,
      ),
    ).toEqual({
      outcome: "problems",
      runtime: "api",
      kind: "request",
      launch_id: "launch-9",
      from: "2026-11-18T11:00:00.000Z",
      name: "http.request",
      trace_id: TRACE,
      connection_id: "c1",
      plugin_id: "p1",
    });
  });

  it("asks for an hour as its from and to, and for reasons as outcome_reason", () => {
    expect(
      logFilterOf(
        {
          ...DEFAULT_EVENTS_VIEW,
          launch: "all",
          hour: "2026-11-18T09:00:00.000Z",
          terms: { reason: ["timeout", "capacity"] },
        },
        context,
      ),
    ).toEqual({
      from: "2026-11-18T09:00:00.000Z",
      to: "2026-11-18T10:00:00.000Z",
      outcome_reason: ["timeout", "capacity"],
    });
  });

  it("asks for the start of a name with name_prefix", () => {
    expect(
      logFilterOf(
        { ...DEFAULT_EVENTS_VIEW, launch: "all", terms: { name: "logs.*" } },
        context,
      ),
    ).toEqual({ name_prefix: "logs." });
  });

  it("keeps only the problem outcomes of outcome: while Problems only is on, and matches nothing when none is left", () => {
    expect(
      logFilterOf(
        {
          ...DEFAULT_EVENTS_VIEW,
          launch: "all",
          problems: true,
          terms: { outcome: ["ok", "error"] },
        },
        context,
      ),
    ).toEqual({ outcome: ["error"] });
    expect(
      logFilterOf(
        {
          ...DEFAULT_EVENTS_VIEW,
          problems: true,
          terms: { outcome: ["ok", "noop"] },
        },
        context,
      ),
    ).toBeNull();
  });

  it("follows the same filter without its range when live", () => {
    expect(
      tailFilterOf({
        from: "2026-11-18T11:00:00.000Z",
        launch_id: "launch-1",
        outcome: "problems",
      }),
    ).toEqual({ launch_id: "launch-1", outcome: "problems" });
  });
});

describe("the rows on screen", () => {
  it("renders only the rows in view, and a few more on each side", () => {
    expect(
      visibleRows({
        scrollTop: 2800,
        viewportHeight: 448,
        rowHeight: 28,
        count: 5000,
        overscan: 8,
      }),
    ).toEqual({ start: 92, end: 124 });
  });

  it("stays inside the list at its top and its end", () => {
    expect(
      visibleRows({
        scrollTop: 0,
        viewportHeight: 448,
        rowHeight: 28,
        count: 10,
        overscan: 8,
      }),
    ).toEqual({ start: 0, end: 10 });
    expect(
      visibleRows({
        scrollTop: 1_000_000,
        viewportHeight: 448,
        rowHeight: 28,
        count: 100,
        overscan: 8,
      }),
    ).toEqual({ start: 76, end: 100 });
  });
});

describe("an event's display", () => {
  it("is its runtime, trace and span, as main tells events apart", () => {
    expect(eventKey(event())).toBe(`renderer:${TRACE}:b7ad6b7169203331`);
  });

  it("shows today's times alone and other days' with their date", () => {
    const today = formatEventTime("2026-11-18T11:59:01.250Z", NOW);
    expect(today).toMatch(/^\d{2}:\d{2}:\d{2}\.250$/);
    const earlier = formatEventTime("2026-11-10T11:59:01.250Z", NOW);
    expect(earlier).toMatch(/^Nov 10 \d{2}:\d{2}:\d{2}$/);
  });

  it("shows durations in ms below a second, then seconds and minutes", () => {
    expect(formatEventDuration(0)).toBe("0 ms");
    expect(formatEventDuration(42.4)).toBe("42 ms");
    expect(formatEventDuration(1530)).toBe("1.53 s");
    expect(formatEventDuration(125_000)).toBe("2m 05s");
  });

  it("lists the domain fields, flattened, without the envelope", () => {
    expect(
      domainFieldsOf(
        event({
          connection: { id: "conn-1", is_new: true },
          backlog_item: { id: "item-1" },
          skipped_plugin_ids: ["a", "b"],
          counts: { work_item_count: 3 },
          error: { type: "TypeError" },
        }),
      ),
    ).toEqual([
      { path: "connection.id", value: "conn-1" },
      { path: "connection.is_new", value: "true" },
      { path: "backlog_item.id", value: "item-1" },
      { path: "skipped_plugin_ids", value: "a, b" },
    ]);
  });

  it("names the sensitive fields the catalog declares that weren't written", () => {
    const update = event({
      name: "time_entry.update",
      kind: "command",
      time_entry: { id: "entry-1", duration_after_ms: 60_000 },
      error: { type: "Error", code: "locked" },
    });
    const missing = missingSensitiveFields(update);
    expect(missing).toContain("time_entry.duration_before_ms");
    expect(missing).toContain("error.message");
    expect(missing).not.toContain("time_entry.duration_after_ms");
    expect(missing).not.toContain("time_entry.id");
    // No error, no message to mark.
    expect(missingSensitiveFields(event())).not.toContain("error.message");
  });

  it("joins connection, plugin, item and project names to their IDs", () => {
    const names = {
      connections: new Map([["conn-1", "Work Jira"]]),
      plugins: new Map([["jira", "Jira"]]),
      backlogItems: new Map([["item-1", "Fix export"]]),
      projects: new Map([["p-1", "Ajour"]]),
    };
    expect(joinedNameOf("connection.id", "conn-1", names)).toBe("Work Jira");
    expect(joinedNameOf("plugin.id", "jira", names)).toBe("Jira");
    expect(joinedNameOf("backlog_item.id", "item-1", names)).toBe("Fix export");
    expect(joinedNameOf("project.id", "p-1", names)).toBe("Ajour");
    expect(joinedNameOf("connection.id", "gone", names)).toBeUndefined();
    expect(joinedNameOf("time_entry.id", "conn-1", names)).toBeUndefined();
  });
});
