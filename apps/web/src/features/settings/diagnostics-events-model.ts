import { format } from "date-fns";
import type { Kind, Outcome, Runtime } from "@ajour/wide-events";
import {
  catalog,
  envelopeFields,
  type FieldTree,
} from "@ajour/wide-events/catalog.ts";
import type {
  DesktopLogFilter,
  DesktopLogTailFilter,
  LoggedEvent,
} from "@/lib/desktop-bridge";

/*
 * Diagnostics > Events (#443): what its chips and query box mean, as search
 * keys and as the filter `logs.query` takes. The keys are the page's own, so
 * a link (the Overview's, #445) opens the tab filtered:
 *
 *   problems=1, runtime, kind, launch (this | all | a launch ID), range
 *   or hour (narrowed by from and to), name, outcome, reason, trace,
 *   connection, plugin, version
 *
 * A value outside its format is dropped here, so main never refuses a query
 * the page built.
 */

export const EVENT_RUNTIMES: readonly Runtime[] = ["renderer", "api", "main"];

export const EVENT_KINDS: readonly Kind[] = [
  "command",
  "job",
  "request",
  "ipc",
  "plugin_operation",
  "lifecycle",
  "navigation",
  "crash",
];

export const EVENT_OUTCOMES: readonly Outcome[] = [
  "ok",
  "noop",
  "refused",
  "cancelled",
  "timeout",
  "error",
];

/** The Time chip's choices, newest window first. */
export const EVENT_RANGES = {
  "15m": { label: "Last 15 minutes", ms: 15 * 60_000 },
  "1h": { label: "Last hour", ms: 60 * 60_000 },
  "24h": { label: "Last 24 hours", ms: 24 * 60 * 60_000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 60 * 60_000 },
} as const;

export type EventRange = keyof typeof EVENT_RANGES;

const HOUR_MS = 60 * 60_000;

/** The `reason:` value for the events without an `outcome_reason`. */
export const NO_REASON = "none";

/** The reasons one filter takes at most, as main does. */
const MAX_REASONS = 16;

/** The query box's terms. `name` ending in `*` matches the start of a name. */
export interface EventQueryTerms {
  name?: string;
  outcome?: Outcome[];
  /** `outcome_reason`: one or several, or `NO_REASON` alone. */
  reason?: string[];
  trace?: string;
  connection?: string;
  plugin?: string;
  /** The plugin's `version`. */
  version?: string;
}

export type EventQueryTerm = keyof EventQueryTerms;

const TERM_ORDER: readonly EventQueryTerm[] = [
  "name",
  "outcome",
  "reason",
  "trace",
  "connection",
  "plugin",
  "version",
];

export interface EventsView {
  problems: boolean;
  runtime?: Runtime;
  kind?: Kind;
  /** This launch, every launch, or the launch of that ID (Same launch). */
  launch: "this" | "all" | (string & {});
  range?: EventRange;
  /**
   * One UTC hour, by its start (`2026-11-18T09:00:00.000Z`), as a bar of the
   * Overview's chart opens it; it takes the place of `range`.
   */
  hour?: string;
  /**
   * The part of `hour` a bar counted when its range starts or ends inside
   * it (the `from` and `to` keys): from inclusive, to exclusive.
   */
  hourFrom?: string;
  hourTo?: string;
  terms: EventQueryTerms;
}

export const DEFAULT_EVENTS_VIEW: EventsView = {
  problems: false,
  launch: "this",
  terms: {},
};

// The formats main checks (apps/desktop/electron/local-log-query.cjs).
const EVENT_NAME = /^[a-z0-9_.]{1,128}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const RECORD_ID = /^[A-Za-z0-9._:@/-]{1,200}$/;
const OUTCOME_REASON = /^[a-z0-9_]{1,64}$/;
const PLUGIN_VERSION = /^[0-9A-Za-z.+-]{1,80}$/;
const HOUR_START = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isProblem = (outcome: Outcome) => outcome !== "ok" && outcome !== "noop";

function oneOf<Value extends string>(
  values: readonly Value[],
  value: string | undefined,
): Value | undefined {
  return values.find((candidate) => candidate === value);
}

/** A name, or the start of one with a trailing `*`, in main's format. */
function readName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const name = value.endsWith("*") ? value.slice(0, -1) : value;
  return EVENT_NAME.test(name) ? value : undefined;
}

function readOutcomes(value: string | undefined): Outcome[] | undefined {
  if (!value) return undefined;
  const outcomes = value.split(",").map((part) => part.trim());
  const known = outcomes.map((part) => oneOf(EVENT_OUTCOMES, part));
  if (known.some((outcome) => outcome === undefined)) return undefined;
  return [...new Set(known as Outcome[])];
}

