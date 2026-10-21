const path = require("node:path");
const { pathToFileURL } = require("node:url");

/**
 * The launch context the main process makes at launch, in the shape of the
 * wide-events package's `LaunchContext`. It hands it to the local API, through
 * `apiLaunchOf`, and to the renderer, as `runtime.launch`.
 */
function createLaunchContext({
  version,
  packaged,
  commit,
  platform,
  arch,
  electron,
  randomUUID,
}) {
  const channel = !packaged
    ? "dev"
    : version.includes("-nightly")
      ? "nightly"
      : "stable";
  return {
    launch_id: randomUUID(),
    app: { version, channel, ...(commit ? { commit } : {}), packaged },
    device: { platform, arch, ...(electron ? { electron } : {}) },
  };
}

/** The launch context as the local API's `launch` start option takes it. */
function apiLaunchOf(launch) {
  return {
    id: launch.launch_id,
    appVersion: launch.app.version,
    channel: launch.app.channel,
    ...(launch.app.commit ? { commit: launch.app.commit } : {}),
    packaged: launch.app.packaged,
  };
}

/**
 * Loads the wide-events package from `packageRoot` the way the main process
 * loads the local API, and resolves a factory for the main process's emitter.
 * The factory takes the clock, which `createMainEvents` controls.
 */
async function loadMainEmitter({
  packageRoot,
  launch,
  homeDirectory,
  userDataPath,
  sinkSwitch,
  write,
}) {
  const load = (file) =>
    import(pathToFileURL(path.join(packageRoot, file)).toString());
  const [
    { createEmitter },
    { catalog },
    { sinkFromSwitch },
    { asyncContextScope },
  ] = await Promise.all([
    load("index.ts"),
    load("catalog.ts"),
    load("sinks.ts"),
    load("node.ts"),
  ]);
  const sink = sinkFromSwitch(sinkSwitch, write);
  return (now) =>
    createEmitter({
      catalog,
      context: { runtime: "main", ...launch },
      sink,
      scope: asyncContextScope(),
      scrub: { homeDirectory, userDataPath },
      now,
    });
}

/**
 * The main process's emitter, usable from the first line of main.cjs. The
 * package loads asynchronously, so until `attach` hands over the real
 * emitter, units are recorded with their times and replayed on it then. A
 * unit still open at that point carries on as a real unit. `ready` resolves
 * once the emitter is attached, or once `abandon` gave up on it, so a process
 * about to exit can wait for its last event.
 */
function createMainEvents({ now = Date.now } = {}) {
  let emitter = null;
  let abandoned = false;
  /** While set, the emitter's clock: a replayed unit keeps its own times. */
  let replayAt = null;
  const pending = new Set();
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });

  function startReal(name, { startedAt, ...init }) {
    if (startedAt === undefined) return emitter.start(name, init);
    return at(startedAt, () => emitter.start(name, init));
  }

  function at(time, work) {
    replayAt = time;
    try {
      return work();
    } finally {
      replayAt = null;
    }
  }

  /** A unit recorded before the emitter is attached. */
  function deferredUnit(name, init) {
    const startedAt = init.startedAt ?? now();
    const operations = [];
    let real = null;
    let outcome;
    let ended = false;

    const record = (method, args) => {
      if (real) {
        real[method](...args);
        return;
      }
      if (ended || abandoned) return;
      operations.push({ method, args, time: now() });
    };

    const unit = {
      get name() {
        return real ? real.name : name;
      },
      get outcome() {
        return real ? real.outcome : outcome;
      },
      set(fields) {
        record("set", [fields]);
        return unit;
      },
      count(counter, amount) {
        record("count", [counter, amount]);
        return unit;
      },
      fail(error, options) {
        if (!real && !ended) outcome = options?.outcome ?? "error";
        record("fail", [error, options]);
        return unit;
      },
      refuse(reason) {
        if (!real && !ended) outcome = "refused";
        record("refuse", [reason]);
        return unit;
      },
      cancel(reason) {
        if (!real && !ended) outcome = "cancelled";
        record("cancel", [reason]);
        return unit;
      },
      end(endOutcome, reason) {
        if (!real && !ended && endOutcome !== undefined) outcome = endOutcome;
        record("end", [endOutcome, reason]);
        if (!real) ended = true;
      },
      enter(work) {
        return real ? real.enter(work) : work();
      },
      traceparent() {
        return real?.traceparent();
      },
      rename(next) {
        if (!real && !ended) name = next;
        record("rename", [next]);
        return unit;
      },
      /** Replays the recorded unit on the real emitter. */
      replay() {
        real = startReal(name, { ...init, startedAt });
        for (const { method, args, time } of operations) {
          at(time, () => real[method](...args));
        }
        operations.length = 0;
      },
    };
    if (!abandoned) pending.add(unit);
    return unit;
  }

  function start(name, init) {
    if (emitter) return startReal(name, init);
    return deferredUnit(name, init);
  }

  function run(name, init, work) {
    if (emitter) {
      if (init.startedAt === undefined) return emitter.run(name, init, work);
      const { startedAt, ...rest } = init;
      return at(startedAt, () => emitter.run(name, rest, work));
    }
    const unit = start(name, init);
    const threw = (error) => {
      if (unit.outcome === undefined) unit.fail(error);
      unit.end();
      throw error;
    };
    let result;
    try {
      result = work(unit);
    } catch (error) {
      threw(error);
    }
    if (!result || typeof result.then !== "function") {
      unit.end();
      return result;
    }
    return Promise.resolve(result).then((value) => {
      unit.end();
      return value;
    }, threw);
  }

  return {
    start,
    run,
    current: () => emitter?.current(),
    ready,
    /** Hands over the real emitter, made with the clock this facade controls. */
    attach(createEmitter) {
      if (emitter || abandoned) return;
      emitter = createEmitter(() => replayAt ?? now());
      for (const unit of pending) unit.replay();
      pending.clear();
      markReady();
    },
    /** The package could not load: what was recorded is dropped. */
    abandon() {
      if (emitter) return;
      abandoned = true;
      pending.clear();
      markReady();
    },
  };
}

module.exports = {
  apiLaunchOf,
  createLaunchContext,
  createMainEvents,
  loadMainEmitter,
};
