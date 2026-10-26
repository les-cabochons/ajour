// Entry point: forwarding events from one runtime to another that writes
// them, as the renderer sends its events in batches over IPC to the desktop
// main process's local log file (#440). It runs in the browser and in Node.
export {
  createForwardedBatchReader,
  createForwardingSink,
  FORWARD_BATCH_SIZE,
  FORWARD_FLUSH_MS,
  MAIN_ONLY_KINDS,
  MAX_FORWARDED_EVENT_CHARS,
  MAX_UNSENT_EVENT_COUNT,
} from "./lib/forwarding.ts";
export type {
  ForwardedBatch,
  ForwardedEvents,
  ForwardedFrom,
  ForwardingSink,
  ForwardingSinkOptions,
} from "./lib/forwarding.ts";
