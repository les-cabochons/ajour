/** The span an incoming call came from, or the one an outgoing call comes from. */
export interface TraceParent {
  /** 32 lowercase hex characters, not all zeros. */
  trace_id: string;
  /** 16 lowercase hex characters, not all zeros. */
  span_id: string;
}

const VERSION_00 = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;
// A later version keeps the first four fields, and may add more after a "-".
const LATER_VERSION =
  /^(?!ff)[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}(?:-.*)?$/;
const ALL_ZEROS = /^0+$/;

/**
 * The `traceparent` header for a span, as W3C trace context defines it:
 * version 00, and sampled, because every event is kept until a collector
 * samples them.
 */
export function encodeTraceparent(parent: TraceParent): string {
  return `00-${parent.trace_id}-${parent.span_id}-01`;
}

/** Reads a `traceparent` header. Undefined when it is missing or invalid. */
export function decodeTraceparent(
  header: string | null | undefined,
): TraceParent | undefined {
  if (!header) return undefined;
  const match =
    VERSION_00.exec(header) ??
    (header.startsWith("00-") ? null : LATER_VERSION.exec(header));
  if (!match) return undefined;
  const [, traceId, spanId] = match as unknown as [string, string, string];
  if (ALL_ZEROS.test(traceId) || ALL_ZEROS.test(spanId)) return undefined;
  return { trace_id: traceId, span_id: spanId };
}
