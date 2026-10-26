import type { Envelope, StepFailure } from "./envelope.ts";
import {
  envelopeFields,
  isField,
  type Catalog,
  type Field,
  type FieldTree,
} from "./fields.ts";

type Event = Envelope & Record<string, unknown>;

/** What a sink lets through: sensitive fields only when the user allows them for it. */
export interface PrivacyOptions {
  includeSensitive: boolean;
  /** Called once for each field, list entry or key the filter leaves out. */
  onDrop?: () => void;
}

/**
 * The keys of a folded unit's failure, without content (see `StepFailure`).
 * The `satisfies` fails to compile when the type gains a key this list lacks.
 */
const STEP_FAILURE_KEYS = [
  "name",
  "outcome",
  "outcome_reason",
  "error_type",
  "error_code",
] as const satisfies readonly (keyof StepFailure)[];

/**
 * The privacy filter a sink runs before an event leaves the runtime (ADR
 * 0011, ADR 0014). It keeps a field only where the catalog declares it, for
 * the event's name or in the envelope, and a `sensitive` one only when
 * `includeSensitive` is set: the days, weeks and durations of time records,
 * and `error.message`. A field the catalog doesn't declare is dropped either
 * way, so an event from another runtime, such as a renderer's batch, can't
 * carry more than its catalog entry.
 *
 * It also checks what a declared field holds. A field holds a string,
 * number, boolean or null, or a list of them, unless the catalog gives it a
 * `shape`: `steps` is a list of strings, `counts` an object of numbers, and
 * `step_failures` a list of objects that hold only a step failure's keys. An
 * object or a function where a value belongs is dropped, never passed
 * through. The envelope's `counts` keeps only the keys the catalog declares
 * as counters (`catalog.counters`), so a key can't carry a path or a name.
 * A field a catalog event declares with the `numbers` shape, such as
 * `local_state.record_counts`, keeps any key: its keys are dynamic collection
 * names, and only its values are checked. It returns a new event and never
 * changes the one it is given.
 */
export function createPrivacyFilter(catalog: Catalog) {
  // One tree per catalog name, made when first needed. Any other name gets
  // the envelope's alone, so unknown names never grow the cache.
  const trees = new Map<string, FieldTree>();
  const treeOf = (name: unknown) => {
    if (typeof name !== "string" || !Object.hasOwn(catalog.events, name)) {
      return envelopeFields as FieldTree;
    }
    let tree = trees.get(name);
    if (!tree) {
      // The catalog refuses an event field named like an envelope field.
      tree = { ...catalog.events[name]!.fields, ...envelopeFields };
      trees.set(name, tree);
    }
    return tree;
  };

  return (event: Event, options: PrivacyOptions): Event =>
    (keep(event, treeOf(event.name), {
      includeSensitive: options.includeSensitive,
      counters: catalog.counters,
      drops: 0,
      onDrop: options.onDrop,
    }) ?? {}) as Event;
}

interface Walk {
  includeSensitive: boolean;
  /** The keys the envelope's `counts` may hold. */
  counters: Catalog["counters"];
  /** How many things the walk has left out so far. */
  drops: number;
  onDrop?: () => void;
}

function drop(walk: Walk) {
  walk.drops += 1;
  walk.onDrop?.();
}

function keep(
  value: unknown,
  node: Field<unknown> | FieldTree,
  walk: Walk,
): unknown {
  if (isField(node)) {
    if (node.privacy === "sensitive" && !walk.includeSensitive) {
      drop(walk);
      return undefined;
    }
    // A shaped field counts what it leaves out itself.
    const before = walk.drops;
    const kept = leaf(value, node, walk);
    if (kept === undefined && walk.drops === before) drop(walk);
    return kept;
  }
  if (!isRecord(value)) {
    drop(walk);
    return undefined;
  }
  const kept: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!Object.hasOwn(node, key)) {
      drop(walk);
      continue;
    }
    const next = keep(child, node[key]!, walk);
    if (next !== undefined) kept[key] = next;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** A declared field's value, or undefined when it isn't what the field holds. */
function leaf(value: unknown, field: Field<unknown>, walk: Walk): unknown {
  switch (field.shape) {
    case "strings":
      return Array.isArray(value) && value.every(isString)
        ? [...value]
        : undefined;
    case "numbers":
      return numbersOnly(
        value,
        walk,
        field === envelopeFields.counts ? walk.counters : undefined,
      );
    case "step_failures":
      return stepFailures(value, walk);
    default:
      if (Array.isArray(value)) {
        return value.every(isScalar) ? [...value] : undefined;
      }
      return isScalar(value) ? value : undefined;
  }
}

/**
 * An object's number entries, such as `counts`; the others are dropped. With
 * `allowed`, only the keys it declares stay.
 */
function numbersOnly(
  value: unknown,
  walk: Walk,
  allowed?: Catalog["counters"],
): unknown {
  if (!isRecord(value)) return undefined;
  const kept: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "number" &&
      key !== "__proto__" &&
      (!allowed || Object.hasOwn(allowed, key))
    ) {
      kept[key] = entry;
    } else drop(walk);
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** A list of step failures, each with only its own keys, holding scalars. */
function stepFailures(value: unknown, walk: Walk): unknown {
  if (!Array.isArray(value)) return undefined;
  const kept: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      drop(walk);
      continue;
    }
    const failure: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(entry)) {
      if (
        (STEP_FAILURE_KEYS as readonly string[]).includes(key) &&
        isScalar(field)
      ) {
        failure[key] = field;
      } else {
        drop(walk);
      }
    }
    if (Object.keys(failure).length > 0) kept.push(failure);
  }
  return kept.length > 0 ? kept : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown) {
  return typeof value === "string";
}

function isScalar(value: unknown) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
