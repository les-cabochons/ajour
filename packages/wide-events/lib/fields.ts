import type { EnvelopeKey, Kind } from "./envelope.ts";

/**
 * Who may receive a field. `operational` fields hold IDs, enums, counts,
 * sizes and operation durations. `sensitive` fields hold the days, weeks and
 * durations of time records, and every error message: a future sink gets
 * them only if the user allows it.
 */
export type PrivacyClass = "operational" | "sensitive";

/** One field of a catalog entry: its privacy class, and its value's type. */
export interface Field<Value, Class extends PrivacyClass = PrivacyClass> {
  readonly privacy: Class;
  /** Never set. It carries the field's value type. */
  readonly value?: Value;
}

/** A field that every sink may receive. */
export function operational<Value = string>(): Field<Value, "operational"> {
  return { privacy: "operational" };
}

/** A field that a sink receives only if the user allows it. */
export function sensitive<Value = string>(): Field<Value, "sensitive"> {
  return { privacy: "sensitive" };
}

/** An event's own fields: classed fields, nested in objects named for glossary terms. */
export interface FieldTree {
  readonly [key: string]: Field<unknown> | FieldTree;
}

/** What the catalog says about one event name. */
export interface EventSpec {
  /** The seams that may open it: `backlog.sync` is a job, a request and a plugin operation. */
  readonly kinds: readonly Kind[];
  /** The closed set of its `outcome_reason` values. */
  readonly reasons?: readonly string[];
  readonly fields: FieldTree;
}

export interface Catalog {
  /** What `count` may add to, across every event. Nested units add theirs to the outer event's. */
  readonly counters: { readonly [name: string]: Field<number> };
  readonly events: { readonly [name: string]: EventSpec };
}

type NoEnvelopeKeys = { readonly [Key in EnvelopeKey]?: never };

/**
 * Checks a catalog at compile time: every field declares `operational` or
 * `sensitive`, and no event field takes an envelope field's name.
 */
export function defineCatalog<
  const Counters extends Catalog["counters"],
  const Events extends {
    readonly [Name in keyof Events]: EventSpec & {
      readonly fields: NoEnvelopeKeys;
    };
  },
>(catalog: {
  counters: Counters;
  events: Events;
}): { counters: Counters; events: Events } {
  return catalog;
}

/**
 * The envelope's own fields, classed like the catalog's. Only an error's
 * message is sensitive: it is scrubbed, but can still name a file or a host.
 */
export const envelopeFields = {
  schema: operational<1>(),
  name: operational(),
  kind: operational<Kind>(),
  runtime: operational(),
  outcome: operational(),
  outcome_reason: operational(),
  started_at: operational(),
  duration_ms: operational<number>(),
  trace_id: operational(),
  span_id: operational(),
  parent_span_id: operational(),
  launch_id: operational(),
  window_id: operational(),
  trigger: operational(),
  surface: operational(),
  steps: operational<string[]>(),
  counts: operational<Record<string, number>>(),
  app: {
    version: operational(),
    channel: operational(),
    commit: operational(),
    packaged: operational<boolean>(),
  },
  device: {
    platform: operational(),
    arch: operational(),
    electron: operational(),
  },
  error: {
    type: operational(),
    code: operational(),
    message: sensitive(),
    retriable: operational<boolean>(),
  },
} as const satisfies {
  readonly [Key in EnvelopeKey]: Field<unknown> | FieldTree;
};

/** An event's own field values, as the code doing the work sets them. Every one is optional. */
export type FieldValues<Tree> = {
  -readonly [Key in keyof Tree]?: Tree[Key] extends Field<infer Value>
    ? Value
    : FieldValues<Tree[Key]>;
};

export type EventName<C extends Catalog> = keyof C["events"] & string;

export type CounterName<C extends Catalog> = keyof C["counters"] & string;

export type KindOf<
  C extends Catalog,
  Name extends EventName<C>,
> = C["events"][Name]["kinds"][number];

export type ReasonOf<
  C extends Catalog,
  Name extends EventName<C>,
> = C["events"][Name] extends { readonly reasons: readonly (infer Reason)[] }
  ? Reason & string
  : never;

export type FieldsOf<
  C extends Catalog,
  Name extends EventName<C>,
> = FieldValues<C["events"][Name]["fields"]>;
