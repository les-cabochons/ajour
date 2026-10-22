import { createRequire } from "node:module";
import {
  catalog,
  type AjourEvent,
} from "../../packages/wide-events/catalog.ts";
import {
  createEmitter,
  type RuntimeContext,
  type ScopeStore,
} from "../../packages/wide-events/index.ts";
import { createRecordingSink } from "../../packages/wide-events/sinks.ts";

const require = createRequire(import.meta.url);
const { createMainEvents } = require("./electron/main-events.cjs");

/**
 * The main process's events as main.cjs makes them, with the package already
 * loaded and a recording sink: the `events` the desktop modules take, and the
 * VM global of the main.cjs slices. `context` overrides the runtime context.
 * With `loaded: false`, the package has not loaded yet: `attach()` loads it.
 */
export function recordingEvents({
  now,
  context = {},
  loaded = true,
}: {
  now?: () => number;
  context?: Partial<RuntimeContext>;
  loaded?: boolean;
} = {}) {
  const sink = createRecordingSink<AjourEvent>();
  const events = createMainEvents(now ? { now } : {});
  const attach = () =>
    events.attach((clock: () => number, scope: ScopeStore) =>
      createEmitter({
        catalog,
        context: {
          runtime: "main",
          launch_id: "launch-1",
          app: { version: "1.2.0", channel: "stable", packaged: true },
          device: { platform: "win32", arch: "x64" },
          ...context,
        },
        sink,
        scope,
        scrub: {
          homeDirectory: "C:\\Users\\alex",
          userDataPath: "C:\\Users\\alex\\AppData\\Roaming\\Ajour",
        },
        now: clock,
      }),
    );
  if (loaded) attach();
  return { events, recorded: sink.events, attach };
}
