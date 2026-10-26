// Entry point: where a runtime's events go. `nowhere` is the default; tests
// read a recording sink; a developer turns on the console sink with
// AJOUR_WIDE_EVENTS=console. `fanOut` hands events to several sinks, and a
// sink that sends events anywhere runs the privacy filter first. The desktop
// main process's local log file is in local-log-file.ts.
export {
  createConsoleSink,
  createRecordingSink,
  fanOut,
  nowhere,
  sinkFromSwitch,
  WIDE_EVENTS_SWITCH,
} from "./lib/sinks.ts";
export type { Sink } from "./lib/sinks.ts";
export { createPrivacyFilter } from "./lib/privacy.ts";
export type { PrivacyOptions } from "./lib/privacy.ts";
