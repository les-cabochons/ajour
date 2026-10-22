import {
  catalog,
  envelopeFields,
  type AjourCatalog,
} from "@ajour/wide-events/catalog.ts";
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

type Tree = { readonly [key: string]: unknown };

function isField(node: unknown) {
  const privacy = (node as { privacy?: unknown } | null)?.privacy;
  return privacy === "operational" || privacy === "sensitive";
}

/** A value a field may hold: a string, number, boolean or null, or a list of them. */
function isFieldValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isScalar);
  return isScalar(value);
}

function isScalar(value: unknown) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * `value` with only the fields `tree` declares, each holding a field value,
 * or undefined when none is left. `drop` counts each field it leaves out.
 */
function declaredOnly(
  value: unknown,
  tree: unknown,
  drop: () => void,
): unknown {
  if (isField(tree)) {
    if (isFieldValue(value)) return value;
    drop();
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    drop();
    return undefined;
  }
  const kept: Record<string, unknown> = {};
  let empty = true;
  for (const [key, child] of Object.entries(value)) {
    if (!Object.hasOwn(tree as Tree, key)) {
      drop();
      continue;
    }
    const declared = declaredOnly(child, (tree as Tree)[key], drop);
    if (declared !== undefined) {
      kept[key] = declared;
      empty = false;
    }
  }
  return empty ? undefined : kept;
}

/**
 * Passes on only what the catalog declares, so a field without a privacy
 * class never leaves the renderer, whatever set it, and a field holds only
 * strings, numbers, booleans, null and lists of them: an object or a
 * function where a value belongs is dropped, never passed through. Each
 * drop counts in `dropped_field_count`. It also drops each error's message,
 * keeping its type and code: the renderer knows neither the home folder nor
 * the user data folder, so its scrubber could leave either in a message.
 */
function catalogedOnly(target: Sink): Sink {
  return {
    emit(event) {
      const fields = (catalog.events as Record<string, { fields: Tree }>)[
        event.name
      ]?.fields;
      const kept: Record<string, unknown> = {};
      let dropped = 0;
      const drop = () => {
        dropped += 1;
      };
      for (const [key, value] of Object.entries(event)) {
        if (Object.hasOwn(envelopeFields, key)) kept[key] = value;
        else if (fields && Object.hasOwn(fields, key)) {
          const declared = declaredOnly(value, fields[key], drop);
          if (declared !== undefined) kept[key] = declared;
        } else {
          drop();
        }
      }
      if (event.error?.message !== undefined) {
        const { message: _message, ...error } = event.error;
        kept.error = error;
      }
      if (dropped > 0) {
        kept.counts = { ...event.counts, dropped_field_count: dropped };
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
