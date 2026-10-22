const { AsyncLocalStorage } = require("node:async_hooks");
const { readFileSync, writeFileSync } = require("node:fs");
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

/**
 * The version the last packaged launch wrote in `markerPath`, for app.launch.
 * Undefined on a first launch, or when the marker cannot be read. Never
 * throws.
 */
function readLaunchVersion(markerPath) {
  try {
    const recorded = JSON.parse(readFileSync(markerPath, "utf8"))?.version;
    return typeof recorded === "string" && recorded.length <= 64
      ? recorded
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes this launch's `version` in `markerPath`, once a packaged launch has
 * loaded its window. A marker that cannot be written leaves the next launch
 * without a previous version. Never throws.
 */
function writeLaunchVersion(markerPath, version) {
  try {
    writeFileSync(markerPath, `${JSON.stringify({ version })}\n`, "utf8");
  } catch {
    // The next launch reports no previous version.
  }
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
 * The factory takes the clock and the scope, which `createMainEvents` owns.
 */
async function loadMainEmitter({
  packageRoot,
  launch,
  homeDirectory,
  userDataPath,
  sinkSwitch,
  write = undefined,
}) {
  const load = (file) =>
    import(pathToFileURL(path.join(packageRoot, file)).toString());
  const [{ createEmitter }, { catalog }, { sinkFromSwitch }] =
    await Promise.all([load("index.ts"), load("catalog.ts"), load("sinks.ts")]);
  const sink = sinkFromSwitch(sinkSwitch, write);
  return (now, scope) =>
    createEmitter({
      catalog,
      context: { runtime: "main", ...launch },
      sink,
      scope,
      scrub: { homeDirectory, userDataPath },
      now,
    });
}

/** Who started a unit, from what set it off. Anything else is the system. */
const TRIGGERS = {
  launch: "boot",
  interval: "schedule",
  schedule: "schedule",
  manual: "user",
  request: "user",
  activate: "user",
  retry: "user",
  reload: "user",
  track_change: "user",
  menu: "user",
  all_windows_closed: "user",
  recovery_dialog: "user",
  update_install: "user",
};

function triggerOf(cause) {
  return TRIGGERS[cause] ?? "system";
}

/** The local API's stop outcome ("timed-out"), as an event names it ("timed_out"). */
function apiStopOf(outcome) {
  return typeof outcome === "string" ? outcome.replace("-", "_") : undefined;
}

const DEFERRED = Symbol("deferred unit");

/**
 * The main process's emitter, usable from the first line of main.cjs. The
 * package loads asynchronously, so until `attach` hands over the real
 * emitter, units are recorded with their times and replayed on it then, in
 * the order things happened. A unit still open at that point carries on as a
 * real unit. `ready` resolves once the emitter is attached, or once `abandon`
 * gave up on it, so a process about to exit can wait for its last events.
 *
 * The active unit lives in one AsyncLocalStorage, from before the load to
 * after: `current()` finds the running unit, and a unit started inside
 * another folds into it, whether either started before the load or after.
 */
function createMainEvents({ now = Date.now } = {}) {
  let emitter = null;
  let abandoned = false;
  /** While set, the emitter's clock: a replayed unit keeps its own times. */
  let replayAt = null;
  /** What happened before the load, in order: starts and unit calls. */
  const log = [];
  const storage = new AsyncLocalStorage();
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });

  /**
   * The scope the attached emitter takes over. A frame set before the load is
   * a deferred unit, which stands for its real unit once replayed.
   */
  const scope = {
    active() {
      const frame = storage.getStore();
      return frame?.[DEFERRED] ? frame.real : frame;
    },
    run: (frame, work) => storage.run(frame, work),
  };

  function at(time, work) {
    replayAt = time;
    try {
      return work();
    } finally {
      replayAt = null;
    }
  }

  function startReal(name, { startedAt, ...init }) {
    if (startedAt === undefined) return emitter.start(name, init);
    return at(startedAt, () => emitter.start(name, init));
  }

  /** The deferred unit active now, skipping those that ended, as the package does. */
  function activeDeferred() {
    let frame = storage.getStore();
    while (frame?.[DEFERRED] && frame.ended) frame = frame.outer;
    return frame?.[DEFERRED] ? frame : undefined;
  }

  /** A unit started before the emitter is attached. */
  function deferredUnit(name, init) {
    const outer = activeDeferred();
    let outcome;

    const record = (method, args) => {
      if (unit.real) {
        unit.real[method](...args);
        return;
      }
      if (unit.ended || abandoned) return;
      log.push({ unit, method, args, time: now() });
    };

    const unit = {
      [DEFERRED]: true,
      outer,
      real: null,
      ended: false,
      get name() {
        return unit.real ? unit.real.name : name;
      },
      get outcome() {
        return unit.real ? unit.real.outcome : outcome;
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
        if (!unit.real && !unit.ended) outcome = options?.outcome ?? "error";
        record("fail", [error, options]);
        return unit;
      },
      refuse(reason) {
        if (!unit.real && !unit.ended) outcome = "refused";
        record("refuse", [reason]);
        return unit;
      },
      cancel(reason) {
        if (!unit.real && !unit.ended) outcome = "cancelled";
        record("cancel", [reason]);
        return unit;
      },
      end(endOutcome, reason) {
        if (!unit.real && !unit.ended && endOutcome !== undefined) {
          outcome = endOutcome;
        }
        record("end", [endOutcome, reason]);
        if (!unit.real) unit.ended = true;
      },
      enter(work) {
        return unit.real ? unit.real.enter(work) : storage.run(unit, work);
      },
      traceparent() {
        return unit.real?.traceparent();
      },
      rename(next) {
        if (!unit.real && !unit.ended) name = next;
        record("rename", [next]);
        return unit;
      },
      /** Starts the real unit, inside its outer unit when it had one. */
      replayStart(time) {
        const begin = () => startReal(name, { ...init, startedAt: time });
        unit.real = outer?.real ? outer.real.enter(begin) : begin();
      },
    };
    if (!abandoned) {
      log.push({ unit, method: "start", time: init.startedAt ?? now() });
    }
    return unit;
  }

  function start(name, init) {
    return emitter ? startReal(name, init) : deferredUnit(name, init);
  }

  function run(name, init, work) {
    if (emitter) {
      const { startedAt, ...rest } = init;
      if (startedAt === undefined) return emitter.run(name, rest, work);
      return at(startedAt, () => emitter.run(name, rest, work));
    }
    const unit = deferredUnit(name, init);
    const threw = (error) => {
      if (unit.outcome === undefined) unit.fail(error);
      unit.end();
      throw error;
    };
    let result;
    try {
      result = unit.enter(() => work(unit));
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
    current: () => (emitter ? emitter.current() : activeDeferred()),
    ready,
    /**
     * Hands over the real emitter, made with the clock and the scope this
     * stand-in owns, and replays what happened before.
     */
    attach(createEmitter) {
      if (emitter || abandoned) return;
      emitter = createEmitter(() => replayAt ?? now(), scope);
      for (const { unit, method, args, time } of log) {
        if (method === "start") unit.replayStart(time);
        else at(time, () => unit.real[method](...args));
      }
      log.length = 0;
      markReady();
    },
    /** The package could not load: what was recorded is dropped. */
    abandon() {
      if (emitter) return;
      abandoned = true;
      log.length = 0;
      markReady();
    },
  };
}

module.exports = {
  apiLaunchOf,
  apiStopOf,
  createLaunchContext,
  createMainEvents,
  loadMainEmitter,
  readLaunchVersion,
  triggerOf,
  writeLaunchVersion,
};
