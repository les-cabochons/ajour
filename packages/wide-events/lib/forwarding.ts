import type {
  Envelope,
  Kind,
  Outcome,
  Runtime,
  Surface,
  Trigger,
} from "./envelope.ts";
import type { Catalog } from "./fields.ts";
import { isAccepting, type Sink } from "./sinks.ts";

type Event = Envelope & Record<string, unknown>;

/**
 * What one runtime sends another to write: the renderer's events, in a batch
 * over IPC to the desktop main process's local log file (#440).
 */
export interface ForwardedBatch {
  events: readonly Event[];
  /**
   * The events dropped since the last batch that was sent, because their
   * batch couldn't be sent. Main counts them on `logs.sweep`.
   */
  unsent_event_count: number;
}

/** How long an event waits before its batch is sent. */
export const FORWARD_FLUSH_MS = 1000;

/** The most events in a batch: a batch is sent as soon as it holds this many. */
export const FORWARD_BATCH_SIZE = 100;

/**
 * The most events a batch may say the renderer couldn't send before it. A
 * page that never reaches main drops 100 events a batch, so a thousand
 * batches' worth is already past counting: a larger number is capped, not
 * believed.
 */
export const MAX_UNSENT_EVENT_COUNT = FORWARD_BATCH_SIZE * 1000;

/**
 * The longest event, in JSON characters, that a forwarded batch may carry.
 * The renderer's largest events, with 50 steps and 50 step failures, stay
 * well under it.
 */
export const MAX_FORWARDED_EVENT_CHARS = 16 * 1024;

export interface ForwardingSinkOptions {
  /**
   * Sends one batch to the runtime that writes it. It must not wait for an
   * answer. A throw drops the batch: it is counted, never sent again.
   */
  send(batch: ForwardedBatch): void;
  /** Whether events are forwarded right now: the user's logging setting. */
  accepting(): boolean;
}

/** A sink that sends its events elsewhere in batches. */
export interface ForwardingSink extends Sink {
  /** Sends what is waiting at once, as the page does when it hides. */
  flush(): void;
}

/**
 * The renderer's side of forwarding (#440): it keeps events and sends them
 * in one batch a second after the first one waits, or as soon as 100 wait,
 * or when `flush` is called. It sets no timer while nothing waits. A batch
 * whose send throws is dropped and its events counted, in the next batch
 * that is sent: it never retries, and never waits. While `accepting` answers
 * false the emitter builds no event for it, and what was waiting when it
 * turned false is dropped instead of sent.
 */
export function createForwardingSink(
  options: ForwardingSinkOptions,
): ForwardingSink {
  let waiting: Event[] = [];
  let unsent = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sink: ForwardingSink = {
    accepting: () => options.accepting(),
    emit(event) {
      waiting.push(event);
      if (waiting.length >= FORWARD_BATCH_SIZE) sink.flush();
      else timer ??= setTimeout(sink.flush, FORWARD_FLUSH_MS);
    },
    flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (waiting.length === 0) return;
      const events = waiting;
      waiting = [];
      // Logging turned off since these were built: they go nowhere.
      if (!isAccepting(sink)) return;
      try {
        options.send({ events, unsent_event_count: unsent });
        unsent = 0;
      } catch {
        unsent = Math.min(unsent + events.length, MAX_UNSENT_EVENT_COUNT);
      }
    },
  };
  return sink;
}

/** Which runtime a batch comes from, and the launch it must belong to. */
export interface ForwardedFrom {
  runtime: Runtime;
  launch_id: string;
}

/** The events of a batch that may be written, and what was left out. */
export interface ForwardedEvents {
  events: Event[];
  /**
   * Events whose envelope wasn't valid, that the renderer doesn't emit, or
   * that went past the batch's size, and every event of a batch refused
   * whole.
   */
  rejected_event_count: number;
  /** 1 when the batch was refused whole, because it held too many events. */
  rejected_batch_count: number;
  /** What the batch says its runtime couldn't send before it. */
  unsent_event_count: number;
}

const KINDS = new Set<Kind>([
  "command",
  "job",
  "request",
  "ipc",
  "plugin_operation",
  "lifecycle",
  "navigation",
  "crash",
]);
const OUTCOMES = new Set<Outcome>([
  "ok",
  "noop",
  "refused",
  "cancelled",
  "timeout",
  "error",
]);
const TRIGGERS = new Set<Trigger>([
  "user",
  "agent",
  "schedule",
  "boot",
  "system",
]);
const SURFACES = new Set<Surface>([
  "button",
  "popover",
  "shortcut",
  "item_key",
  "palette",
  "context_menu",
  "app_menu",
  "drag",
  "editor",
  "dialog",
  "toast",
]);
/**
 * The kinds the renderer never emits, whatever an event's entry allows: the
 * main process's IPC calls, and the requests and plugin operations of the
 * local API and its plugins.
 */
export const MAIN_ONLY_KINDS: readonly Kind[] = [
  "ipc",
  "request",
  "plugin_operation",
];
/** The all-zero IDs W3C Trace Context declares invalid. */
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const STARTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
/** A window ID: the renderer's `crypto.randomUUID()`. */
const WINDOW_ID = /^[0-9a-f-]{36}$/;

