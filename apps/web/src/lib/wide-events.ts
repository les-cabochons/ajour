import { catalog, type AjourCatalog } from "@ajour/wide-events/catalog.ts";
import {
  createEmitter,
  type Channel,
  type Emitter,
  type RuntimeContext,
} from "@ajour/wide-events";
import type { Surface, Trigger } from "@ajour/wide-events";
import { createForwardingSink } from "@ajour/wide-events/forwarding.ts";
import {
  createPrivacyFilter,
  fanOut,
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

/**
 * Where the renderer's events go: the devtools console when a developer sets
 * AJOUR_WIDE_EVENTS to `console`, and on desktop the local log file while
 * the user has logging on. With neither, nowhere.
 */
function defaultSink(): Sink {
  return fanOut(
    sinkFromSwitch(import.meta.env.AJOUR_WIDE_EVENTS),
    localLogFileSink(),
  );
}

/**
 * On desktop, the local log file's sink (#440): events wait in batches and
 * go to the main process, which checks and writes them. It accepts events
 * only while main is writing, which main pushes as it changes (the user turns
 * logging on or off, or a failed write stops it), so the renderer switches
 * without a reload, and while main isn't writing no event is built for it. The
 * page sends what waits when it hides. The web build has no file: there it is
 * `nowhere`.
 */
function localLogFileSink(): Sink {
  try {
    const desktop = window.ajourDesktop;
    const send = desktop?.forwardWideEvents;
    const subscribe = desktop?.onWideEventsForwarding;
    if (typeof send !== "function" || typeof subscribe !== "function") {
      return nowhere;
    }
    let forwarding = false;
    const sink = createForwardingSink({
      send: (batch) => send(batch),
      accepting: () => forwarding,
    });
    subscribe((next) => {
      forwarding = next === true;
    });
    window.addEventListener("pagehide", () => sink.flush());
    return sink;
  } catch {
    // A bridge that fails here sends nothing, and changes nothing else.
    return nowhere;
  }
}

/**
 * Passes on only what the catalog declares, through the shared privacy
 * filter, so a field without a privacy class never leaves the renderer,
 * whatever set it, and a field holds only what the catalog says it holds
 * (see `createPrivacyFilter`): an object or a function where a value
 * belongs is dropped, never passed through. Each drop counts in
 * `dropped_field_count`. It also drops each error's message,
 * keeping its type and code: the renderer knows neither the home folder nor
 * the user data folder, so its scrubber could leave either in a message.
 */
function catalogedOnly(target: Sink): Sink {
  const filter = createPrivacyFilter(catalog);
  return {
    // A sink that can turn off, such as the local log file's, still tells
    // the emitter, so no event is built while it is off.
    ...(target.accepting ? { accepting: () => target.accepting!() } : {}),
    emit(event) {
      let dropped = 0;
      // The renderer's own sink has no user setting for sensitive fields:
      // the sink it feeds decides about them, so they stay.
      const kept = filter(event, {
        includeSensitive: true,
        onDrop: () => {
          dropped += 1;
        },
      }) as Record<string, unknown> & {
        error?: Record<string, unknown>;
        counts?: Record<string, number>;
      };
      if (kept.error && "message" in kept.error) {
        const { message: _message, ...error } = kept.error;
        kept.error = error;
      }
      if (dropped > 0) {
        kept.counts = { ...kept.counts, dropped_field_count: dropped };
      }
      target.emit(kept as typeof event);
    },
  };
}

function createRendererEmitter(sink: Sink): RendererEvents {
  return createEmitter({
    catalog,
    context: rendererContext(),
    // `nowhere` stays itself, so a dropped event is never built.
    sink: sink === nowhere ? nowhere : catalogedOnly(sink),
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
  set: ((attribution) => current().set(attribution)) as RendererEvents["set"],
  start: ((name, init) =>
    current().start(name, init)) as RendererEvents["start"],
  run: ((name, init, work) =>
    current().run(name, init, work)) as RendererEvents["run"],
  current: () => current().current(),
};

/** Runs a synchronous dispatcher with source metadata on its store commands. */
export function withEventAttribution<Result>(
  attribution: { trigger?: Trigger; surface?: Surface },
  work: () => Result,
): Result {
  const restore = wideEvents.set(attribution);
  try {
    return work();
  } finally {
    restore();
  }
}

/**
 * Captures the active unit, so work after an `await` runs in it again: the
 * renderer's scope stack loses it at the first `await`. `attribution`
 * applies to that work too. Without an active unit, the work runs as it is.
 */
export function reentry(attribution?: {
  trigger?: Trigger;
  surface?: Surface;
}): <Result>(work: () => Result) => Result {
  const unit = wideEvents.current();
  return (work) => {
    const attributed = attribution
      ? () => withEventAttribution(attribution, work)
      : work;
    return unit ? unit.enter(attributed) : attributed();
  };
}

/**
 * The `{ traceparent }` a desktop bridge call passes as its last argument,
 * so the main process's IPC event joins the active unit's trace. Undefined
 * when no unit is active.
 */
export function traceCarrier(): { traceparent: string } | undefined {
  const unit = wideEvents.current();
  return unit ? { traceparent: unit.traceparent() } : undefined;
}

/** Sends the renderer's events to `next` from now on. Tests pass a recording sink. */
export function replaceEventSink(next: Sink = nowhere) {
  sink = next;
  emitter = createRendererEmitter(next);
}
