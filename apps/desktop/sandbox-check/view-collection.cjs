// The minimal repro of #449, which `scripts/check-plugin-sandbox.mjs` runs:
// why the plugin runtime holds each plugin's WebContentsView. A hidden,
// sandboxed page on a plugin-like origin starts one module worker after
// another, each importing a module served by `protocol.handle`, while main
// collects its garbage.
//
// - Held: main keeps the view. All the workers run: the protocol handler
//   has no limit on how many requests it serves.
// - Not held: main keeps only the view's webContents. Once main collects
//   the view, Electron closes its page, and the next worker never starts.
//   Without forced collections this happened after a few dozen workers, as
//   allocations triggered one: it looked like the protocol handler stalling.
//
// It reads one `CHECK {json}` line per finding on stdout.
"use strict";

const { app, protocol, session, WebContentsView } = require("electron");
const path = require("node:path");

const { PLUGIN_SCHEME } = require(
  path.resolve(__dirname, "../electron/plugin-renderer-policy.cjs"),
);

const WORKERS = 500;
/** How long one worker may take before the page counts it as stalled. */
const WORKER_TIMEOUT_MS = 5_000;

const userData = process.env.AJOUR_USER_DATA_PATH;
if (!userData) throw new Error("Set AJOUR_USER_DATA_PATH to a temp folder.");
app.setPath("userData", userData);

// As Ajour registers the plugin scheme (main.cjs).
protocol.registerSchemesAsPrivileged([
  { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true } },
]);

function report(event, data = {}) {
  process.stdout.write(`CHECK ${JSON.stringify({ event, ...data })}\n`);
}

const watchdog = setTimeout(() => {
  report("watchdog");
  app.exit(9);
}, 60_000);

const FILES = {
  "/host.html": [
    "text/html",
    '<!doctype html><meta charset="utf-8"><script type="module" src="./host.js"></script>',
  ],
  // One worker at a time, each ended once it answers, as Ajour's page does.
  "/host.js": [
    "text/javascript",
    `const one = (index) => new Promise((resolve) => {
      const worker = new Worker("/worker.js?" + index, { type: "module" });
      const timer = setTimeout(() => resolve("stalled"), ${WORKER_TIMEOUT_MS});
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(data);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        event.preventDefault();
        worker.terminate();
        resolve("error");
      };
    });
    window.result = (async () => {
      for (let index = 0; index < ${WORKERS}; index += 1) {
        const answer = await one(index);
        if (answer !== "ok") return { completed: index, answer };
      }
      return { completed: ${WORKERS}, answer: "ok" };
    })();`,
  ],
  "/worker.js": [
    "text/javascript",
    'import("/module.mjs?" + Math.random()).then(() => postMessage("ok"), () => postMessage("import failed"));',
  ],
  "/module.mjs": ["text/javascript", "export const value = 1;"],
};

/** A full garbage collection of the main process, on demand. */
function forcedGarbageCollection() {
  require("node:v8").setFlagsFromString("--expose-gc");
  return require("node:vm").runInNewContext("gc");
}

/**
 * Opens a hidden sandboxed page on its own in-memory partition, runs the
 * workers, and reports how far they got and whether its page closed.
 *
 * @param {"held" | "unheld"} name
 * @param {() => void} collectGarbage
 */
async function runWorkers(name, collectGarbage) {
  const partition = `${PLUGIN_SCHEME}:view-collection-${name}`;
  const pluginSession = session.fromPartition(partition, { cache: false });
  let served = 0;
  pluginSession.protocol.handle(PLUGIN_SCHEME, (request) => {
    served += 1;
    if (served % 50 === 0) setImmediate(collectGarbage);
    const file =
      FILES[/** @type {keyof typeof FILES} */ (new URL(request.url).pathname)];
    return file
      ? new Response(file[1], {
          headers: {
            "content-type": `${file[0]}; charset=utf-8`,
            "cache-control": "no-store",
          },
        })
      : new Response("Not found", { status: 404 });
  });
  /** @type {WebContentsView | undefined} */
  let held;
  // Made in a function of its own, so the unheld view is in no live scope.
  const open = () => {
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition,
        backgroundThrottling: false,
      },
    });
    if (name === "held") held = view;
    return view.webContents;
  };
  const contents = open();
  let pageClosed = false;
  const closed = new Promise((resolve) =>
    contents.once("destroyed", () => {
      pageClosed = true;
      resolve({ completed: null, answer: "page closed" });
    }),
  );
  const startedAt = Date.now();
  const result = await Promise.race([
    contents
      .loadURL(`${PLUGIN_SCHEME}://view-collection/host.html`)
      .then(() => contents.executeJavaScript("window.result")),
    closed,
  ]).catch((error) => ({ completed: null, answer: String(error) }));
  report(name, {
    workers: WORKERS,
    ...result,
    pageClosed,
    served,
    ms: Date.now() - startedAt,
  });
  if (!contents.isDestroyed()) contents.close();
  held = undefined;
}

app
  .whenReady()
  .then(async () => {
    const collectGarbage = forcedGarbageCollection();
    await runWorkers("held", collectGarbage);
    await runWorkers("unheld", collectGarbage);
    report("quitting", {
      appPids: app.getAppMetrics().map((metric) => metric.pid),
    });
    clearTimeout(watchdog);
    app.quit();
  })
  .catch((error) => {
    report("error", { error: String(error?.stack ?? error) });
    app.exit(2);
  });