/** The distinct reasons in their format, or `NO_REASON` alone; any number. */
function reasonList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const reasons = [...new Set(value.split(",").map((part) => part.trim()))];
  if (reasons.some((reason) => !OUTCOME_REASON.test(reason))) return undefined;
  if (reasons.length > 1 && reasons.includes(NO_REASON)) return undefined;
  return reasons;
}

/** At most `MAX_REASONS` of them, so main never refuses the list. */
function readReasons(value: string | undefined): string[] | undefined {
  const reasons = reasonList(value);
  return reasons && reasons.length <= MAX_REASONS ? reasons : undefined;
}

/** An instant as `toISOString` writes it, else undefined. */
function readInstant(value: string | undefined): string | undefined {
  if (!value || !INSTANT.test(value)) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value
    ? value
    : undefined;
}

/** An hour's start, as main writes the chart's buckets. */
function readHour(value: string | undefined): string | undefined {
  return value && HOUR_START.test(value) ? readInstant(value) : undefined;
}

/** `from` and `to` when they narrow `hour` to a part of it; else neither. */
function readHourPart(
  hour: string,
  fromValue: string | undefined,
  toValue: string | undefined,
): { hourFrom?: string; hourTo?: string } {
  const start = Date.parse(hour);
  const end = start + HOUR_MS;
  const from = readInstant(fromValue);
  const to = readInstant(toValue);
  const fromMs = from ? Date.parse(from) : start;
  const toMs = to ? Date.parse(to) : end;
  if (fromMs < start || toMs > end || fromMs >= toMs) return {};
  return {
    ...(from && fromMs > start ? { hourFrom: from } : {}),
    ...(to && toMs < end ? { hourTo: to } : {}),
  };
}

const readTrace = (value: string | undefined) =>
  value && TRACE_ID.test(value) ? value : undefined;
const readRecordId = (value: string | undefined) =>
  value && RECORD_ID.test(value) ? value : undefined;

const TERM_READERS: Record<
  EventQueryTerm,
  (value: string | undefined) => EventQueryTerms[EventQueryTerm]
> = {
  name: readName,
  outcome: readOutcomes,
  reason: readReasons,
  trace: readTrace,
  connection: readRecordId,
  plugin: readRecordId,
  version: (value) => (value && PLUGIN_VERSION.test(value) ? value : undefined),
};

/** A search value as text: the narrow view's router parses `1` as a number. */
function searchText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return undefined;
}

/** The view a page's search names. Unknown or malformed values are left out. */
export function parseEventsView(search: Record<string, unknown>): EventsView {
  const text = (key: string) => searchText(search[key]);
  const launch = text("launch");
  const terms: EventQueryTerms = {};
  for (const term of TERM_ORDER) {
    const value = TERM_READERS[term](text(term));
    if (value !== undefined) Object.assign(terms, { [term]: value });
  }
  const runtime = oneOf(EVENT_RUNTIMES, text("runtime"));
  const kind = oneOf(EVENT_KINDS, text("kind"));
  const hour = readHour(text("hour"));
  const range = hour
    ? undefined
    : oneOf(Object.keys(EVENT_RANGES) as EventRange[], text("range"));
  return {
    problems: text("problems") === "1",
    ...(runtime ? { runtime } : {}),
    ...(kind ? { kind } : {}),
    launch:
      launch === "all" || (launch && readRecordId(launch)) ? launch : "this",
    ...(range ? { range } : {}),
    ...(hour ? { hour, ...readHourPart(hour, text("from"), text("to")) } : {}),
    terms,
  };
}

/** The search keys of a view, defaults left out. */
export function eventsSearchOf(view: EventsView): Record<string, string> {
  const search: Record<string, string> = {};
  if (view.problems) search.problems = "1";
  if (view.runtime) search.runtime = view.runtime;
  if (view.kind) search.kind = view.kind;
  if (view.launch !== "this") search.launch = view.launch;
  if (view.hour) {
    search.hour = view.hour;
    if (view.hourFrom) search.from = view.hourFrom;
    if (view.hourTo) search.to = view.hourTo;
  } else if (view.range) search.range = view.range;
  for (const term of TERM_ORDER) {
    const value = view.terms[term];
    if (value === undefined) continue;
    search[term] = Array.isArray(value) ? value.join(",") : value;
  }
  return search;
}

export type EventQueryError =
  | { kind: "unknown_term"; term: string }
  | { kind: "invalid_value"; term: EventQueryTerm }
  | { kind: "too_many_values"; term: "reason"; max: number }
  | { kind: "repeated_term"; term: EventQueryTerm };

export type ParsedQuery =
  { ok: true; terms: EventQueryTerms } | { ok: false; error: EventQueryError };

