import type { Envelope } from "./envelope.ts";
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
}

/**
 * The privacy filter a sink runs before an event leaves the runtime (ADR
 * 0011, ADR 0014). It keeps a field only where the catalog declares it, for
 * the event's name or in the envelope, and a `sensitive` one only when
 * `includeSensitive` is set: the days, weeks and durations of time records,
 * and `error.message`. A field the catalog doesn't declare is dropped either
 * way, so an event from another runtime, such as a renderer's batch, can't
 * carry more than its catalog entry. A declared leaf keeps its value as is.
 * It returns a new event and never changes the one it is given.
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
    (keep(event, treeOf(event.name), options.includeSensitive) ?? {}) as Event;
}

function keep(
  value: unknown,
  node: Field<unknown> | FieldTree,
  includeSensitive: boolean,
): unknown {
  if (isField(node)) {
    return node.privacy === "sensitive" && !includeSensitive
      ? undefined
      : value;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const kept: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!Object.hasOwn(node, key)) continue;
    const next = keep(child, node[key]!, includeSensitive);
    if (next !== undefined) kept[key] = next;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}
