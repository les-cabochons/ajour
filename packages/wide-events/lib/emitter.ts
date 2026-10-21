import type {
  Envelope,
  EventError,
  Kind,
  Outcome,
  RuntimeContext,
  Surface,
  Trigger,
} from "./envelope.ts";
import type {
  Catalog,
  CounterName,
  EventName,
  FieldsOf,
  KindOf,
  ReasonOf,
} from "./fields.ts";
import { randomHex } from "./ids.ts";
import { synchronousScope, type ScopeStore } from "./scope.ts";
import { scrubErrorMessage } from "./scrub.ts";
import type { Sink } from "./sinks.ts";
import { nowhere } from "./sinks.ts";
import {
  decodeTraceparent,
  encodeTraceparent,
  type TraceParent,
} from "./trace-context.ts";

export interface EmitterOptions<C extends Catalog> {
  catalog: C;
  context: RuntimeContext;
  /** Where events go. Defaults to `nowhere`, which drops them. */
  sink?: Sink;
  /**
   * Tracks the active unit. Defaults to the browser's synchronous scope; Node
   * runtimes pass `asyncContextScope()` from the node entry point.
   */
  scope?: ScopeStore;
  /** The runtime's paths, which the scrubber replaces in every error message. */
  scrub?: { homeDirectory?: string; userDataPath?: string };
  /** Epoch milliseconds. Tests pass a fake clock. */
  now?: () => number;
}

export interface UnitInit<C extends Catalog, Name extends EventName<C>> {
  kind: KindOf<C, Name>;
  trigger: Trigger;
  surface?: Surface;
  /**
   * Work that outlives the unit that starts it, such as an agent run a
   * request starts: it emits its own event, as a child span, instead of
   * folding into the active unit.
   */
  detached?: boolean;
  /**
   * The span in another runtime that started this unit, such as an incoming
   * `traceparent` header. The unit becomes its child span. An invalid header
   * is ignored.
   */
  parent?: string | TraceParent;
}

export interface FailOptions<Reason extends string> {
  /** A thrown timeout is a `timeout`, not an `error`. */
  outcome?: "error" | "timeout";
  reason?: Reason;
  retriable?: boolean;
  /** The secret connection values the failed call could have echoed. */
  secrets?: readonly string[];
}

export interface Unit<C extends Catalog, Name extends EventName<C>> {
  /** Adds the unit's own fields. Nested objects merge; other values replace. */
  set(fields: FieldsOf<C, Name>): this;
  /** Adds `amount` to a counter. A nested unit counts into the outer event. */
  count(counter: CounterName<C>, amount?: number): this;
  /** Records the error the unit failed with. The unit still ends with `end`. */
  fail(error: unknown, options?: FailOptions<ReasonOf<C, Name>>): this;
  /** Records that the unit was refused, and why when it is known. */
  refuse(reason?: ReasonOf<C, Name>): this;
  /** Records that the unit was cancelled, and why. */
  cancel(reason?: ReasonOf<C, Name>): this;
  /**
   * Emits the unit's event, once: a later call changes nothing. The outcome
   * defaults to the one recorded, or `ok`.
   */
  end(outcome?: Outcome, reason?: ReasonOf<C, Name>): void;
  /**
   * Runs `work` with this unit active, so the units it starts fold into this
   * one. In the browser an async unit leaves its scope at its first await,
   * and re-enters it this way around the store commands it runs after.
   */
  enter<Result>(work: () => Result): Result;
  /**
   * The `traceparent` header for a call this unit makes to another runtime.
   * A folded unit sends the span of the unit it folds into.
   */
  traceparent(): string;
  /**
   * Renames the unit once its seam knows the operation: an MCP request
   * becomes `agent_tool.call` once its method is read. The new name must
   * allow the unit's kind.
   */
  rename<Next extends EventName<C>>(
    name: Next & (KindOf<C, Name> extends KindOf<C, Next> ? Next : never),
  ): Unit<C, Next>;
}