/**
 * The query box's text as terms: `name:`, `outcome:` and `reason:` (one
 * or several, comma separated), `trace:`, `connection:`, `plugin:` and
 * `version:`, separated by spaces. A word with no term is the start of a
 * name.
 */
export function parseQuery(text: string): ParsedQuery {
  const terms: EventQueryTerms = {};
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const separator = word.indexOf(":");
    const key = separator === -1 ? "name" : word.slice(0, separator);
    const raw =
      separator === -1
        ? `${word.replace(/\*$/, "")}*`
        : word.slice(separator + 1);
    const term = oneOf(TERM_ORDER, key);
    if (!term) return { ok: false, error: { kind: "unknown_term", term: key } };
    if (terms[term] !== undefined) {
      return { ok: false, error: { kind: "repeated_term", term } };
    }
    const value = TERM_READERS[term](raw);
    if (term === "reason" && (reasonList(raw)?.length ?? 0) > MAX_REASONS) {
      return {
        ok: false,
        error: { kind: "too_many_values", term, max: MAX_REASONS },
      };
    }
    if (value === undefined) {
      return { ok: false, error: { kind: "invalid_value", term } };
    }
    Object.assign(terms, { [term]: value });
  }
  return { ok: true, terms };
}

/** Terms as the query box shows them. */
export function formatQuery(terms: EventQueryTerms): string {
  return TERM_ORDER.flatMap((term) => {
    const value = terms[term];
    if (value === undefined) return [];
    return [`${term}:${Array.isArray(value) ? value.join(",") : value}`];
  }).join(" ");
}

const TERM_FORMATS: Record<EventQueryTerm, string> = {
  name: "an event name such as backlog.sync, or its start followed by *",
  outcome: `${EVENT_OUTCOMES.join(", ")}, or several separated by commas`,
  reason: `an outcome reason such as timeout, several separated by commas, or ${NO_REASON} for the events without one`,
  trace: "a trace ID of 32 hex characters",
  connection: "a connection ID",
  plugin: "a plugin ID",
  version: "a plugin version such as 1.2.0",
};

/** The line under the query box when its text can't be read. */
export function describeQueryError(error: EventQueryError): string {
  switch (error.kind) {
    case "unknown_term":
      return `Ajour doesn't know ${error.term}:. Use name:, outcome:, reason:, trace:, connection:, plugin: or version:.`;
    case "repeated_term":
      return `${error.term}: appears twice.`;
    case "invalid_value":
      return `${error.term}: takes ${TERM_FORMATS[error.term]}.`;
    case "too_many_values":
      return `${error.term}: takes at most ${error.max} reasons.`;
  }
}

/**
 * The `logs.query` filter of a view, at `now`. `launchId` is this launch's,
 * absent outside the desktop app. Null when the view can match nothing:
 * Problems only with `outcome:` terms that are all `ok` or `noop`.
 */
export function logFilterOf(
  view: EventsView,
  { now, launchId }: { now: number; launchId: string | undefined },
): DesktopLogFilter | null {
  const filter: DesktopLogFilter = {};
  const outcomes = view.terms.outcome;
  if (outcomes) {
    const kept = view.problems ? outcomes.filter(isProblem) : outcomes;
    if (kept.length === 0) return null;
    filter.outcome = kept;
  } else if (view.problems) {
    filter.outcome = "problems";
  }
  if (view.runtime) filter.runtime = view.runtime;
  if (view.kind) filter.kind = view.kind;
  const launch = view.launch === "this" ? launchId : view.launch;
  if (launch && launch !== "all") filter.launch_id = launch;
  if (view.hour) {
    filter.from = view.hourFrom ?? view.hour;
    filter.to =
      view.hourTo ?? new Date(Date.parse(view.hour) + HOUR_MS).toISOString();
  } else if (view.range) {
    filter.from = new Date(now - EVENT_RANGES[view.range].ms).toISOString();
  }
  const { name, reason, trace, connection, plugin, version } = view.terms;
  if (name?.endsWith("*")) filter.name_prefix = name.slice(0, -1);
  else if (name) filter.name = name;
  if (trace) filter.trace_id = trace;
  if (connection) filter.connection_id = connection;
  if (plugin) filter.plugin_id = plugin;
  if (version) filter.plugin_version = version;
  if (reason) {
    filter.outcome_reason =
      reason.length === 1 && reason[0] === NO_REASON ? null : reason;
  }
  return filter;
}

/** What Live follows: the same filter, without its range. */
export function tailFilterOf(filter: DesktopLogFilter): DesktopLogTailFilter {
  const { from: _from, to: _to, ...tail } = filter;
  return tail;
}

/**
 * Whether an event started within the filter's range, the part of it a tail
 * can't follow: an event is written when it ends, so one that started before
 * `from` can arrive while Live is on.
 */
