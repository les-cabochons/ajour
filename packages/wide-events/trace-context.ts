// Entry point: W3C trace context, so one user action keeps one trace across
// the renderer, the local API, the plugin workers and the main process.
export { decodeTraceparent, encodeTraceparent } from "./lib/trace-context.ts";
export type { TraceParent } from "./lib/trace-context.ts";
