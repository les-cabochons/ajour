const nodeFs = require("node:fs/promises");
const path = require("node:path");

/**
 * The diagnostics viewer's reads of the local log file (#442, ADR 0014). The
 * renderer never reads a day file: it asks main through the IPC channels
 * `logs.query`, `logs.trace`, `logs.actions`, `logs.aggregate` and
 * `logs.tail`, and this module answers them from the day files of one
 * folder. It needs no Electron, so tests run it on generated day files.
 *
 * What the renderer may pass is a closed shape: times, IDs and names in
 * their formats, values in their closed sets. A key it does not know, or a
 * value outside its format, refuses the call (`INVALID_LOG_QUERY`). Main
 * builds every file it reads from a UTC day, `<directory>/YYYY-MM-DD.ndjson`,
 * so nothing the renderer passes is a path or an expression main runs.
 *
 * Each day file has an index in memory: one compact entry per line, with the
 * fields the filters read and where the line is. It is built the first time
 * a day is read, then follows the file: a file that grew is read only past
 * what the index holds, one that shrank or was replaced is read again. The
 * events themselves are read from the file for the page answered. A line
 * that isn't an event is skipped and counted, as is a day the range asks for
 * that has no file; neither fails the call.
 *
 * An event is its runtime, trace_id and span_id. A quit can write the same
 * event twice (its drain rewrites a batch whose append may have started), so
 * a day's index keeps the first line of each and reads past the others. The
 * writer picks a line's day file when it queues it, so both copies are in one
 * file. The renderer picks its own IDs, so its event never hides a main or
 * API event that shares them.
 */

const INVALID_LOG_QUERY = "invalid_log_query";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const EVENT_NAME = /^[a-z0-9_.]{1,128}$/;
/** Ajour's random IDs, plugin IDs and launch IDs: compared, never resolved. */
const RECORD_ID = /^[A-Za-z0-9._:@/-]{1,200}$/;
/** An `outcome_reason`, as the catalog names them. */
const OUTCOME_REASON = /^[a-z0-9_]{1,64}$/;
/** A plugin's `version`, as its manifest gives it. */
const PLUGIN_VERSION = /^[0-9A-Za-z.+-]{1,80}$/;
const CURSOR = /^(\d{1,16})~(\d{4}-\d{2}-\d{2})~(\d{1,9})$/;

const RUNTIMES = new Set(["renderer", "api", "main"]);
const KINDS = new Set([
  "command",
  "job",
  "request",
  "ipc",
  "plugin_operation",
  "lifecycle",
  "navigation",
  "crash",
]);
const OUTCOMES = new Set([
  "ok",
  "noop",
  "refused",
  "cancelled",
  "timeout",
  "error",
]);
/** `outcome: "problems"`: anything that didn't end `ok` or `noop`. */
const PROBLEMS = "problems";
const isProblem = (outcome) => outcome !== "ok" && outcome !== "noop";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
/** The day indexes kept in memory, the days read last. */
const MAX_INDEXED_DAYS = 31;
/** How much of a day file is read at a time while indexing. */
const READ_CHUNK_BYTES = 1024 * 1024;
/**
 * A name run once in the range has no p95 to call it slow; from two runs
 * on, Slow applies the name's p95 as its threshold (#442: "p95 or slower
 * for its name").
 */
const MIN_SLOW_SAMPLES = 2;
/** The crashes the Overview lists, newest first. */
const MAX_CRASHES = 100;
/** The problem groups the Overview lists, and the places each names. */
const MAX_PROBLEMS = 50;
const MAX_PROBLEM_PLACES = 3;
/** A reason no filter may list more of at once. */
const MAX_REASONS = 16;
/**
 * The plugin operations the Overview's Plugins figure counts: timeouts,
 * crashes and capacity refusals.
 */
const PLUGIN_PROBLEM_REASONS = new Set(["timeout", "crashed", "capacity"]);
/** Tails one window may hold at once. */
const MAX_TAILS_PER_OWNER = 8;
/**
 * The viewer's own reads never reach a tail: a viewer that refreshes as its
 * tail delivers would otherwise feed the tail its own refreshes.
 */
const VIEWER_EVENTS = new Set([
  "logs.query",
  "logs.trace",
  "logs.actions",
  "logs.aggregate",
  "logs.tail",
]);
const AGGREGATE_RANGES = new Set(["launch", "24h", "7d"]);
const ACTION_VIEWS = new Set(["all", "failed", "slow"]);

const FILTER_KEYS = [
  "from",
  "to",
  "launch_id",
  "runtime",
  "kind",
  "outcome",
  "name",
  "name_prefix",
  "trace_id",
  "connection_id",
  "plugin_id",
];
/**
 * What logs.query and logs.tail filter on besides, for the Overview's
 * links: an `outcome_reason` (null for none) and a plugin's version.
 */
const QUERY_FILTER_KEYS = [...FILTER_KEYS, "outcome_reason", "plugin_version"];
/** A tail follows what is written now, so it takes no range. */
const TAIL_FILTER_KEYS = QUERY_FILTER_KEYS.filter(
  (key) => key !== "from" && key !== "to",
);
const PAGE_KEYS = ["limit", "cursor"];

function invalidQuery(message) {
  return Object.assign(new Error(`Invalid log query: ${message}`), {
    code: INVALID_LOG_QUERY,
  });
}

