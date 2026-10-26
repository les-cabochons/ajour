// @ts-check
const path = require("node:path");
const { serialize } = require("node:v8");
const { refusedSender } = require("./ipc-listeners.cjs");
const {
  PLUGIN_SCHEME,
  hostPageUrl,
  pluginOfSender,
  pluginPartition,
  pluginRequestAllowed,
  pluginFileHeaders,
  servePluginFile,
} = require("./plugin-renderer-policy.cjs");
const { rendererSandboxRefusal } = require("./plugin-sandbox.cjs");

/**
 * The sandboxed renderer runtime (#390, decided in #231 and ADR 0007): it
 * implements the local API's runtime port (apps/api/src/plugin-runtime.ts)
 * for plugin API 4 packages. Each plugin gets a hidden page of its own,
 * owned by main and never attached to a window, in an in-memory partition,
 * under the Chromium sandbox, on the origin `ajour-plugin://<id>`. Each
 * operation runs in a dedicated worker of that page, and the worker's one
 * way out is the broker of its operation, reached over IPC.
 *
 * Lifecycle (#391, decided in #217): a "Load when needed" plugin's renderer
 * opens at its first call and closes 2 minutes after its last; an "Always
 * ready" one opens when the API lists it in `keepReady` and stays open. Any
 * renderer closes at a timeout, above its memory ceiling, sampled every few
 * seconds, and on quit. A run that settles or is cancelled stops its own
 * worker only. A crash or a memory kill is reported to the API, which keeps
 * the crash budget and the 4-calls limit; nothing reopens a renderer until
 * the next call or `keepReady`.
 */

/** The largest result a run returns, as `MAX_PLUGIN_RESULT_BYTES` in plugin-runtime.ts. */
const MAX_PLUGIN_RESULT_BYTES = 8 * 1024 * 1024;
/** The longest error message, as `MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS` in plugin-runtime.ts. */
const MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;
/** A renderer with no run closes this long after its last one ended. */
const IDLE_CLOSE_MS = 2 * 60_000;
/** How long a renderer may take to load Ajour's page. */
const READY_TIMEOUT_MS = 20_000;
/** How long closing a renderer waits for it to go. */
const CLOSE_TIMEOUT_MS = 5_000;
/** At most this many blocked attempts a second count for one plugin. */
const BLOCKED_PER_SECOND = 20;
/** How often an open renderer's memory is read. */
const MEMORY_SAMPLE_MS = 5_000;
/** A run that doesn't say how its renderer lives gets "Load when needed" and Ajour's ceiling. */
const DEFAULT_LIFECYCLE = { alwaysReady: false, memoryCeilingMb: 256 };

/**
 * A proxy nothing can answer on: port 0 can't accept a connection. With
 * `<-loopback>`, loopback goes through it too, so whatever a plugin's
 * session would send past `webRequest`, such as WebTransport, goes nowhere.
 */
const DEAD_PROXY = {
  mode: /** @type {const} */ ("fixed_servers"),
  proxyRules: "http://0.0.0.0:0",
  proxyBypassRules: "<-loopback>",
};

/** How `render-process-gone` reasons read as a crash's cause. */
const CRASH_CAUSES = {
  crashed: "crashed",
  "abnormal-exit": "crashed",
  "launch-failed": "crashed",
  "integrity-failure": "crashed",
  oom: "oom",
  "memory-eviction": "oom",
  killed: "killed",
  "clean-exit": "killed",
};

/** The messages a plugin's page sends, for the IPC event. */
const MESSAGE_TYPES = new Set([
  "ready",
  "next",
  "settled",
  "http",
  "publicFetch",
  "abort",
  "blocked",
]);

/** The fields of an `ajour.http` request the broker reads. */
const HTTP_REQUEST_KEYS = [
  "connectionId",
  "host",
  "method",
  "path",
  "query",
  "headers",
  "body",
];

const delay = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string} message */
function cutMessage(message) {
  return message.length <= MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS
    ? message
    : `${message.slice(0, MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS - 1)}…`;
}