export interface Emitter<C extends Catalog> {
  /** Opens a unit of work. It emits when `end` is called. */
  start<Name extends EventName<C>>(
    name: Name,
    init: UnitInit<C, Name>,
  ): Unit<C, Name>;
  /**
   * Runs `work` as a unit of work, active while it runs, and ends it in
   * every path: when it returns, throws, resolves or rejects. A sync `work`
   * stays sync.
   */
  run<Name extends EventName<C>, Result>(
    name: Name,
    init: UnitInit<C, Name>,
    work: (unit: Unit<C, Name>) => Result,
  ): Result;
  /** The active unit, so the code doing the work can add to it. */
  current(): Unit<C, EventName<C>> | undefined;
}

type Fields = Record<string, unknown>;

class UnitState {
  name: string;
  readonly kind: Kind;
  readonly trigger: Trigger;
  readonly surface?: Surface;
  readonly startedAt: number;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly emitter: EmitterState;
  /** The unit that emits for this one: itself, or the outer unit it folds into. */
  readonly root: UnitState;
  /** Where a folded unit's name sits in the outer unit's steps. */
  readonly step: number = -1;
  fields: Fields = {};
  steps?: string[];
  counts?: Record<string, number>;
  outcome?: Outcome;
  reason?: string;
  error?: EventError;
  ended = false;

  constructor(
    emitter: EmitterState,
    name: string,
    init: { kind: Kind; trigger: Trigger; surface?: Surface },
    parent:
      { fold: true; outer: UnitState } | { fold: false; trace?: TraceParent },
  ) {
    this.emitter = emitter;
    this.name = name;
    this.kind = init.kind;
    this.trigger = init.trigger;
    if (init.surface) this.surface = init.surface;
    this.startedAt = emitter.now();
    if (parent.fold) {
      this.root = parent.outer.root;
      this.traceId = this.root.traceId;
      this.spanId = this.root.spanId;
      this.step = (this.root.steps ??= []).push(name) - 1;
    } else {
      this.root = this;
      this.traceId = parent.trace?.trace_id ?? randomHex(16);
      this.spanId = randomHex(8);
      if (parent.trace) this.parentSpanId = parent.trace.span_id;
    }
  }

  get folded() {
    return this.root !== this;
  }

  set(fields: Fields) {
    if (!this.ended && !this.folded) mergeInto(this.fields, fields);
    return this;
  }

  count(counter: string, amount = 1) {
    const { root } = this;
    if (this.ended || root.ended) return this;
    const counts = (root.counts ??= {});
    counts[counter] = (counts[counter] ?? 0) + amount;
    return this;
  }

  fail(error: unknown, options: FailOptions<string> = {}) {
    if (this.ended) return this;
    this.outcome = options.outcome ?? "error";
    this.reason = options.reason;
    this.error = this.emitter.describe(error, options);
    return this;
  }

  refuse(reason?: string) {
    if (this.ended) return this;
    this.outcome = "refused";
    this.reason = reason;
    return this;
  }

  cancel(reason?: string) {
    if (this.ended) return this;
    this.outcome = "cancelled";
    this.reason = reason;
    return this;
  }

  /** A thrown error ends the unit as an error, unless the work recorded its outcome. */
  threw(error: unknown) {
    if (this.ended) return;
    if (this.outcome === undefined) this.fail(error);
    else this.error ??= this.emitter.describe(error);
  }

  end(outcome?: Outcome, reason?: string) {
    if (this.ended) return;
    this.ended = true;
    if (outcome !== undefined) {
      this.outcome = outcome;
      if (reason !== undefined) this.reason = reason;
    }
    // A folded unit emits nothing of its own.
    if (!this.folded) this.emitter.emit(this);
  }

  enter<Result>(work: () => Result): Result {
    return this.emitter.scope.run(this, work);
  }

  traceparent() {
    return encodeTraceparent({
      trace_id: this.traceId,
      span_id: this.spanId,
    });
  }

  rename(name: string) {
    if (this.ended) return this;
    this.name = name;
    if (this.folded && this.root.steps) this.root.steps[this.step] = name;
    return this;
  }
}

/** Merges `source` into `target`: plain objects merge, other values replace. */
function mergeInto(target: Fields, source: Fields) {
  for (const key in source) {
    const value = source[key];
    if (value === undefined) continue;
    const existing = target[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      mergeInto(existing, value);
    } else {
      target[key] = isPlainObject(value) ? mergeInto({}, value) : value;
    }
  }
  return target;
}

