import type { Envelope } from "./envelope.ts";

/** Where a runtime's events go. */
export interface Sink {
  emit(event: Envelope & Record<string, unknown>): void;
  /**
   * Whether the sink keeps events right now. While it answers false, the
   * emitter doesn't build them, as with `nowhere`: a sink the user can turn
   * off costs nothing while it is off. A sink without it always keeps them.
   */
  accepting?(): boolean;
}

/** The default sink: it drops every event. */
export const nowhere: Sink = { emit() {} };

/**
 * A sink for tests: it keeps every event, in order. Pass the events' type,
 * such as `AjourEvent` from the catalog, to read their fields typed.
 */
export function createRecordingSink<
  Event extends Envelope = Envelope & { readonly [field: string]: unknown },
>() {
  const events: Event[] = [];
  return {
    events,
    emit(event: Envelope & Record<string, unknown>) {
      events.push(event as Event);
    },
  };
}

/**
 * A developer's sink: one JSON line per event, on stdout in Node and in the
 * devtools console in the renderer. Never on by default.
 */
export function createConsoleSink(
  write: (line: string) => void = (line) => console.log(line),
): Sink {
  return {
    emit(event) {
      write(JSON.stringify(event));
    },
  };
}

/** The environment variable that turns the console sink on: `AJOUR_WIDE_EVENTS=console`. */
export const WIDE_EVENTS_SWITCH = "AJOUR_WIDE_EVENTS";

/** The sink the developer switch asks for: `console`, or `nowhere`. */
export function sinkFromSwitch(
  value: string | undefined,
  write?: (line: string) => void,
): Sink {
  return value?.trim().toLowerCase() === "console"
    ? createConsoleSink(write)
    : nowhere;
}

/**
 * One sink that hands each event to every sink given, such as the
 * developer's console and the local log file. Each gets the same event and
 * must not change it. A sink that throws stops none of the others. It
 * accepts events while any of them does, and is `nowhere` when all are.
 */
export function fanOut(...sinks: readonly Sink[]): Sink {
  const targets = sinks.filter((sink) => sink !== nowhere);
  if (targets.length === 0) return nowhere;
  if (targets.length === 1) return targets[0]!;
  const accepts = (sink: Sink) => sink.accepting?.() !== false;
  return {
    emit(event) {
      for (const sink of targets) {
        if (!accepts(sink)) continue;
        try {
          sink.emit(event);
        } catch {
          // One sink's failure never reaches another, nor the work.
        }
      }
    },
    accepting: () => targets.some(accepts),
  };
}
