import type { Envelope } from "./envelope.ts";

/** Where a runtime's events go. A sink has one method. */
export interface Sink {
  emit(event: Envelope & Record<string, unknown>): void;
}

/** The default sink: it drops every event. */
export const nowhere: Sink = { emit() {} };

/** A sink for tests: it keeps every event, in order. */
export function createRecordingSink() {
  const events: (Envelope & Record<string, any>)[] = [];
  return {
    events,
    emit(event: Envelope & Record<string, unknown>) {
      events.push(event);
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