/**
 * The receiving side of forwarding: it reads a batch from another process,
 * such as the renderer's over IPC, and returns only the events whose
 * envelope is valid, for `from`'s runtime and launch. It trusts nothing in
 * the batch. `emits` is every name the sending runtime emits, with the kinds
 * it emits it as (`rendererEmits`): an event is left out, and counted, when
 * its name and kind aren't in it, so a page can't write an event only the
 * main process emits, such as a failed launch or a refused IPC call. The
 * kinds `ipc`, `request` and `plugin_operation` are never accepted. An event
 * is also left out when its name isn't in the catalog or doesn't allow its
 * kind, when it claims another runtime or launch, when an envelope field is
 * missing or outside its closed set, or when it is longer than
 * `MAX_FORWARDED_EVENT_CHARS`. A batch of more than `FORWARD_BATCH_SIZE`
 * events is refused whole, and counted. An `outcome_reason` outside the
 * name's closed set is left out of its event, and so is an error's message:
 * the renderer never scrubs one. What the envelope check passes still goes
 * through the sink's privacy filter, which drops the fields the catalog
 * doesn't declare.
 */
export function createForwardedBatchReader(
  catalog: Catalog,
  emits: ReadonlyMap<string, readonly Kind[]>,
) {
  return (batch: unknown, from: ForwardedFrom): ForwardedEvents => {
    const events: Event[] = [];
    let rejected = 0;
    let rejectedBatches = 0;
    const record = isRecord(batch) ? batch : {};
    const sent = Array.isArray(record.events) ? record.events : [];
    if (sent.length > FORWARD_BATCH_SIZE) {
      rejected = sent.length;
      rejectedBatches = 1;
    } else {
      for (const value of sent) {
        const event = envelopeOf(value, catalog, emits, from);
        if (event) events.push(event);
        else rejected += 1;
      }
    }
    const unsent = record.unsent_event_count;
    return {
      events,
      rejected_event_count: rejected,
      rejected_batch_count: rejectedBatches,
      unsent_event_count:
        typeof unsent === "number" && Number.isSafeInteger(unsent) && unsent > 0
          ? Math.min(unsent, MAX_UNSENT_EVENT_COUNT)
          : 0,
    };
  };
}

/** A copy of `value` when its envelope is valid, or null. */
function envelopeOf(
  value: unknown,
  catalog: Catalog,
  emits: ReadonlyMap<string, readonly Kind[]>,
  from: ForwardedFrom,
): Event | null {
  if (!isRecord(value) || !fitsInALine(value)) return null;
  const { name, kind } = value;
  if (typeof name !== "string" || !Object.hasOwn(catalog.events, name)) {
    return null;
  }
  const spec = catalog.events[name]!;
  const valid =
    value.schema === 1 &&
    KINDS.has(kind as Kind) &&
    !MAIN_ONLY_KINDS.includes(kind as Kind) &&
    spec.kinds.includes(kind as Kind) &&
    emits.get(name)?.includes(kind as Kind) === true &&
    value.runtime === from.runtime &&
    value.launch_id === from.launch_id &&
    OUTCOMES.has(value.outcome as Outcome) &&
    TRIGGERS.has(value.trigger as Trigger) &&
    (value.surface === undefined || SURFACES.has(value.surface as Surface)) &&
    typeof value.started_at === "string" &&
    STARTED_AT.test(value.started_at) &&
    Number.isFinite(Date.parse(value.started_at)) &&
    typeof value.duration_ms === "number" &&
    Number.isFinite(value.duration_ms) &&
    value.duration_ms >= 0 &&
    matches(value.trace_id, TRACE_ID) &&
    value.trace_id !== ZERO_TRACE_ID &&
    matches(value.span_id, SPAN_ID) &&
    value.span_id !== ZERO_SPAN_ID &&
    (value.parent_span_id === undefined ||
      (matches(value.parent_span_id, SPAN_ID) &&
        value.parent_span_id !== ZERO_SPAN_ID)) &&
    (value.window_id === undefined || matches(value.window_id, WINDOW_ID)) &&
    isRecord(value.app) &&
    isRecord(value.device);
  if (!valid) return null;
  const event = { ...value } as Event;
  if (
    event.outcome_reason !== undefined &&
    !spec.reasons?.includes(event.outcome_reason)
  ) {
    delete event.outcome_reason;
  }
  if (isRecord(event.error) && "message" in event.error) {
    const { message: _message, ...error } = event.error;
    event.error = error as Event["error"];
  }
  return event;
}

/** Whether `value` is JSON, no longer than one forwarded event may be. */
function fitsInALine(value: unknown) {
  try {
    const line = JSON.stringify(value);
    return typeof line === "string" && line.length <= MAX_FORWARDED_EVENT_CHARS;
  } catch {
    // A cycle or a BigInt, which a structured clone can carry.
    return false;
  }
}

function matches(value: unknown, pattern: RegExp) {
  return typeof value === "string" && pattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
