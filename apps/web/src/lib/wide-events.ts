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

type DesktopRuntime = NonNullable<
  NonNullable<Window["ajourDesktop"]>["runtime"]
>;

const CHANNELS: readonly Channel[] = ["dev", "nightly", "stable", "web"];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `value` when it is a plain object, else an empty one: a malformed launch reads as missing. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The renderer's runtime context. On desktop it reports the launch the main
 * process hands over (`LaunchContext`), so the renderer, the local API and
 * the main process share one launch ID. Each field is checked, and a missing
 * or malformed one falls back on its own: the web build, or a main process
 * that hands no launch over, makes its own launch ID. Every window load gets
 * its own window ID.
 */
export function rendererContext(
  runtime: DesktopRuntime | null | undefined = readDesktopRuntime(),
): RuntimeContext {
  const launch = record(runtime?.launch);
  const app = record(launch.app);
  const device = record(launch.device);
  const channel = CHANNELS.find((value) => value === app.channel);
  const desktop = runtime != null;
  const commit = text(app.commit);
  const arch = text(device.arch);
  const electron = text(device.electron);
  return {
    runtime: "renderer",
    launch_id: text(launch.launch_id) ?? crypto.randomUUID(),
    window_id: crypto.randomUUID(),
    app: {
      version: text(app.version) ?? text(runtime?.version) ?? "unknown",
      channel:
        channel ??
        (!desktop ? "web" : runtime.developmentBuild ? "dev" : "stable"),
      ...(commit ? { commit } : {}),
      packaged:
        typeof app.packaged === "boolean"
          ? app.packaged
          : desktop && !runtime.developmentBuild,
    },
    device: {
      platform:
        text(device.platform) ?? text(runtime?.platform) ?? browserPlatform(),
      ...(arch ? { arch } : {}),
      ...(electron ? { electron } : {}),
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

/**
 * Drops each error's message, keeping its type and code. The renderer knows
 * neither the home folder nor the user data folder, so its scrubber could
 * leave either in a message.
 */
function withoutErrorMessages(target: Sink): Sink {
  return {
    emit(event) {
      if (event.error?.message === undefined) return target.emit(event);
      const { message: _message, ...error } = event.error;
      target.emit({ ...event, error });
    },
  };
}

function createRendererEmitter(sink: Sink): RendererEvents {
  return createEmitter({
    catalog,
    context: rendererContext(),
    // `nowhere` stays itself, so a dropped event is never built.
    sink: sink === nowhere ? nowhere : withoutErrorMessages(sink),
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