function isPlainObject(value: unknown): value is Fields {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

class EmitterState {
  readonly sink: Sink;
  readonly now: () => number;
  readonly context: RuntimeContext;
  readonly scope: ScopeStore;
  readonly paths: { homeDirectory?: string; userDataPath?: string };

  constructor(options: EmitterOptions<Catalog>) {
    this.sink = options.sink ?? nowhere;
    this.now = options.now ?? Date.now;
    this.context = options.context;
    this.scope = options.scope ?? synchronousScope();
    this.paths = options.scrub ?? {};
  }

  /** A thrown value as an event holds it: its message only once scrubbed. */
  describe(
    error: unknown,
    options: { retriable?: boolean; secrets?: readonly string[] } = {},
  ): EventError {
    const described: EventError =
      error instanceof Error
        ? { type: error.name }
        : { type: error === null ? "null" : typeof error };
    const code = (error as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "string") described.code = code;
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";
    if (message) {
      described.message = scrubErrorMessage(message, {
        ...this.paths,
        secrets: options.secrets,
      });
    }
    if (options.retriable !== undefined)
      described.retriable = options.retriable;
    return described;
  }

  /** The active unit, while it is open. */
  active(): UnitState | undefined {
    const unit = this.scope.active() as UnitState | undefined;
    return unit && !unit.ended && !unit.root.ended ? unit : undefined;
  }

  start(name: string, init: UnitInit<Catalog, string>) {
    // A unit started from another runtime's span is that span's child.
    if (init.parent !== undefined) {
      const trace =
        typeof init.parent === "string"
          ? decodeTraceparent(init.parent)
          : init.parent;
      return new UnitState(this, name, init, { fold: false, trace });
    }
    const outer = this.active();
    if (!outer) return new UnitState(this, name, init, { fold: false });
    // A plugin operation crosses into the worker's runtime, so it always
    // emits its own event. So does detached work.
    if (init.detached || init.kind === "plugin_operation") {
      return new UnitState(this, name, init, {
        fold: false,
        trace: { trace_id: outer.traceId, span_id: outer.spanId },
      });
    }
    return new UnitState(this, name, init, { fold: true, outer });
  }

  emit(unit: UnitState) {
    // The default sink drops the event, so it is never built.
    if (this.sink === nowhere) return;
    const { context } = this;
    const event: Envelope & Fields = {
      schema: 1,
      name: unit.name,
      kind: unit.kind,
      runtime: context.runtime,
      outcome: unit.outcome ?? "ok",
      started_at: new Date(unit.startedAt).toISOString(),
      duration_ms: this.now() - unit.startedAt,
      trace_id: unit.traceId,
      span_id: unit.spanId,
      launch_id: context.launch_id,
      trigger: unit.trigger,
      app: context.app,
      device: context.device,
      ...unit.fields,
    };
    if (unit.reason !== undefined) event.outcome_reason = unit.reason;
    if (unit.parentSpanId) event.parent_span_id = unit.parentSpanId;
    if (context.window_id) event.window_id = context.window_id;
    if (unit.surface) event.surface = unit.surface;
    if (unit.steps) event.steps = unit.steps;
    if (unit.counts) event.counts = unit.counts;
    if (unit.error) event.error = unit.error;
    try {
      this.sink.emit(event);
    } catch {
      // A sink that throws must not change what the work does.
    }
  }
}

export function createEmitter<C extends Catalog>(
  options: EmitterOptions<C>,
): Emitter<C> {
  const state = new EmitterState(options);
  return {
    start: ((name, init) => state.start(name, init)) as Emitter<C>["start"],
    run(name, init, work) {
      const unit = state.start(name, init);
      let result;
      try {
        result = unit.enter(() => work(unit as never));
      } catch (error) {
        unit.threw(error);
        unit.end();
        throw error;
      }
      if (!isPromiseLike(result)) {
        unit.end();
        return result;
      }
      return Promise.resolve(result).then(
        (value) => {
          unit.end();
          return value;
        },
        (error: unknown) => {
          unit.threw(error);
          unit.end();
          throw error;
        },
      ) as unknown as typeof result;
    },
    current: () => state.active() as never,
  };
}
