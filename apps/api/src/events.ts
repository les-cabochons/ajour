import { randomUUID } from "node:crypto";
import os from "node:os";
import {
  catalog,
  type AjourCatalog,
} from "../../../packages/wide-events/catalog.ts";
import {
  createEmitter,
  type Channel,
  type Emitter,
} from "../../../packages/wide-events/index.ts";
import { asyncContextScope } from "../../../packages/wide-events/node.ts";
import {
  sinkFromSwitch,
  WIDE_EVENTS_SWITCH,
  type Sink,
} from "../../../packages/wide-events/sinks.ts";

/** The local API's wide events. See docs/logging-strategy.md. */
export type ApiEvents = Emitter<AjourCatalog>;

/**
 * What the process that starts the local API knows about its launch. The
 * desktop main process will hand it over; the standalone API makes its own
 * launch ID and reports the `dev` channel.
 */
export interface ApiLaunch {
  id?: string;
  appVersion?: string;
  channel?: Channel;
  commit?: string;
  packaged?: boolean;
}

/**
 * The local API's emitter, with its runtime context. Its active unit follows
 * `await`s. Events go to `sink`, or else where AJOUR_WIDE_EVENTS sends them:
 * nowhere by default, one JSON line each on stdout with `console`.
 */
export function createApiEvents(options: {
  sink?: Sink;
  launch?: ApiLaunch;
  userDataPath: string;
  /** Tests stand in a home directory to check the scrubber. */
  homeDirectory?: string;
  now?: () => number;
}): ApiEvents {
  const { launch = {} } = options;
  return createEmitter({
    catalog,
    context: {
      runtime: "api",
      launch_id: launch.id ?? randomUUID(),
      app: {
        version: launch.appVersion ?? "unknown",
        channel: launch.channel ?? "dev",
        ...(launch.commit ? { commit: launch.commit } : {}),
        packaged: launch.packaged ?? false,
      },
      device: {
        platform: process.platform,
        arch: process.arch,
        ...(process.versions.electron
          ? { electron: process.versions.electron }
          : {}),
      },
    },
    sink: options.sink ?? sinkFromSwitch(process.env[WIDE_EVENTS_SWITCH]),
    scope: asyncContextScope(),
    scrub: {
      homeDirectory: options.homeDirectory ?? os.homedir(),
      userDataPath: options.userDataPath,
    },
    ...(options.now ? { now: options.now } : {}),
  });
}