/** `value` as a plain object holding only `keys`; undefined and null are `{}` when `optional`. */
function plainObject(value, keys, what, optional = true) {
  if (value === undefined || (value === null && optional)) return {};
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw invalidQuery(`${what} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw invalidQuery(`${what} has no ${key}.`);
  }
  return value;
}

function formatted(value, pattern, what) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw invalidQuery(`${what} is not in its format.`);
  }
  return value;
}

function timeOf(value, what) {
  const time = formatted(value, ISO_TIME, what);
  if (time === undefined) return undefined;
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) throw invalidQuery(`${what} is not a time.`);
  return ms;
}

/** One value of `allowed`, or a list of them, as a set; undefined for none. */
function oneOrMany(value, allowed, what) {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > allowed.size) {
    throw invalidQuery(`${what} has no value of its set.`);
  }
  for (const item of values) {
    if (typeof item !== "string" || !allowed.has(item)) {
      throw invalidQuery(`${what} is outside its set.`);
    }
  }
  return new Set(values);
}

/**
 * One reason in its format, or a list of them, as a set; null for the
 * events without a reason; undefined for no filter.
 */
function reasonsOf(value) {
  if (value === undefined) return undefined;
  if (value === null) return new Set([undefined]);
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > MAX_REASONS) {
    throw invalidQuery("outcome_reason has no value, or too many.");
  }
  // Every element, holes of a sparse list too, is a reason in its format.
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (typeof item !== "string" || !OUTCOME_REASON.test(item)) {
      throw invalidQuery("outcome_reason is not in its format.");
    }
  }
  return new Set(values);
}

/** The renderer's filter, checked, as what `matches` reads. */
function readFilter(value, keys = FILTER_KEYS, optional = true) {
  const filter = plainObject(value, keys, "The filter", optional);
  const read = {
    from: timeOf(filter.from, "from"),
    to: timeOf(filter.to, "to"),
    launch: formatted(filter.launch_id, RECORD_ID, "launch_id"),
    runtimes: oneOrMany(filter.runtime, RUNTIMES, "runtime"),
    kinds: oneOrMany(filter.kind, KINDS, "kind"),
    outcomes: undefined,
    problems: false,
    name: formatted(filter.name, EVENT_NAME, "name"),
    prefix: formatted(filter.name_prefix, EVENT_NAME, "name_prefix"),
    trace: formatted(filter.trace_id, TRACE_ID, "trace_id"),
    connection: formatted(filter.connection_id, RECORD_ID, "connection_id"),
    plugin: formatted(filter.plugin_id, RECORD_ID, "plugin_id"),
    reasons: reasonsOf(filter.outcome_reason),
    pluginVersion: formatted(
      filter.plugin_version,
      PLUGIN_VERSION,
      "plugin_version",
    ),
  };
  if (filter.outcome === PROBLEMS) read.problems = true;
  else read.outcomes = oneOrMany(filter.outcome, OUTCOMES, "outcome");
  if (read.from !== undefined && read.to !== undefined && read.from > read.to) {
    throw invalidQuery("from is after to.");
  }
  return read;
}

function readPage(value) {
  const page = plainObject(value, PAGE_KEYS, "The page");
  const limit = page.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw invalidQuery(`limit is from 1 to ${MAX_PAGE_SIZE}.`);
  }
  let after;
  if (page.cursor !== undefined && page.cursor !== null) {
    const parts =
      typeof page.cursor === "string" ? CURSOR.exec(page.cursor) : null;
    if (!parts || dayOfFile(`${parts[2]}.ndjson`) === undefined) {
      throw invalidQuery("cursor is not one this service gave.");
    }
    after = {
      started: Number(parts[1]),
      day: parts[2],
      line: Number(parts[3]),
    };
  }
  return { limit, after };
}

/** Whether an indexed entry passes the filter. */
function matches(entry, filter) {
  return (
    (filter.from === undefined || entry.started >= filter.from) &&
    (filter.to === undefined || entry.started < filter.to) &&
    (filter.launch === undefined || entry.launch === filter.launch) &&
    (filter.runtimes === undefined || filter.runtimes.has(entry.runtime)) &&
    (filter.kinds === undefined || filter.kinds.has(entry.kind)) &&
    (!filter.problems || isProblem(entry.outcome)) &&
    (filter.outcomes === undefined || filter.outcomes.has(entry.outcome)) &&
    (filter.name === undefined || entry.name === filter.name) &&
    (filter.prefix === undefined || entry.name.startsWith(filter.prefix)) &&
    (filter.trace === undefined || entry.trace === filter.trace) &&
    (filter.connection === undefined ||
      entry.connection === filter.connection) &&
    (filter.plugin === undefined || entry.plugin === filter.plugin) &&
    (filter.reasons === undefined || filter.reasons.has(entry.reason)) &&
    (filter.pluginVersion === undefined ||
      entry.pluginVersion === filter.pluginVersion)
  );
}

/** Newest first: the later start, then the later day file, then the later line. */
function newestFirst(a, b) {
  return (
    b.started - a.started ||
    (a.day < b.day ? 1 : a.day > b.day ? -1 : 0) ||
    b.line - a.line
  );
}

/** Oldest first, the order a trace's spans and the hours read in. */
const oldestFirst = (a, b) => -newestFirst(a, b);

const cursorOf = (entry) => `${entry.started}~${entry.day}~${entry.line}`;

/** The UTC day of an epoch time, `YYYY-MM-DD`. */
function dayOf(time) {
  return new Date(time).toISOString().slice(0, 10);
}

/** The day a file name holds, when it is a real day file. */
function dayOfFile(name) {
  const day = DAY_FILE.exec(name)?.[1];
  if (!day) return undefined;
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(start) && dayOf(start) === day ? day : undefined;
}

/** The epoch time a UTC day starts. */
const startOfDay = (day) => Date.parse(`${day}T00:00:00.000Z`);

/** The nearest-rank percentile of sorted values. */
function percentile(sorted, fraction) {
  if (sorted.length === 0) return undefined;
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

/** One string per distinct value, so a day's index holds each name once. */
function createInterner() {
  const strings = new Map();
  return (value) => {
    if (typeof value !== "string") return undefined;
    const known = strings.get(value);
    if (known !== undefined) return known;
    strings.set(value, value);
    return value;
  };
}

/**
 * The entry for an event line, or undefined when the line isn't an event:
 * a JSON object with the envelope's name, kind, runtime, outcome, start,
 * trace and span.
 */
function entryOf(event, intern) {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    return undefined;
  }
  const started =
    typeof event.started_at === "string" ? Date.parse(event.started_at) : NaN;
  if (
    typeof event.name !== "string" ||
    !KINDS.has(event.kind) ||
    !RUNTIMES.has(event.runtime) ||
    !OUTCOMES.has(event.outcome) ||
    !Number.isFinite(started) ||
    typeof event.trace_id !== "string" ||
    typeof event.span_id !== "string"
  ) {
    return undefined;
  }
  return {
    started,
    duration: Number.isFinite(event.duration_ms) ? event.duration_ms : 0,
    name: intern(event.name),
    kind: intern(event.kind),
    runtime: intern(event.runtime),
    outcome: intern(event.outcome),
    reason: intern(event.outcome_reason),
    trace: event.trace_id,
    span: event.span_id,
    parent:
      typeof event.parent_span_id === "string"
        ? event.parent_span_id
        : undefined,
    launch: intern(event.launch_id),
    connection: intern(event.connection?.id),
    plugin: intern(event.plugin?.id),
    pluginVersion: intern(event.plugin?.version),
  };
}

/** Most first, then the one whose last event started latest. */
const mostThenLatest = (a, b) => b.count - a.count || b.last - a.last;

/** Counts a problem in its group of name, outcome and reason, and its place. */
function countProblem(groups, key, entry) {
  let group = groups.get(key);
  if (!group) {
    group = {
      name: entry.name,
      outcome: entry.outcome,
      ...(entry.reason === undefined ? {} : { outcome_reason: entry.reason }),
      count: 0,
      last: entry.started,
      places: new Map(),
    };
    groups.set(key, group);
  }
  group.count += 1;
  group.last = Math.max(group.last, entry.started);
  // Where it happened: its connection, else its plugin.
  const place =
    entry.connection !== undefined
      ? { connection_id: entry.connection }
      : entry.plugin !== undefined
        ? { plugin_id: entry.plugin }
        : undefined;
  if (!place) return;
  const placeKey = place.connection_id ?? `plugin\n${place.plugin_id}`;
  const counted = group.places.get(placeKey);
  if (counted) {
    counted.count += 1;
    counted.last = Math.max(counted.last, entry.started);
  } else {
    group.places.set(placeKey, { ...place, count: 1, last: entry.started });
  }
}

/** Counts a plugin operation's timeout, crash or refusal by plugin and version. */
function countPluginProblem(problems, entry) {
  const key = [
    entry.plugin,
    entry.pluginVersion ?? "",
    entry.outcome,
    entry.reason ?? "",
  ].join("\n");
  const counted = problems.get(key);
  if (counted) {
    counted.count += 1;
    counted.last = Math.max(counted.last, entry.started);
    return;
  }
  problems.set(key, {
    plugin_id: entry.plugin,
    ...(entry.pluginVersion === undefined
      ? {}
      : { plugin_version: entry.pluginVersion }),
    outcome: entry.outcome,
    ...(entry.reason === undefined ? {} : { outcome_reason: entry.reason }),
    count: 1,
    last: entry.started,
  });
}

/** A sync's start, outcome and reason, as the Overview shows it. */
function syncEnd(sync) {
  return {
    started_at: new Date(sync.started).toISOString(),
    outcome: sync.outcome,
    ...(sync.reason === undefined ? {} : { outcome_reason: sync.reason }),
  };
}

/**
 * Each connection's backlog syncs, from their hops. A sync is a trace's
 * hops of one connection (the renderer's job, the local API's request and
 * the plugin's operation), so it counts once; a hop without a connection
 * joins its trace's one connection. A sync failed when a hop didn't end
 * `ok` or `noop`. Its outcome and reason are then the failed hop's that
 * started last with a reason, the innermost, which names the cause.
 * Connections with a failure come first, the latest failure first.
 */
function syncsOf(syncHops) {
  const connections = new Map();
  for (const hops of syncHops.values()) {
    const named = new Set(
      hops.map((hop) => hop.connection).filter((id) => id !== undefined),
    );
    for (const connection of named) {
      const own = hops
        .filter(
          (hop) =>
            hop.connection === connection ||
            (hop.connection === undefined && named.size === 1),
        )
        .sort(oldestFirst);
      const failed = own.filter((hop) => isProblem(hop.outcome));
      const cause =
        failed.findLast((hop) => hop.reason !== undefined) ?? failed.at(-1);
      const sync = {
        started: own[0].started,
        outcome: (cause ?? own[0]).outcome,
        reason: cause?.reason,
      };
      const counted = connections.get(connection) ?? {
        connection_id: connection,
        sync_count: 0,
        failed_count: 0,
        last: undefined,
        lastFailure: undefined,
      };
      counted.sync_count += 1;
      if (!counted.last || sync.started > counted.last.started) {
        counted.last = sync;
      }
      if (cause) {
        counted.failed_count += 1;
        if (!counted.lastFailure || sync.started > counted.lastFailure.started)
          counted.lastFailure = sync;
      }
      connections.set(connection, counted);
    }
  }
  return [...connections.values()]
    .sort(
      (a, b) =>
        (b.lastFailure?.started ?? -Infinity) -
          (a.lastFailure?.started ?? -Infinity) ||
        b.last.started - a.last.started,
    )
    .map(({ last, lastFailure, ...counted }) => ({
      ...counted,
      last: syncEnd(last),
      ...(lastFailure ? { last_failure: syncEnd(lastFailure) } : {}),
    }));
}

/**
 * The query service over the day files in `directory`. `launch` is this
 * launch's ID and when it started, for the Overview's "this launch". `fs`
 * and `now` are for tests.
 */
function createLocalLogQuery({
  directory,
  launch,
  fs = nodeFs,
  now = () => Date.now(),
}) {
  /** Day → its index, the most recently read last. */
  const indexes = new Map();
  /** Day → the refresh running for it, so two calls read a file once. */
  const refreshing = new Map();
  /** Owner → (id → { filter, deliver }): each window's tails. */
  const tails = new Map();

  /** The day files in the folder, newest first. A missing folder has none. */
  async function listedDays() {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => dayOfFile(entry.name))
      .filter((day) => day !== undefined)
      .sort()
      .reverse();
  }

  const fileOf = (day) => path.join(directory, `${day}.ndjson`);

  /** Reads `file` from `start` to its end, line by line, into `index`. */
  async function readInto(index, file, start, size) {
    const handle = await fs.open(file, "r");
    try {
      let position = start;
      let carry = Buffer.alloc(0);
      while (position < size) {
        const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, size - position));
        const { bytesRead } = await handle.read(
          chunk,
          0,
          chunk.length,
          position,
        );
        if (bytesRead === 0) break;
        const buffer =
          carry.length > 0
            ? Buffer.concat([carry, chunk.subarray(0, bytesRead)])
            : chunk.subarray(0, bytesRead);
        const bufferStart = position - carry.length;
        let lineStart = 0;
        for (
          let newline = buffer.indexOf(10, lineStart);
          newline !== -1;
          newline = buffer.indexOf(10, lineStart)
        ) {
          addLine(index, buffer, lineStart, newline, bufferStart + lineStart);
          lineStart = newline + 1;
        }
        carry = Buffer.from(buffer.subarray(lineStart));
        position += bytesRead;
        // Only whole lines count: one still being written waits.
        index.bytes = position - carry.length;
      }
    } finally {
      await handle.close();
    }
  }

  function addLine(index, buffer, start, end, offset) {
    if (end === start || (end === start + 1 && buffer[start] === 13)) return;
    let entry;
    try {
      entry = entryOf(
        JSON.parse(buffer.toString("utf8", start, end)),
        index.intern,
      );
    } catch {
      entry = undefined;
    }
    if (!entry) {
      index.skipped += 1;
      return;
    }
    // The same event written twice is read once.
    const key = `${entry.runtime}
${entry.trace}
${entry.span}`;
    if (index.keys.has(key)) return;
    index.keys.add(key);
    entry.day = index.day;
    entry.line = index.entries.length;
    entry.offset = offset;
    entry.length = end - start;
    index.entries.push(entry);
    const spans = index.byTrace.get(entry.trace);
    if (spans) spans.push(entry);
    else index.byTrace.set(entry.trace, [entry]);
  }

  function emptyIndex(day, stat) {
    return {
      day,
      bytes: 0,
      size: 0,
      identity: `${stat.ino}:${stat.birthtimeMs}`,
      mtimeMs: -1,
      entries: [],
      byTrace: new Map(),
      /** Each event's runtime, trace_id and span_id, to read a copy once. */
      keys: new Set(),
      skipped: 0,
      intern: createInterner(),
    };
  }

  /** The day's index, brought up to date with its file; undefined when it has none. */
  async function indexOf(day, { keep = true } = {}) {
    const running = refreshing.get(day);
    if (running) return running;
    const refresh = (async () => {
      let stat;
      try {
        stat = await fs.lstat(fileOf(day));
      } catch {
        stat = undefined;
      }
      if (!stat || !stat.isFile()) {
        indexes.delete(day);
        return undefined;
      }
      let index = indexes.get(day);
      const identity = `${stat.ino}:${stat.birthtimeMs}`;
      if (!index || index.identity !== identity || stat.size < index.size) {
        index = emptyIndex(day, stat);
      }
      if (stat.size !== index.size || stat.mtimeMs !== index.mtimeMs) {
        try {
          await readInto(index, fileOf(day), index.bytes, stat.size);
          index.size = stat.size;
          index.mtimeMs = stat.mtimeMs;
        } catch {
          // Gone or unreadable since: what was read stays, and the next
          // read goes on from there.
        }
      }
      // A day past the kept ones, read for one trace, is not kept: it would
      // push the newest day out, and each lookup after would read them all.
      if (!keep && !indexes.has(day)) return index;
      indexes.delete(day);
      indexes.set(day, index);
      while (indexes.size > MAX_INDEXED_DAYS) {
        indexes.delete(indexes.keys().next().value);
      }
      return index;
    })();
    refreshing.set(day, refresh);
    try {
      return await refresh;
    } finally {
      refreshing.delete(day);
    }
  }

  /**
   * The indexes of the days a range covers, newest first, and what reading
   * them skipped. Without a start, every day file up to the range's end. A
   * day file holds what was written that day, and an event is written when
   * it ends, so one that started before midnight and ended after it is in
   * the next day's file: the day after the range's end is read too, when it
   * has a file, and isn't counted missing when it has none. The callers
   * apply the range to each entry.
   */
  async function indexesFor(from, to) {
    const end = to ?? now();
    const lastDay = dayOf(end);
    const dayAfter = dayOf(startOfDay(lastDay) + DAY_MS);
    const firstDay = from === undefined ? undefined : dayOf(from);
    const listed = await listedDays();
    const found = [];
    let missing = 0;
    for (const day of listed) {
      if (day > dayAfter || (firstDay !== undefined && day < firstDay)) {
        continue;
      }
      const index = await indexOf(day);
      if (index) found.push(index);
      else if (day !== dayAfter) missing += 1;
    }
    // The days asked for with no file in the folder, counted, not listed.
    if (firstDay !== undefined) {
      const asked = (startOfDay(lastDay) - startOfDay(firstDay)) / DAY_MS + 1;
      const listedAsked = listed.filter(
        (day) => day >= firstDay && day <= lastDay,
      ).length;
      missing += asked - listedAsked;
    }
    return {
      indexes: found,
      stats: {
        file_count: found.length,
        missing_file_count: missing,
        skipped_line_count: found.reduce(
          (sum, { skipped }) => sum + skipped,
          0,
        ),
      },
    };
  }

  /**
   * The events of `entries`, read from their day files, in their order. An
   * entry whose line no longer holds its event is left out and counted.
   */
  async function eventsOf(entries) {
    const byDay = new Map();
    for (const entry of entries) {
      const list = byDay.get(entry.day);
      if (list) list.push(entry);
      else byDay.set(entry.day, [entry]);
    }
    const events = new Map();
    let stale = 0;
    for (const [day, list] of byDay) {
      let handle;
      try {
        handle = await fs.open(fileOf(day), "r");
      } catch {
        stale += list.length;
        continue;
      }
      try {
        for (const entry of list) {
          const buffer = Buffer.alloc(entry.length);
          let event;
          try {
            await handle.read(buffer, 0, entry.length, entry.offset);
            event = JSON.parse(buffer.toString("utf8"));
          } catch {
            event = undefined;
          }
          if (event?.span_id === entry.span) events.set(entry, event);
          else stale += 1;
        }
      } finally {
        await handle.close();
      }
    }
    return {
      events: entries
        .filter((entry) => events.has(entry))
        .map((entry) => events.get(entry)),
      eventOf: (entry) => events.get(entry),
      stale,
    };
  }

  /** The entries after the cursor, newest first, as one page. */
  function pageOf(sorted, page) {
    let first = 0;
    if (page.after) {
      const after = { ...page.after };
      first = sorted.findIndex((entry) => newestFirst(after, entry) < 0);
      if (first === -1) first = sorted.length;
    }
    const entries = sorted.slice(first, first + page.limit);
    const more = first + page.limit < sorted.length;
    return {
      entries,
      next_cursor: more && entries.length > 0 ? cursorOf(entries.at(-1)) : null,
    };
  }

  /** logs.query: the events that pass the filter, newest first, one page. */
  async function query(filterValue, pageValue) {
    const filter = readFilter(filterValue, QUERY_FILTER_KEYS);
    const page = readPage(pageValue);
    const { indexes: days, stats } = await indexesFor(filter.from, filter.to);
    const matched = [];
    for (const index of days) {
      for (const entry of index.entries) {
        if (matches(entry, filter)) matched.push(entry);
      }
    }
    matched.sort(newestFirst);
    const { entries, next_cursor } = pageOf(matched, page);
    const read = await eventsOf(entries);
    return {
      events: read.events,
      next_cursor,
      match_count: matched.length,
      ...stats,
      skipped_line_count: stats.skipped_line_count + read.stale,
    };
  }

  /**
   * Whether the day file holds `text` anywhere, read in chunks without
   * parsing a line; undefined when it can't be read.
   */
  async function fileHolds(day, text) {
    let handle;
    try {
      handle = await fs.open(fileOf(day), "r");
    } catch {
      return undefined;
    }
    try {
      const needle = Buffer.from(text);
      let carry = Buffer.alloc(0);
      for (let position = 0; ;) {
        const chunk = Buffer.alloc(READ_CHUNK_BYTES);
        const { bytesRead } = await handle.read(
          chunk,
          0,
          chunk.length,
          position,
        );
        if (bytesRead === 0) return false;
        const buffer = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
        if (buffer.includes(needle)) return true;
        carry = Buffer.from(buffer.subarray(-(needle.length - 1)));
        position += bytesRead;
      }
    } catch {
      return undefined;
    } finally {
      await handle.close();
    }
  }

  /**
   * logs.trace: every event of the trace, from any runtime, as a tree built
   * from `parent_span_id`. Each day file is searched once, since a span is
   * written the day it ends and a long trace's days need not be next to each
   * other. The days past the indexes kept are searched for the trace's ID
   * first and indexed only when they hold it, so a long retention doesn't
   * push the recent days out of memory.
   */
  async function trace(traceValue) {
    const traceId = formatted(traceValue, TRACE_ID, "trace_id");
    if (traceId === undefined) throw invalidQuery("trace_id is required.");
    const days = await listedDays();
    const entries = [];
    let skipped = 0;
    let fileCount = 0;
    for (let position = 0; position < days.length; position += 1) {
      const day = days[position];
      const past = position >= MAX_INDEXED_DAYS && !indexes.has(day);
      if (past) {
        const holds = await fileHolds(day, traceId);
        if (holds === undefined) continue;
        if (!holds) {
          fileCount += 1;
          continue;
        }
      }
      const index = await indexOf(day, { keep: !past });
      if (!index) continue;
      fileCount += 1;
      skipped += index.skipped;
      entries.push(...(index.byTrace.get(traceId) ?? []));
    }
    entries.sort(oldestFirst);
    const read = await eventsOf(entries);
    const seen = new Set();
    /** Span ID → the nodes with it: one per runtime that used it. */
    const bySpan = new Map();
    const ordered = [];
    for (const entry of entries) {
      const event = read.eventOf(entry);
      const key = `${entry.runtime}
${entry.span}`;
      if (!event || seen.has(key)) continue;
      seen.add(key);
      const node = {
        event,
        depth: 0,
        deepest_failure: false,
        missing_parent: false,
        children: [],
        entry,
      };
      const sharing = bySpan.get(entry.span);
      if (sharing) sharing.push(node);
      else bySpan.set(entry.span, [node]);
      ordered.push(node);
    }
    // A parent is found by its span ID. When runtimes share one, the child's
    // own runtime's span is its parent, then main's or the API's: the
    // renderer picks its own IDs, so its span never takes another's child.
    const parentOf = (node) => {
      const candidates = (bySpan.get(node.entry.parent) ?? []).filter(
        (candidate) => candidate !== node,
      );
      return (
        candidates.find(({ entry }) => entry.runtime === node.entry.runtime) ??
        candidates.find(({ entry }) => entry.runtime !== "renderer") ??
        candidates[0]
      );
    };
    const parents = new Map();
    const roots = [];
    for (const node of ordered) {
      const parent =
        node.entry.parent === undefined ? undefined : parentOf(node);
      if (parent) {
        parents.set(node, parent);
        parent.children.push(node);
      } else {
        node.missing_parent = node.entry.parent !== undefined;
        roots.push(node);
      }
    }
    // Depths from the roots; a span caught in a cycle of parents becomes a root.
    const visited = new Set();
    const walk = (start) => {
      const stack = [start];
      while (stack.length > 0) {
        const node = stack.pop();
        visited.add(node);
        for (const child of node.children) {
          if (visited.has(child)) continue;
          child.depth = node.depth + 1;
          stack.push(child);
        }
      }
    };
    roots.forEach(walk);
    for (const node of ordered) {
      if (visited.has(node)) continue;
      const parent = parents.get(node);
      parent.children = parent.children.filter((child) => child !== node);
      node.missing_parent = true;
      node.depth = 0;
      roots.push(node);
      walk(node);
    }
    roots.sort((a, b) => oldestFirst(a.entry, b.entry));
    let deepest;
    for (const node of ordered) {
      if (!isProblem(node.entry.outcome)) continue;
      if (!deepest || node.depth > deepest.depth) deepest = node;
    }
    if (deepest) deepest.deepest_failure = true;
    for (const node of ordered) delete node.entry;
    return {
      trace_id: traceId,
      roots,
      event_count: ordered.length,
      runtimes: [...new Set(ordered.map(({ event }) => event.runtime))],
      deepest_failure_span_id: deepest ? deepest.event.span_id : null,
      file_count: fileCount,
      missing_file_count: 0,
      skipped_line_count: skipped + read.stale,
    };
  }

  /**
   * logs.actions: one row per trace root, an event with no parent span,
   * newest first. `failed`: a span of its trace didn't end ok or noop.
   * `slow`: it took its name's p95 or longer, among the roots of that name
   * in the range, once there are enough of them.
   */
  async function actions(filterValue, pageValue) {
    const value = plainObject(
      filterValue,
      [...FILTER_KEYS, "show"],
      "The filter",
    );
    const { show = "all", ...rest } = value;
    if (!ACTION_VIEWS.has(show)) throw invalidQuery("show is outside its set.");
    const filter = readFilter(rest);
    const page = readPage(pageValue);
    const { indexes: days, stats } = await indexesFor(filter.from, filter.to);
    const traces = new Map();
    const roots = [];
    const durations = new Map();
    for (const index of days) {
      for (const entry of index.entries) {
        let traceStats = traces.get(entry.trace);
        if (!traceStats) {
          traceStats = { spans: 0, problems: 0 };
          traces.set(entry.trace, traceStats);
        }
        traceStats.spans += 1;
        if (isProblem(entry.outcome)) traceStats.problems += 1;
        if (entry.parent === undefined) {
          // The p95 is over the name's roots that started in the range.
          if (
            (filter.from === undefined || entry.started >= filter.from) &&
            (filter.to === undefined || entry.started < filter.to)
          ) {
            const list = durations.get(entry.name) ?? [];
            list.push(entry.duration);
            durations.set(entry.name, list);
          }
          if (matches(entry, filter)) roots.push(entry);
        }
      }
    }
    const p95 = new Map();
    for (const [name, list] of durations) {
      if (list.length < MIN_SLOW_SAMPLES) continue;
      p95.set(
        name,
        percentile(
          list.sort((a, b) => a - b),
          0.95,
        ),
      );
    }
    const slowOf = (entry) =>
      p95.has(entry.name) && entry.duration >= p95.get(entry.name);
    const shown = roots.filter((entry) =>
      show === "failed"
        ? traces.get(entry.trace).problems > 0
        : show === "slow"
          ? slowOf(entry)
          : true,
    );
    shown.sort(newestFirst);
    const { entries, next_cursor } = pageOf(shown, page);
    // The runtimes of each row's trace, oldest span first.
    const runtimesOf = new Map();
    const wanted = new Set(entries.map((entry) => entry.trace));
    for (const index of days) {
      for (const traceId of wanted) {
        for (const span of index.byTrace.get(traceId) ?? []) {
          const list = runtimesOf.get(traceId) ?? [];
          list.push(span);
          runtimesOf.set(traceId, list);
        }
      }
    }
    const read = await eventsOf(entries);
    return {
      show,
      actions: entries
        .filter((entry) => read.eventOf(entry) !== undefined)
        .map((entry) => {
          const traceStats = traces.get(entry.trace);
          return {
            event: read.eventOf(entry),
            span_count: traceStats.spans,
            problem_count: traceStats.problems,
            runtimes: [
              ...new Set(
                (runtimesOf.get(entry.trace) ?? [])
                  .sort(oldestFirst)
                  .map((span) => span.runtime),
              ),
            ],
            slow: slowOf(entry),
            p95_ms: p95.get(entry.name) ?? null,
          };
        }),
      next_cursor,
      match_count: shown.length,
      ...stats,
      skipped_line_count: stats.skipped_line_count + read.stale,
    };
  }

  /**
   * logs.aggregate: the Overview over this launch, 24 hours or 7 days:
   * counts by name, outcome and reason; the problems among them with when
   * the last one started and where they happened; each connection's backlog
   * syncs; the plugins' timeouts, crashes and capacity refusals by version;
   * problems per hour by outcome; p50 and p95 durations per name; the
   * latest app.launch; the crashes.
   */
  async function aggregate(value) {
    const { range } = plainObject(value, ["range"], "The range", false);
    if (!AGGREGATE_RANGES.has(range)) {
      throw invalidQuery("range is launch, 24h or 7d.");
    }
    const time = now();
    const forLaunch = range === "launch";
    const from = forLaunch
      ? launch.started_at_ms
      : time - (range === "24h" ? DAY_MS : 7 * DAY_MS);
    // A launch's first events can start before main knew it had launched.
    const { indexes: days, stats } = await indexesFor(
      forLaunch ? from - HOUR_MS : from,
      time,
    );
    const counts = new Map();
    const problemGroups = new Map();
    /** Trace → its backlog.sync hops: one sync per trace and connection. */
    const syncHops = new Map();
    const pluginProblems = new Map();
    const durations = new Map();
    const problems = new Map();
    let latestLaunch;
    const crashes = [];
    let firstHour = Math.floor(from / HOUR_MS) * HOUR_MS;
    for (const index of days) {
      for (const entry of index.entries) {
        if (
          forLaunch ? entry.launch !== launch.launch_id : entry.started < from
        ) {
          continue;
        }
        if (entry.started > time) continue;
        const key = `${entry.name}\n${entry.outcome}\n${entry.reason ?? ""}`;
        const counted = counts.get(key);
        if (counted) counted.count += 1;
        else {
          counts.set(key, {
            name: entry.name,
            outcome: entry.outcome,
            ...(entry.reason === undefined
              ? {}
              : { outcome_reason: entry.reason }),
            count: 1,
          });
        }
        const list = durations.get(entry.name) ?? [];
        list.push(entry.duration);
        durations.set(entry.name, list);
        const hour = Math.floor(entry.started / HOUR_MS) * HOUR_MS;
        if (hour < firstHour) firstHour = hour;
        if (entry.name === "backlog.sync") {
          const hops = syncHops.get(entry.trace) ?? [];
          hops.push(entry);
          syncHops.set(entry.trace, hops);
        }
        if (isProblem(entry.outcome)) {
          countProblem(problemGroups, key, entry);
          if (
            entry.kind === "plugin_operation" &&
            entry.plugin !== undefined &&
            (entry.outcome === "timeout" ||
              PLUGIN_PROBLEM_REASONS.has(entry.reason))
          ) {
            countPluginProblem(pluginProblems, entry);
          }
          const byOutcome = problems.get(hour) ?? {};
          byOutcome[entry.outcome] = (byOutcome[entry.outcome] ?? 0) + 1;
          problems.set(hour, byOutcome);
        }
        if (
          entry.name === "app.launch" &&
          (!latestLaunch || newestFirst(entry, latestLaunch) < 0)
        ) {
          latestLaunch = entry;
        }
        if (entry.kind === "crash") crashes.push(entry);
      }
    }
    crashes.sort(newestFirst);
    const shownCrashes = crashes.slice(0, MAX_CRASHES);
    const read = await eventsOf([
      ...(latestLaunch ? [latestLaunch] : []),
      ...shownCrashes,
    ]);
    const perHour = [];
    for (let hour = firstHour; hour <= time; hour += HOUR_MS) {
      perHour.push({
        hour: new Date(hour).toISOString(),
        counts: problems.get(hour) ?? {},
      });
    }
    return {
      range,
      from: new Date(from).toISOString(),
      to: new Date(time).toISOString(),
      counts: [...counts.values()].sort(
        (a, b) =>
          b.count - a.count ||
          a.name.localeCompare(b.name) ||
          a.outcome.localeCompare(b.outcome) ||
          (a.outcome_reason ?? "").localeCompare(b.outcome_reason ?? ""),
      ),
      problems: [...problemGroups.values()]
        .sort(mostThenLatest)
        .slice(0, MAX_PROBLEMS)
        .map(({ places, last, ...group }) => ({
          ...group,
          last_at: new Date(last).toISOString(),
          places: [...places.values()]
            .sort(mostThenLatest)
            .slice(0, MAX_PROBLEM_PLACES)
            .map(({ last: _last, ...place }) => place),
        })),
      syncs: syncsOf(syncHops),
      plugin_problems: [...pluginProblems.values()]
        .sort(mostThenLatest)
        .map(({ last, ...problem }) => ({
          ...problem,
          last_at: new Date(last).toISOString(),
        })),
      problems_per_hour: perHour,
      durations: [...durations.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, list]) => {
          const sorted = list.sort((a, b) => a - b);
          return {
            name,
            count: sorted.length,
            p50_ms: percentile(sorted, 0.5),
            p95_ms: percentile(sorted, 0.95),
          };
        }),
      latest_launch: latestLaunch ? (read.eventOf(latestLaunch) ?? null) : null,
      crash_count: crashes.length,
      crashes: shownCrashes
        .map((entry) => read.eventOf(entry))
        .filter((event) => event !== undefined),
      ...stats,
      skipped_line_count: stats.skipped_line_count + read.stale,
    };
  }

  /**
   * logs.tail: from now on, `deliver` gets the events written that pass the
   * filter, in one call per write. `owner` is the window that asked, `id`
   * its own number for the tail. Throws when the filter or the ID is
   * invalid, or the window holds too many tails.
   */
  function subscribe(owner, id, filterValue, deliver) {
    if (!Number.isInteger(id) || id < 1 || id > 2 ** 31) {
      throw invalidQuery("The tail's id is a positive integer.");
    }
    const filter = readFilter(filterValue, TAIL_FILTER_KEYS, false);
    const owned = tails.get(owner) ?? new Map();
    if (!owned.has(id) && owned.size >= MAX_TAILS_PER_OWNER) {
      throw invalidQuery(
        `A window holds at most ${MAX_TAILS_PER_OWNER} tails.`,
      );
    }
    owned.set(id, { filter, deliver });
    tails.set(owner, owned);
  }

  function unsubscribe(owner, id) {
    const owned = tails.get(owner);
    owned?.delete(id);
    if (owned?.size === 0) tails.delete(owner);
  }

  /**
   * Hands the lines the log file just wrote to each tail. It emits nothing
   * and never throws: a tail that fails is skipped.
   */
  function written(lines) {
    if (tails.size === 0) return;
    const intern = createInterner();
    const parsed = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const entry = entryOf(event, intern);
        if (entry && !VIEWER_EVENTS.has(entry.name))
          parsed.push({ entry, event });
      } catch {
        // Not an event: no tail shows it.
      }
    }
    if (parsed.length === 0) return;
    for (const owned of [...tails.values()]) {
      for (const { filter, deliver } of [...owned.values()]) {
        const events = parsed
          .filter(({ entry }) => matches(entry, filter))
          .map(({ event }) => event);
        if (events.length === 0) continue;
        try {
          deliver(events);
        } catch {
          // One tail's failure never stops the others or the write.
        }
      }
    }
  }

  return {
    query,
    trace,
    actions,
    aggregate,
    subscribe,
    unsubscribe,
    /** Ends every tail of a window that closed or loaded another page. */
    dropOwner: (owner) => {
      tails.delete(owner);
    },
    subscriptionCount: (owner) => tails.get(owner)?.size ?? 0,
    written,
  };
}

module.exports = {
  INVALID_LOG_QUERY,
  MAX_PAGE_SIZE,
  createLocalLogQuery,
};
