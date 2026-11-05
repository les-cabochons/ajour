// The release check of the six official plugins (#403, seam 3 of the spec
// #381). `scripts/check-plugin-release.mjs` starts this entrypoint inside a
// packaged build, which exists only for the check (`plugin-release.config.cjs`):
// production releases never contain it. It runs the real sandboxed renderer
// runtime, IPC table, credential broker and local API against the official
// plugins at a commit of `les-cabochons/ajour-plugins`, with fixture services
// in place of Jira, GitHub, Azure DevOps and a calendar server. The cases
// are in `official-plugins/cases.cjs`.
//
// Run unpackaged for quick turns, from `apps/desktop`:
//   AJOUR_RELEASE_CHECK_UNPACKAGED=1 AJOUR_USER_DATA_PATH=<empty folder> \
//   AJOUR_PLUGINS_CHECK_SOURCE=<folder> AJOUR_PLUGINS_CHECK_LEGACY=<folder> \
//   electron sandbox-check/official-plugins.cjs
"use strict";

const {
  app,
  ipcMain,
  protocol,
  session,
  WebContentsView,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const unpackaged = process.env.AJOUR_RELEASE_CHECK_UNPACKAGED === "1";
const electronRoot = path.resolve(__dirname, "../electron");
const apiRoot = unpackaged
  ? path.resolve(__dirname, "../../api/src")
  : path.join(process.resourcesPath, "internal-app-runtime", "apps/api/src");
const runtimeModules = unpackaged
  ? path.resolve(__dirname, "../node_modules")
  : path.join(process.resourcesPath, "internal-app-runtime", "node_modules");

const { PLUGIN_SCHEME } = require(
  path.join(electronRoot, "plugin-renderer-policy.cjs"),
);
const { createPluginRendererRuntime } = require(
  path.join(electronRoot, "plugin-renderer-runtime.cjs"),
);
const { createIpcListeners } = require(
  path.join(electronRoot, "ipc-listeners.cjs"),
);
const { createMainEvents } = require(
  path.join(electronRoot, "main-events.cjs"),
);
const { runCases } = require("./official-plugins/cases.cjs");

protocol.registerSchemesAsPrivileged([
  { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true } },
]);
app.setPath("userData", process.env.AJOUR_USER_DATA_PATH);

const load = (name) => import(pathToFileURL(path.join(apiRoot, name)).href);
const watchdog = setTimeout(() => {
  process.stderr.write("The release check did not finish in time.\n");
  app.exit(2);
}, 170_000);

/** Everything the app wrote to its output streams, to search for a secret. */
const output = [];
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    output.push(String(chunk));
    return write(chunk, ...rest);
  };
}

async function cleanUp(steps) {
  for (const step of steps.reverse()) {
    await Promise.race([
      Promise.resolve()
        .then(step)
        .catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ]);
  }
}

app
  .whenReady()
  .then(async () => {
    if (!unpackaged && !app.isPackaged) {
      throw new Error("The release check must run from a packaged build.");
    }
    const cleanup = [];
    let failure;
    try {
      const events = createMainEvents();
      const runtime = createPluginRendererRuntime({
        app,
        session,
        WebContentsView,
        ipcListeners: createIpcListeners(ipcMain, {
          events,
          windowSession: () => session.defaultSession,
        }),
        events,
        hostDirectory: path.join(electronRoot, "plugin-host"),
        preloadPath: path.join(electronRoot, "plugin-host/preload.cjs"),
        platform: process.platform,
        devTools: false,
      });
      cleanup.push(() => runtime.closeAll());
      await runCases({
        app,
        load,
        runtime,
        output,
        userData: app.getPath("userData"),
        sourceRoot: process.env.AJOUR_PLUGINS_CHECK_SOURCE,
        legacyRoot: process.env.AJOUR_PLUGINS_CHECK_LEGACY,
        tar: require(
          require.resolve("tar", { paths: [runtimeModules, apiRoot] }),
        ),
        onCleanup: (step) => cleanup.push(step),
        packaged: app.isPackaged,
      });
    } catch (error) {
      failure = error;
      process.stderr.write(`${error.stack ?? error}\n`);
    } finally {
      await cleanUp(cleanup);
      clearTimeout(watchdog);
    }
    app.exit(failure ? 1 : 0);
  })
  .catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    app.exit(1);
  });
