// Entry point: where a runtime's events go. `nowhere` is the default; tests
// read a recording sink; a developer turns on the console sink with
// AJOUR_WIDE_EVENTS: "console". Logging plugins will replace the sink later.
export {
  createConsoleSink,
  createRecordingSink,
  nowhere,
  sinkFromSwitch,
  WIDE_EVENTS_SWITCH,
} from "./lib/sinks.ts";
export type { Sink } from "./lib/sinks.ts";