/**
 * How a run settled, from what the page reported: a result within its
 * bound, a missing export, or the plugin's error, cut.
 *
 * @param {unknown} outcome
 */
function outcomeFromPage(outcome) {
  if (isRecord(outcome) && outcome.ok === true) {
    let resultBytes;
    try {
      resultBytes = serialize(outcome.result).byteLength;
    } catch {
      return {
        ok: false,
        failure: "plugin_error",
        message: "The plugin returned a value Ajour can't read.",
      };
    }
    return resultBytes > MAX_PLUGIN_RESULT_BYTES
      ? { ok: false, failure: "result_too_large", resultBytes }
      : { ok: true, result: outcome.result, resultBytes };
  }
  if (isRecord(outcome) && outcome.failure === "missing_export") {
    return { ok: false, failure: "missing_export" };
  }
  const message = isRecord(outcome) ? outcome.message : undefined;
  const httpStatus = isRecord(outcome) ? outcome.httpStatus : undefined;
  return {
    ok: false,
    failure: "plugin_error",
    ...(typeof message === "string" ? { message: cutMessage(message) } : {}),
    ...(Number.isInteger(httpStatus) &&
    /** @type {number} */ (httpStatus) >= 100 &&
    /** @type {number} */ (httpStatus) <= 599
      ? { httpStatus }
      : {}),
  };
}

/**
 * The error `ajour.http` rejects with in the worker: an abort, or the
 * broker's own refusal with its code. Any other error is the broker's
 * transport, whose message can name the address, so only its kind goes.
 *
 * @param {any} error
 */
function brokerErrorOf(error) {
  if (error?.name === "AbortError") return { name: "AbortError" };
  if (error?.name === "AjourRequestError" && typeof error.code === "string") {
    return {
      name: "AjourRequestError",
      code: error.code,
      message: String(error.message),
    };
  }
  return {
    name: "AjourRequestError",
    code: "network",
    message: "The request failed.",
  };
}

/** The entrypoint's URL in the plugin's origin. @param {string} pluginId @param {string} entrypoint */
function entrypointUrl(pluginId, entrypoint) {
  const segments = entrypoint
    .split(/[\\/]+/u)
    .filter((segment) => segment !== "" && segment !== ".")
    .map(encodeURIComponent);
  return `${PLUGIN_SCHEME}://${pluginId}/${segments.join("/")}`;
}

/**
 * Makes the runtime and registers its IPC channel. Main makes one, once,
 * after `ready`, and hands it to each start of the local API.
 *
 * @param {{
 *   app: { getAppMetrics(): any[] },
 *   session: { fromPartition(partition: string, options?: { cache?: boolean }): any },
 *   WebContentsView: new (options: any) => { webContents: any },
 *   ipcListeners: { handle(channel: "ajour:plugin-renderer", listener: (event: any, ...args: any[]) => any): void },
 *   events: any,
 *   hostDirectory: string,
 *   preloadPath: string,
 *   platform: string,
 *   devTools: boolean,
 *   launchRefusal?: import("./plugin-sandbox.cjs").SandboxRefusal,
 *   idleCloseMs?: number,
 *   readyTimeoutMs?: number,
 *   memorySampleMs?: number,
 *   now?: () => number,
 *   whenSwept?: Promise<unknown>,
 *   processRecord?: {
 *     add(entry: { pid: number, createdAt?: number, pluginId: string }): void,
 *     remove(pid: number): void,
 *   },
 * }} options
 */
