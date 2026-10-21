import { catalog, type AjourCatalog } from "@ajour/wide-events/catalog.ts";
import {
  createEmitter,
  type Channel,
  type Emitter,
  type RuntimeContext,
} from "@ajour/wide-events";
import {
  nowhere,
  sinkFromSwitch,
  type Sink,
} from "@ajour/wide-events/sinks.ts";

/** The renderer's wide events. See docs/logging-strategy.md. */
export type RendererEvents = Emitter<AjourCatalog>;

/**
 * What the desktop main process says about its launch, in
 * `window.ajourDesktop.runtime.launch`: the shape the local API's `launch`
 * option takes. Every field is optional, and each is checked before use.
 */
export interface LaunchContext {
  id?: string;
  appVersion?: string;
  channel?: Channel;
  commit?: string;
  packaged?: boolean;
  arch?: string;
}

type DesktopRuntime = NonNullable<
  NonNullable<Window["ajourDesktop"]>["runtime"]
>;

const CHANNELS: readonly Channel[] = ["dev", "nightly", "stable", "web"];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The renderer's runtime context. On desktop it reports the main process's
 * launch; the web build, or a desktop main that hands no launch over, makes
 * its own launch ID. Every window load gets its own window ID.
 */
export function rendererContext(
  runtime: DesktopRuntime | null | undefined = readDesktopRuntime(),
): RuntimeContext {
  const launch = (runtime?.launch ?? {}) as Record<string, unknown>;
  const channel = CHANNELS.find((value) => value === launch.channel);
  const desktop = runtime != null;
  const commit = text(launch.commit);
  const arch = text(launch.arch);
  return {
    runtime: "renderer",
    launch_id: text(launch.id) ?? crypto.randomUUID(),
    window_id: crypto.randomUUID(),
    app: {
      version: text(launch.appVersion) ?? text(runtime?.version) ?? "unknown",
      channel:
        channel ??
        (!desktop ? "web" : runtime.developmentBuild ? "dev" : "stable"),
      ...(commit ? { commit } : {}),
      packaged:
        typeof launch.packaged === "boolean"
          ? launch.packaged
          : desktop && !runtime.developmentBuild,
    },
    device: {
      platform: text(runtime?.platform) ?? browserPlatform(),
      ...(arch ? { arch } : {}),
    },
  };
}

function readDesktopRuntime() {
  try {
    return window.ajourDesktop?.runtime;
  } catch {
    return undefined;
  }
}

function browserPlatform() {
  const navigator = globalThis.navigator as
    (Navigator & { userAgentData?: { platform?: string } }) | undefined;
  return (
    text(navigator?.userAgentData?.platform) ??
    text(navigator?.platform) ??
    "web"
  );
}

/** Events go nowhere unless a developer runs with AJOUR_WIDE_EVENTS=console. */
function defaultSink(): Sink {
  return sinkFromSwitch(import.meta.env.AJOUR_WIDE_EVENTS);
}

function createRendererEmitter(sink: Sink): RendererEvents {
  return createEmitter({
    catalog,
    context: rendererContext(),
    sink,
  });
}

let emitter: RendererEvents | undefined;
let sink: Sink | undefined;

function current() {
  emitter ??= createRendererEmitter((sink ??= defaultSink()));
  return emitter;
}

/**
 * The renderer's one emitter, created at its first use. Its active unit is a
 * synchronous scope: an async unit leaves it at its first `await`, and
 * re-enters it with `unit.enter()` around the store commands it runs after.
 */
export const wideEvents: RendererEvents = {
  start: ((name, init) =>
    current().start(name, init)) as RendererEvents["start"],
  run: ((name, init, work) =>
    current().run(name, init, work)) as RendererEvents["run"],
  current: () => current().current(),
};

/** Sends the renderer's events to `next` from now on. Tests pass a recording sink. */
export function replaceEventSink(next: Sink = nowhere) {
  sink = next;
  emitter = createRendererEmitter(next);
}
