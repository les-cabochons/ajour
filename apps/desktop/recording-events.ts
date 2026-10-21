import { createRequire } from "node:module";
import {
  catalog,
  type AjourEvent,
} from "../../packages/wide-events/catalog.ts";
import { createEmitter } from "../../packages/wide-events/index.ts";
import { asyncContextScope } from "../../packages/wide-events/node.ts";
import { createRecordingSink } from "../../packages/wide-events/sinks.ts";

const require = createRequire(import.meta.url);
const { createMainEvents } = require("./electron/main-events.cjs");

/**
 * The main process's events as main.cjs makes them, with the package already
 * loaded and a recording sink: the `events` VM global of the main.cjs slices.
 */
export function recordingEvents({ now }: { now?: () => number } = {}) {
  const sink = createRecordingSink<AjourEvent>();
  const events = createMainEvents(now ? { now } : {});
  events.attach((clock: () => number) =>
    createEmitter({
      catalog,
      context: {
        runtime: "main",
        launch_id: "launch-1",
        app: { version: "1.2.0", channel: "stable", packaged: true },
        device: { platform: "win32", arch: "x64" },
      },
      sink,
      scope: asyncContextScope(),
      scrub: {
        homeDirectory: "C:\\Users\\alex",
        userDataPath: "C:\\Users\\alex\\AppData\\Roaming\\Ajour",
      },
      now: clock,
    }),
  );
  return { events, recorded: sink.events };
}