function createPluginRendererRuntime({
  app,
  session,
  WebContentsView,
  ipcListeners,
  events,
  hostDirectory,
  preloadPath,
  platform,
  devTools,
  launchRefusal,
  idleCloseMs = IDLE_CLOSE_MS,
  readyTimeoutMs = READY_TIMEOUT_MS,
  memorySampleMs = MEMORY_SAMPLE_MS,
  now = Date.now,
  processRecord,
  whenSwept,
}) {
  /**
   * @type {{
   *   recordBlocked(pluginId: string, at: number): Promise<void>,
   *   recordStopped?(pluginId: string, cause: string, at: number): void,
   * } | undefined}
   */
  let host;
  /** The plugins the API keeps "Always ready", by plugin id. */
  let readyPlugins = new Map();
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let memorySampler;
  /** @type {import("./plugin-sandbox.cjs").SandboxRefusal | undefined} */
  let rendererRefusal;
  /** Each plugin's open renderer, by plugin id. */
  const renderers = new Map();
  /** The renderer each registered page's webContents belongs to, by its id. */
  const byWebContents = new Map();
  /** Each plugin's session, set up once: its partition outlives a renderer. */
  const sessions = new Map();
  /** Blocked attempts counted this second, per plugin. */
  const blockedWindows = new Map();
  let nextRunId = 1;

  if (launchRefusal) recordSandboxOff(launchRefusal);

  function recordSandboxOff(refusal) {
    events
      .start("plugin_sandbox.off", {
        kind: "lifecycle",
        trigger: "system",
        detached: true,
      })
      .set({ sandbox: { cause: refusal.cause } })
      .end("refused", refusal.cause);
  }

  function unavailable() {
    return launchRefusal ?? rendererRefusal;
  }

  /**
   * A way out the sandbox closed: an event names the plugin and the kind of
   * exit, never where it led, and it counts for Access review. The
   * renderer goes on: harmless libraries try this.
   *
   * @param {string} pluginId
   * @param {"request" | "policy" | "permission" | "device" | "download" | "navigation" | "window_open"} exit
   */
  function blocked(pluginId, exit) {
    const at = now();
    const second = Math.floor(at / 1000);
    const window = blockedWindows.get(pluginId);
    if (window?.second === second && window.count >= BLOCKED_PER_SECOND) {
      return;
    }
    blockedWindows.set(pluginId, {
      second,
      count: window?.second === second ? window.count + 1 : 1,
    });
    events
      .start("plugin_renderer.blocked", {
        kind: "navigation",
        trigger: "system",
        detached: true,
      })
      .set({ plugin: { id: pluginId }, blocked: { exit } })
      .end("refused", "blocked");
    host?.recordBlocked(pluginId, at).catch(() => undefined);
  }

  /** Closes every way out of the plugin's session but its own files. */
  function sessionOf(pluginId) {
    const existing = sessions.get(pluginId);
    if (existing) return existing;
    const ready = (async () => {
      const pluginSession = session.fromPartition(pluginPartition(pluginId), {
        cache: false,
      });
      pluginSession.protocol.handle(PLUGIN_SCHEME, (request) => {
        const renderer = renderers.get(pluginId);
        // A closed renderer's package is served no more.
        if (!renderer) {
          return new Response("Not found", {
            status: 404,
            headers: pluginFileHeaders("404.txt"),
          });
        }
        return servePluginFile(request, {
          pluginId,
          packageDirectory: renderer.packageDirectory,
          hostDirectory,
        });
      });
      pluginSession.webRequest.onBeforeRequest((details, callback) => {
        if (pluginRequestAllowed(details.url, pluginId)) {
          callback({});
          return;
        }
        blocked(pluginId, "request");
        callback({ cancel: true });
      });
      await pluginSession.setProxy(DEAD_PROXY);
      pluginSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => {
          blocked(pluginId, "permission");
          callback(false);
        },
      );
      pluginSession.setPermissionCheckHandler(() => false);
      pluginSession.setDevicePermissionHandler(() => false);
      for (const name of ["select-hid-device", "select-usb-device"]) {
        pluginSession.on(name, (event, _details, callback) => {
          event.preventDefault();
          blocked(pluginId, "device");
          callback();
        });
      }
      pluginSession.on(
        "select-serial-port",
        (event, _ports, _contents, callback) => {
          event.preventDefault();
          blocked(pluginId, "device");
          callback("");
        },
      );
      pluginSession.on("will-download", (event) => {
        event.preventDefault();
        blocked(pluginId, "download");
      });
      pluginSession.setSpellCheckerEnabled(false);
      return pluginSession;
    })();
    sessions.set(pluginId, ready);
    return ready;
  }

  /** Sends a command to the renderer's page, or keeps it until the page asks. */
  function send(renderer, command) {
    if (renderer.ready && renderer.pull) {
      const pull = renderer.pull;
      renderer.pull = null;
      pull(command);
    } else {
      renderer.commands.push(command);
    }
  }

  /** An "Always ready" renderer never closes for being idle. */
  function scheduleIdleClose(renderer) {
    clearTimeout(renderer.idleTimer);
    if (renderer.closed || renderer.resident || renderer.runs.size > 0) return;
    renderer.idleTimer = setTimeout(() => {
      if (renderer.runs.size === 0 && !renderer.resident) {
        void closeRenderer(renderer, undefined, "idle");
      }
    }, idleCloseMs);
    renderer.idleTimer.unref?.();
  }

  /** What a closed renderer's event ends with, by why it closed. */
  const CLOSE_OUTCOMES = {
    idle: "ok",
    package_change: "ok",
    quit: "ok",
    timeout: "timeout",
    memory: "error",
    crashed: "error",
    failed: "error",
    sandbox_off: "refused",
  };

  /**
   * Closes the renderer and settles its runs with `outcome`. Resolves once
   * its page is gone, or after a few seconds. `why` names it in the
   * renderer's `plugin_renderer.close` event.
   *
   * @param {any} renderer
   * @param {any} [outcome]
   * @param {keyof typeof CLOSE_OUTCOMES} [why]
   */
  function closeRenderer(
    renderer,
    outcome = { ok: false, failure: "terminated" },
    why = "quit",
  ) {
    if (renderer.closed) return renderer.closing;
    renderer.closed = true;
    clearTimeout(renderer.idleTimer);
    clearTimeout(renderer.readyTimer);
    if (renderers.get(renderer.pluginId) === renderer) {
      renderers.delete(renderer.pluginId);
    }
    for (const run of [...renderer.runs.values()]) run.settle(outcome);
    renderer.pull?.(undefined);
    renderer.pull = null;
    if (renderer.ready) {
      events
        .start("plugin_renderer.close", {
          kind: "lifecycle",
          trigger: "system",
          detached: true,
        })
        .set({
          plugin: { id: renderer.pluginId },
          plugin_renderer: {
            close_reason: why,
            life_ms: now() - renderer.openedAt,
            always_ready: renderer.resident,
            memory_ceiling_mb: renderer.memoryCeilingMb,
            ...(renderer.memoryMb !== undefined
              ? { memory_mb: renderer.memoryMb }
              : {}),
          },
        })
        .end(CLOSE_OUTCOMES[why] ?? "ok");
    }
    renderer.closing = (async () => {
      await renderer.opening;
      const contents = renderer.webContents;
      if (contents) byWebContents.delete(contents.id);
      if (contents && !contents.isDestroyed()) {
        const destroyed = new Promise((resolve) =>
          contents.once("destroyed", resolve),
        );
        contents.close();
        await Promise.race([destroyed, delay(CLOSE_TIMEOUT_MS)]);
      }
      if (renderer.pid !== undefined) processRecord?.remove(renderer.pid);
    })().catch(() => undefined);
    return renderer.closing;
  }

  /**
   * The memory each ready renderer's process uses, read every few seconds
   * while one is open: above its ceiling, it closes, and its runs fail
   * with `memory`. Private bytes on Windows, the working set elsewhere.
   */
  function sampleMemory() {
    const open = [...renderers.values()].filter(
      (renderer) => renderer.ready && !renderer.closed,
    );
    if (open.length === 0) {
      clearInterval(memorySampler);
      memorySampler = undefined;
      return;
    }
    let metrics;
    try {
      metrics = app.getAppMetrics();
    } catch {
      return;
    }
    for (const renderer of open) {
      const memory = metrics.find(
        (metric) => metric.pid === renderer.pid,
      )?.memory;
      const kilobytes = memory?.privateBytes ?? memory?.workingSetSize;
      if (typeof kilobytes !== "number") continue;
      renderer.memoryMb = Math.round(kilobytes / 1024);
      if (kilobytes <= renderer.memoryCeilingMb * 1024) continue;
      host?.recordStopped?.(renderer.pluginId, "memory", now());
      void closeRenderer(
        renderer,
        { ok: false, failure: "crashed", cause: "memory" },
        "memory",
      );
    }
  }

  function watchMemory() {
    if (memorySampler) return;
    memorySampler = setInterval(sampleMemory, memorySampleMs);
    memorySampler.unref?.();
  }

  /** Turns every plugin off: a renderer isn't sandboxed as it must be. */
  function turnOff(refusal) {
    if (!rendererRefusal) {
      rendererRefusal = refusal;
      recordSandboxOff(refusal);
    }
    const outcome = {
      ok: false,
      failure: "runtime_unavailable",
      reason: refusal.reason,
    };
    for (const renderer of [...renderers.values()]) {
      void closeRenderer(renderer, outcome, "sandbox_off");
    }
  }

  /**
   * @param {string} pluginId
   * @param {string} packageDirectory
   * @param {{ alwaysReady: boolean, memoryCeilingMb: number }} lifecycle
   */
  function openRenderer(pluginId, packageDirectory, lifecycle) {
    const renderer = {
      pluginId,
      packageDirectory,
      /** "Always ready": it never closes for being idle. */
      resident: lifecycle.alwaysReady || readyPlugins.has(pluginId),
      /** Read once, at the start: a change takes effect on the next one. */
      memoryCeilingMb: lifecycle.memoryCeilingMb,
      /** @type {number | undefined} */ memoryMb: undefined,
      /** @type {any} */ view: null,
      /** @type {any} */ webContents: null,
      ready: false,
      closed: false,
      /** @type {((command: unknown) => void) | null} */ pull: null,
      /** @type {unknown[]} */ commands: [],
      runs: new Map(),
      /** @type {number | undefined} */ pid: undefined,
      /** @type {ReturnType<typeof setTimeout> | undefined} */ idleTimer:
        undefined,
      /** @type {ReturnType<typeof setTimeout> | undefined} */ readyTimer:
        undefined,
      /** @type {Promise<void> | undefined} */ opening: undefined,
      /** @type {Promise<void> | undefined} */ closing: undefined,
      unit: events.start("plugin_renderer.open", {
        kind: "lifecycle",
        trigger: "system",
        detached: true,
      }),
      openedAt: now(),
    };
    renderer.unit.set({ plugin: { id: pluginId } });
    renderers.set(pluginId, renderer);
    renderer.readyTimer = setTimeout(() => {
      if (renderer.ready || renderer.closed) return;
      renderer.unit.end("timeout", "ready_timeout");
      void closeRenderer(
        renderer,
        {
          ok: false,
          failure: "plugin_error",
          message: "Ajour couldn't start the plugin's page.",
        },
        "failed",
      );
    }, readyTimeoutMs);
    renderer.readyTimer.unref?.();
    renderer.opening = (async () => {
      // The last session's orphans go first (plugin-renderer-sweep.cjs).
      await whenSwept;
      await sessionOf(pluginId);
      if (renderer.closed) return;
      const view = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          webviewTag: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          experimentalFeatures: false,
          navigateOnDragDrop: false,
          spellcheck: false,
          disableDialogs: true,
          backgroundThrottling: false,
          partition: pluginPartition(pluginId),
          preload: preloadPath,
          devTools,
        },
      });
      // The view is held as long as its renderer: a view nothing holds is
      // collected, and its page closes with it.
      renderer.view = view;
      const contents = view.webContents;
      renderer.webContents = contents;
      byWebContents.set(contents.id, renderer);
      contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
      contents.setAudioMuted(true);
      contents.setWindowOpenHandler(() => {
        blocked(pluginId, "window_open");
        return { action: "deny" };
      });
      // Only Ajour's main process loads the page; the page itself goes nowhere.
      for (const name of ["will-frame-navigate", "will-redirect"]) {
        contents.on(name, (event) => {
          event.preventDefault();
          blocked(pluginId, "navigation");
        });
      }
      // A page Ajour didn't close is gone: its runs can't end otherwise.
      contents.once("destroyed", () => {
        if (renderer.closed) return;
        void closeRenderer(
          renderer,
          { ok: false, failure: "crashed", cause: "killed" },
          "crashed",
        );
      });
      contents.on("will-attach-webview", (event) => event.preventDefault());
      contents.on("select-bluetooth-device", (event, _devices, callback) => {
        event.preventDefault();
        blocked(pluginId, "device");
        callback("");
      });
      contents.on("render-process-gone", (_event, details) => {
        if (renderer.closed) return;
        const cause = CRASH_CAUSES[details?.reason] ?? "crashed";
        events
          .start("process.gone", {
            kind: "crash",
            trigger: "system",
            detached: true,
          })
          .set({
            plugin: { id: pluginId },
            process: {
              type: "plugin_renderer",
              reason: details?.reason,
              exit_code: details?.exitCode,
            },
          })
          .end("error");
        // Any process that ended counts against the plugin, run or not.
        host?.recordStopped?.(pluginId, cause, now());
        void closeRenderer(
          renderer,
          { ok: false, failure: "crashed", cause },
          "crashed",
        );
      });
      contents.on(
        "did-fail-load",
        (_event, _code, _description, _url, isMainFrame) => {
          if (!isMainFrame || renderer.ready || renderer.closed) return;
          renderer.unit.end("error", "load_failed");
          void closeRenderer(
            renderer,
            {
              ok: false,
              failure: "plugin_error",
              message: "Ajour couldn't load the plugin's page.",
            },
            "failed",
          );
        },
      );
      contents.loadURL(hostPageUrl(pluginId)).catch(() => undefined);
    })().catch(() => {
      renderer.unit.end("error", "load_failed");
      void closeRenderer(
        renderer,
        {
          ok: false,
          failure: "plugin_error",
          message: "Ajour couldn't start the plugin's page.",
        },
        "failed",
      );
    });
    return renderer;
  }

  /**
   * The page loaded: before any plugin code runs, its process must report
   * the sandbox. If it doesn't, every plugin turns off.
   */
  function onReady(renderer) {
    if (renderer.ready) return true;
    const pid = renderer.webContents.getOSProcessId();
    const metrics = app.getAppMetrics();
    const refusal = rendererSandboxRefusal({
      pid,
      metrics,
      platform,
      otherPluginPids: [...renderers.values()]
        .filter((other) => other !== renderer && other.ready)
        .map((other) => other.pid),
    });
    if (refusal) {
      renderer.unit.set({ sandbox: { cause: refusal.cause } });
      renderer.unit.end("refused", "not_sandboxed");
      turnOff(refusal);
      return false;
    }
    clearTimeout(renderer.readyTimer);
    renderer.pid = pid;
    renderer.ready = true;
    // Recorded for the next launch's sweep, should Ajour end without closing it.
    const createdAt = metrics.find(
      (metric) => metric.pid === pid,
    )?.creationTime;
    processRecord?.add({
      pid,
      pluginId: renderer.pluginId,
      ...(typeof createdAt === "number" ? { createdAt } : {}),
    });
    watchMemory();
    renderer.unit
      .set({
        plugin_renderer: {
          open_ms: now() - renderer.openedAt,
          always_ready: renderer.resident,
        },
      })
      .end();
    // An "Always ready" page that opened with no call waits for one.
    scheduleIdleClose(renderer);
    return true;
  }

  function nextCommand(renderer) {
    if (renderer.commands.length > 0) return renderer.commands.shift();
    // One page asks at a time; an earlier ask is answered empty.
    renderer.pull?.(undefined);
    return new Promise((resolve) => {
      renderer.pull = resolve;
    });
  }

  async function brokerCall(run, callId, sendRequest) {
    const controller = new AbortController();
    const id = typeof callId === "number" ? callId : undefined;
    if (id !== undefined) run.aborts.set(id, controller);
    try {
      const response = await sendRequest(controller.signal);
      return {
        ok: true,
        response: {
          status: response.status,
          headers: response.headers,
          body: response.body,
        },
      };
    } catch (error) {
      return { ok: false, error: brokerErrorOf(error) };
    } finally {
      if (id !== undefined) run.aborts.delete(id);
    }
  }

  const endedAnswer = {
    ok: false,
    error: {
      name: "AjourRequestError",
      code: "refused",
      message: "This plugin operation has ended.",
    },
  };

  /** One message from a registered plugin page, already identified. */
  function handleMessage(renderer, message) {
    const unit = events.current();
    if (!isRecord(message) || !MESSAGE_TYPES.has(String(message.type))) {
      throw new Error("Ajour can't read this message.");
    }
    const type = /** @type {string} */ (message.type);
    if (type === "ready") return onReady(renderer);
    if (!renderer.ready) throw new Error("The plugin's page isn't ready.");
    if (type === "next") return nextCommand(renderer);
    if (type === "blocked") {
      blocked(renderer.pluginId, "policy");
      return undefined;
    }
    // Only the sender's own runs: another plugin's run is unknown here.
    const run =
      typeof message.runId === "string"
        ? renderer.runs.get(message.runId)
        : undefined;
    if (!run) {
      unit?.refuse("unknown_run");
      return type === "http" || type === "publicFetch"
        ? endedAnswer
        : undefined;
    }
    if (type === "settled") {
      run.reportedSettled = true;
      run.settle(outcomeFromPage(message.outcome));
      return undefined;
    }
    if (type === "abort") {
      run.aborts.get(message.callId)?.abort();
      return undefined;
    }
    const broker = run.broker;
    if (!broker) return endedAnswer;
    if (type === "http") {
      const given = isRecord(message.request) ? message.request : {};
      const request = Object.fromEntries(
        HTTP_REQUEST_KEYS.filter((key) => Object.hasOwn(given, key)).map(
          (key) => [key, given[key]],
        ),
      );
      return brokerCall(run, message.callId, (signal) =>
        broker.http({ ...request, signal }),
      );
    }
    const init = isRecord(message.init) ? message.init : {};
    return brokerCall(run, message.callId, (signal) =>
      broker.publicFetch(String(message.url), {
        ...(typeof init.method === "string" ? { method: init.method } : {}),
        ...(isRecord(init.headers) ? { headers: init.headers } : {}),
        signal,
      }),
    );
  }

  ipcListeners.handle("ajour:plugin-renderer", (event, message) => {
    // Read before anything awaits, while the frame is the one that sent it.
    const pluginId = pluginOfSender(
      event,
      (id) => byWebContents.get(id)?.pluginId,
    );
    const renderer =
      pluginId === undefined ? undefined : byWebContents.get(event.sender.id);
    if (!renderer || renderer.closed) {
      throw refusedSender("Only a plugin's own page can reach its host.");
    }
    events.current()?.set({
      plugin: { id: renderer.pluginId },
      plugin_renderer: {
        message:
          isRecord(message) && MESSAGE_TYPES.has(String(message.type))
            ? message.type
            : "other",
      },
    });
    return handleMessage(renderer, message);
  });

  // The local API's runtime port (apps/api/src/plugin-runtime.ts), with what main adds.
  const runtime = {
    runsPluginApi4: true,

    unavailableReason() {
      return unavailable()?.reason;
    },

    attach(given) {
      host = given;
    },

    start(invocation) {
      const refusal = unavailable();
      if (refusal) {
        return {
          settled: Promise.resolve({
            ok: false,
            failure: "runtime_unavailable",
            reason: refusal.reason,
          }),
          terminate: async () => {},
        };
      }
      const packageDirectory = path.resolve(invocation.packageDirectory);
      let renderer = renderers.get(invocation.pluginId);
      if (renderer && renderer.packageDirectory !== packageDirectory) {
        // An update moved the package: its renderer opens again for it.
        void closeRenderer(renderer, undefined, "package_change");
        renderer = undefined;
      }
      renderer ??= openRenderer(
        invocation.pluginId,
        packageDirectory,
        invocation.lifecycle ?? DEFAULT_LIFECYCLE,
      );
      clearTimeout(renderer.idleTimer);
      const runId = String(nextRunId++);
      /** @type {(outcome: any) => void} */
      let resolveSettled = () => {};
      const settled = new Promise((resolve) => {
        resolveSettled = resolve;
      });
      const current = renderer;
      const run = {
        runId,
        broker: invocation.broker,
        aborts: new Map(),
        done: false,
        reportedSettled: false,
        settle(outcome) {
          if (run.done) return;
          run.done = true;
          for (const controller of run.aborts.values()) controller.abort();
          current.runs.delete(runId);
          resolveSettled(outcome);
          scheduleIdleClose(current);
        },
      };
      renderer.runs.set(runId, run);
      const start = {
        type: "start",
        runId,
        url: entrypointUrl(invocation.pluginId, invocation.entrypoint),
        method: invocation.method,
        args: invocation.args,
      };
      send(renderer, start);
      return {
        settled,
        terminate: async (reason) => {
          run.settle({ ok: false, failure: "terminated" });
          // A run that never reached the page leaves nothing behind.
          const queued = current.commands.indexOf(start);
          if (queued !== -1) current.commands.splice(queued, 1);
          if (reason === "timeout") {
            // A plugin that runs past its time may hold its page: it closes.
            // The API counts the timeout against the plugin.
            await closeRenderer(current, undefined, "timeout");
          } else if (!current.closed && queued === -1 && !run.reportedSettled) {
            send(current, { type: "stop", runId });
          }
        },
      };
    },

    /**
     * The API's "Always ready" plugins, all of them each time: those not
     * open start now, unless plugins are off on this computer, and an open
     * renderer no longer listed closes once idle.
     */
    keepReady(plugins) {
      readyPlugins = new Map(
        plugins.map((plugin) => [plugin.pluginId, plugin]),
      );
      for (const renderer of renderers.values()) {
        renderer.resident = readyPlugins.has(renderer.pluginId);
        if (renderer.resident) clearTimeout(renderer.idleTimer);
        else if (renderer.ready) scheduleIdleClose(renderer);
      }
      if (unavailable()) return;
      for (const plugin of readyPlugins.values()) {
        const packageDirectory = path.resolve(plugin.packageDirectory);
        const open = renderers.get(plugin.pluginId);
        if (open?.packageDirectory === packageDirectory) continue;
        if (open && open.runs.size > 0) continue;
        if (open) void closeRenderer(open, undefined, "package_change");
        openRenderer(plugin.pluginId, packageDirectory, plugin.lifecycle);
      }
    },

    /** Closes every plugin's renderer, as Ajour quits or installs an update. */
    async closeAll() {
      readyPlugins = new Map();
      clearInterval(memorySampler);
      memorySampler = undefined;
      await Promise.all(
        [...renderers.values()].map((renderer) =>
          closeRenderer(renderer, undefined, "quit"),
        ),
      );
    },

    /** Each open plugin renderer's OS process, by plugin id, for checks. */
    rendererProcessIds() {
      return Object.fromEntries(
        [...renderers.values()]
          .filter((renderer) => renderer.ready)
          .map((renderer) => [renderer.pluginId, renderer.pid]),
      );
    },
  };
  return runtime;
}

module.exports = {
  DEAD_PROXY,
  createPluginRendererRuntime,
};