export function startsInRange(
  event: LoggedEvent,
  filter: DesktopLogFilter,
): boolean {
  const started = Date.parse(event.started_at);
  return (
    (filter.from === undefined || started >= Date.parse(filter.from)) &&
    (filter.to === undefined || started < Date.parse(filter.to))
  );
}

/** The rows to render for a scroll position: those in view, and `overscan` more each side. */
export function visibleRows({
  scrollTop,
  viewportHeight,
  rowHeight,
  count,
  overscan,
}: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan: number;
}): { start: number; end: number } {
  const inView = Math.ceil(viewportHeight / rowHeight);
  const first = Math.min(
    Math.max(0, Math.floor(scrollTop / rowHeight)),
    Math.max(0, count - inView),
  );
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, first + inView + overscan),
  };
}

/** An event's identity, as main tells events apart: runtime, trace and span. */
export function eventKey(event: LoggedEvent): string {
  return `${event.runtime}:${event.trace_id}:${event.span_id}`;
}

/** The time column: today's events by the millisecond, others with their day. */
export function formatEventTime(startedAt: string, now: number): string {
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return startedAt;
  return format(started, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")
    ? format(started, "HH:mm:ss.SSS")
    : format(started, "MMM d HH:mm:ss");
}

/**
 * An hour of the Overview's chart, or the part of it a bar counted, in
 * local time: "Nov 18, 09:00–10:00", "Nov 18, 09:23–10:00".
 */
export function formatEventHour(
  hour: string,
  part: { hourFrom?: string; hourTo?: string } = {},
): string {
  const start = Date.parse(part.hourFrom ?? hour);
  const end = part.hourTo
    ? Date.parse(part.hourTo)
    : Date.parse(hour) + HOUR_MS;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return hour;
  return `${format(start, "MMM d, HH:mm")}–${format(end, "HH:mm")}`;
}

/** A duration: ms below a second, seconds below a minute, then minutes. */
export function formatEventDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Number((ms / 1000).toFixed(2))} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

const ENVELOPE_KEYS = new Set(Object.keys(envelopeFields));

/** A field's value as one line: lists joined with commas. */
function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The event's own fields, outside the envelope, as dotted paths in stored order. */
export function domainFieldsOf(
  event: LoggedEvent,
): { path: string; value: string }[] {
  const fields: { path: string; value: string }[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) {
        walk(inner, `${path}.${key}`);
      }
      return;
    }
    fields.push({ path, value: displayValue(value) });
  };
  for (const [key, value] of Object.entries(event)) {
    if (!ENVELOPE_KEYS.has(key)) walk(value, key);
  }
  return fields;
}

function sensitivePaths(tree: FieldTree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, node]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if ("privacy" in node && typeof node.privacy === "string") {
      return node.privacy === "sensitive" ? [path] : [];
    }
    return sensitivePaths(node as FieldTree, path);
  });
}

function hasPath(event: LoggedEvent, path: string): boolean {
  let value: unknown = event;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || !(key in value)) {
      return false;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}

/**
 * The sensitive fields the catalog declares for the event that it doesn't
 * hold, whatever the setting is now: an event written while sensitive fields
 * were off never got them. An error's message counts only when the event has
 * an error.
 */
export function missingSensitiveFields(event: LoggedEvent): string[] {
  const spec = Object.hasOwn(catalog.events, event.name)
    ? (catalog.events as Record<string, { fields: FieldTree }>)[event.name]
    : undefined;
  const paths = spec ? sensitivePaths(spec.fields) : [];
  if (event.error) paths.push("error.message");
  return paths.filter((path) => !hasPath(event, path));
}

/** Names from Ajour's own data, for the IDs an event holds. Never written to the log. */
export interface EventDisplayNames {
  connections: ReadonlyMap<string, string>;
  plugins: ReadonlyMap<string, string>;
  backlogItems: ReadonlyMap<string, string>;
  projects: ReadonlyMap<string, string>;
}

const JOINS: ReadonlyArray<[RegExp, keyof EventDisplayNames]> = [
  [/(^|\.)connection(\.id|_id)$/, "connections"],
  [/(^|\.)plugin(\.id|_id)$/, "plugins"],
  [/(^|\.)backlog_item(\.id|_id)$/, "backlogItems"],
  [/(^|\.)project(\.id|_id)$/, "projects"],
];

/** The name Ajour knows for the ID at `path`, such as a connection's label. */
export function joinedNameOf(
  path: string,
  value: string,
  names: EventDisplayNames,
): string | undefined {
  const join = JOINS.find(([pattern]) => pattern.test(path));
  return join ? names[join[1]].get(value) : undefined;
}
