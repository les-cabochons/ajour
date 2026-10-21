import { createEmitter, type EmitterOptions } from "../index.ts";
import {
  defineCatalog,
  operational,
  sensitive,
  type EventOf,
} from "../catalog.ts";
import { createRecordingSink } from "../sinks.ts";

/** A small catalog for the package's own tests. */
export const testCatalog = defineCatalog({
  counters: {
    store_write_count: operational<number>(),
    api_call_count: operational<number>(),
  },
  events: {
    "backlog.sync": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: ["capacity", "timeout", "plugin_off"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
        sync: {
          mode: operational<"review" | "backlog">(),
          received_count: operational<number>(),
        },
      },
    },
    "time_entry.update": {
      kinds: ["command"],
      reasons: ["locked_week", "stale_window"],
      fields: {
        time_entry: {
          id: operational(),
          duration_ms: sensitive<number>(),
        },
      },
    },
    "api.request": {
      kinds: ["request"],
      reasons: ["host_refused"],
      fields: {
        http: { method: operational(), status: operational<number>() },
      },
    },
    "agent_tool.call": {
      kinds: ["request"],
      fields: { agent_tool: { name: operational() } },
    },
  },
});

export const apiContext = {
  runtime: "api",
  launch_id: "launch-1",
  app: { version: "1.2.3", channel: "nightly", packaged: true },
  device: { platform: "win32", arch: "x64" },
} as const;

/** An emitter for `testCatalog` that records what it emits. */
export function recordingEmitter(
  options: Partial<EmitterOptions<typeof testCatalog>> = {},
) {
  const sink = createRecordingSink<EventOf<typeof testCatalog>>();
  const events = createEmitter({
    catalog: testCatalog,
    context: apiContext,
    sink,
    ...options,
  });
  return { events, recorded: sink.events };
}
