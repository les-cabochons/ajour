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

/** Who started the unit of work. */
export type Trigger = "user" | "agent" | "schedule" | "boot" | "system";

/** Where a user action came from. */
export type Surface =
  | "button"
  | "shortcut"
  | "item_key"
  | "palette"
  | "context_menu"
  | "app_menu"
  | "drag"
  | "editor"
  | "dialog"
  | "toast"
  | "link";

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
  /** The names of the nested units folded into this one, in the order they started. */
  steps?: string[];
  /** What this unit and the units folded into it counted. */
  counts?: Record<string, number>;
  error?: EventError;
}

export type EnvelopeKey = keyof Envelope;
