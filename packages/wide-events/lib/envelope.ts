/** The seam that opened an event. */
export type Kind =
  | "command"
  | "job"
  | "request"
  | "ipc"
  | "plugin_operation"
  | "lifecycle"
  | "navigation"
  | "crash";

/** On desktop the local API runs inside the main process, but it stays its own runtime. */
export type Runtime = "renderer" | "api" | "main";

/** How a unit of work ended. Whoever shows or exports an event derives its severity from this. */
export type Outcome =
  "ok" | "noop" | "refused" | "cancelled" | "timeout" | "error";

/** How bad each outcome is, worst first: error, timeout, refused, cancelled. */
export const OUTCOME_SEVERITY: Readonly<Record<Outcome, number>> = {
  error: 5,
  timeout: 4,
  refused: 3,
  cancelled: 2,
  noop: 1,
  ok: 0,
};

/**
 * The worst of several outcomes, such as a request's own and its calls'.
 * An outcome not recorded yet counts as `ok`.
 */
export function worstOutcome(...outcomes: (Outcome | undefined)[]): Outcome {
  let worst: Outcome = "ok";
  for (const outcome of outcomes) {
    if (outcome && OUTCOME_SEVERITY[outcome] > OUTCOME_SEVERITY[worst]) {
      worst = outcome;
    }
  }
  return worst;
}

/** Who started the unit of work. */
export type Trigger = "user" | "agent" | "schedule" | "boot" | "system";

/** Where a user action came from. */
export type Surface =
  | "button"
  | "popover"
  | "shortcut"
  | "item_key"
  | "palette"
  | "context_menu"
  | "app_menu"
  | "drag"
  | "editor"
  | "dialog"
  | "toast";

export type Channel = "dev" | "nightly" | "stable" | "web";

/**
 * A thrown error as an event holds it: its type name and code, and its
 * message only once scrubbed. The message is sensitive.
 */
export interface EventError {
  type: string;
  code?: string;
  message?: string;
  retriable?: boolean;
}

/** What every event of one runtime shares, set once when its emitter starts. */
export interface RuntimeContext {
  runtime: Runtime;
  /** One per app launch, shared by every runtime. */
  launch_id: string;
  /** Renderer only, one per window load. */
  window_id?: string;
  app: {
    version: string;
    channel: Channel;
    commit?: string;
    packaged: boolean;
  };
  device: { platform: string; arch?: string; electron?: string };
}

/**
 * What one app launch shares with every runtime. The desktop main process
 * makes it at launch and hands it to the local API and the renderer, so all
 * three report the same launch, build and device.
 */
export type LaunchContext = Pick<
  RuntimeContext,
  "launch_id" | "app" | "device"
>;

/** What every wide event carries, whatever its name. */
export interface Envelope extends RuntimeContext {
  schema: 1;
  name: string;
  kind: Kind;
  outcome: Outcome;
  /** A closed set per event, such as "locked_week" or "capacity". */
  outcome_reason?: string;
  /** ISO 8601 UTC with milliseconds. */
  started_at: string;
  duration_ms: number;
  /** W3C trace context: 32 hex characters. */
  trace_id: string;
  /** 16 hex characters. */
  span_id: string;
  parent_span_id?: string;
  trigger: Trigger;
  surface?: Surface;
  /**
   * The names of the nested units folded into this one, in the order they
   * started: the first 50.
   */
  steps?: string[];
  /** How many folded units' names `steps` left out past its first 50. */
  dropped_step_count?: number;
  /**
   * The folded units that didn't end `ok` or `noop`, the first 50. The outer
   * unit's own outcome stays its own.
   */
  step_failures?: StepFailure[];
  /**
   * What this unit and the units folded into it counted, by counter name
   * from the catalog. Not in #304's envelope: it is where `count()` and a
   * folded unit's counts add up.
   */
  counts?: Record<string, number>;
  error?: EventError;
}

/** A folded unit that failed, without content: never its message or fields. */
export interface StepFailure {
  name: string;
  outcome: Exclude<Outcome, "ok" | "noop">;
  outcome_reason?: string;
  error_type?: string;
  error_code?: string;
}

export type EnvelopeKey = keyof Envelope;
