// The real-Electron check of the process broker under attack (#725, ADR
// 0019), part of seam 3. `scripts/check-plugin-sandbox.mjs` starts it and
// reads one `CHECK {json}` line per finding on stdout. The malicious fixture
// plugin (`fixtures/fixture-escape`, a development plugin, so unsigned) runs
// in its sandboxed renderer and reaches the broker the way every plugin does:
// worker, page, preload, main, then the local API. Each attack is a phase of
// its `startHandoff`, so the broker runs with the hand off's project, as a
// real one does. Between phases the check changes what Ajour allows: the
// unsigned process switch, the plugin's acceptance, a manifest that widens
// its access without consent, and its command mode.
//
// The fixture's echo tool prints the argv it got and the names of its
// AJOUR_ variables. On Windows it is an npm `.cmd` shim, so shell
// metacharacters in a text slot meet the launcher cmd.exe would run, and
// the broker must resolve it to node.exe without one. Markers that any
// injection would write, and links main would open, are read at the end.
// It never listens on Ajour's port.
"use strict";

const {
  app,
  ipcMain,
  net,
  protocol,
  session,
  WebContentsView,
  webContents,
} = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");

const electronRoot = path.resolve(__dirname, "../electron");
const apiRoot = path.resolve(__dirname, "../../api/src");
const { createIpcListeners } = require(
  path.join(electronRoot, "ipc-listeners.cjs"),
);
const { createMainEvents } = require(
  path.join(electronRoot, "main-events.cjs"),
);
const { createBrokerNetwork } = require(
  path.join(electronRoot, "broker-transport.cjs"),
);
const { PLUGIN_SCHEME } = require(
  path.join(electronRoot, "plugin-renderer-policy.cjs"),
);
const { createPluginRendererRuntime } = require(
  path.join(electronRoot, "plugin-renderer-runtime.cjs"),
);
const { launchSandboxRefusal } = require(
  path.join(electronRoot, "plugin-sandbox.cjs"),
);
const { protectedRepositoryFolders } = require(
  path.join(electronRoot, "repository-folders.cjs"),
);
const { openPluginLink } = require(
  path.join(electronRoot, "terminal-settings.cjs"),
);
const { writeFakeTool } = require("./fake-tool.cjs");
const { eventsHold } = require("./event-values.cjs");

const PLUGIN = "fixture-escape";
const FIXTURE = path.join(__dirname, "fixtures", PLUGIN);
const userData = process.env.AJOUR_USER_DATA_PATH;
if (!userData) throw new Error("Set AJOUR_USER_DATA_PATH to a temp folder.");
// An AJOUR_ variable of Ajour's own environment, which no child may see.
const canary = process.env.AJOUR_CHECK_CANARY;
if (!canary) throw new Error("Set AJOUR_CHECK_CANARY.");
app.setPath("userData", userData);

protocol.registerSchemesAsPrivileged([
  { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true } },
]);

function report(event, data = {}) {
  process.stdout.write(`CHECK ${JSON.stringify({ event, ...data })}\n`);
}

const watchdog = setTimeout(() => {
  report("watchdog");
  app.exit(9);
}, 120_000);

/** Prints the argv it got, and the names of the AJOUR_ variables it has. */
const ECHO = `process.stdout.write(
  JSON.stringify({
    argv: process.argv.slice(2),
    env: Object.keys(process.env).filter((name) => /^ajour_/i.test(name)),
  }),
);
`;

/**
 * Shell metacharacters for a text slot. Each would write a marker if a
 * shell, cmd.exe's included, read the value; the broker passes it as one
 * argv element, so the echo tool gets it as is and no marker appears.
 */
function injectionValues(markers) {
  const marker = (name) => path.join(markers, name);
  return [
    `x" & echo pwned > "${marker("quote-break")}" & rem "`,
    `x & echo pwned > ${marker("ampersand")}`,
    `"&echo pwned>"${marker("leading-quote")}`,
    `x\\" & echo pwned > ${marker("backslash-quote")} & "`,
    `^& echo pwned > ${marker("caret")}`,
    `%COMSPEC% /c echo pwned > ${marker("comspec")}`,
    "%PATH%",
    "!PATH!",
    `x | echo pwned > ${marker("pipe")}`,
    `$(touch ${marker("substitution")})`,
    `\`touch ${marker("backtick")}\``,
    `x; touch ${marker("semicolon")}`,
    "x\\",
    'a"b c"d',
  ];
}

async function main() {
  const windows = process.platform === "win32";
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
    preloadPath: path.join(electronRoot, "plugin-host", "preload.cjs"),
    platform: process.platform,
    devTools: false,
    launchRefusal: launchSandboxRefusal({
      argv: process.argv,
      hasSwitch: (name) => app.commandLine.hasSwitch(name),
      env: process.env,
      platform: process.platform,
      inspectorActive: require("node:inspector").url() !== undefined,
    }),
  });
  if (runtime.unavailableReason() !== undefined)
    throw new Error(`Plugins are off: ${runtime.unavailableReason()}`);

  // Outside Ajour's folders: the tools, the repositories, the markers and
  // the plugin's package, which the check rewrites.
  const work = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajour-process-attacks-"),
  );
  const markers = path.join(work, "markers");
  const repos = path.join(work, "repos");
  const pluginDirectory = path.join(work, "plugins", PLUGIN);
  await fs.mkdir(markers, { recursive: true });
  for (const name of ["alpha", "beta", "turncoat"])
    await fs.mkdir(path.join(repos, name), { recursive: true });
  await fs.cp(FIXTURE, pluginDirectory, { recursive: true });
  const bin = path.join(work, "bin");
  const echo = await writeFakeTool(bin, "ajour-check-echo", ECHO, {
    node: process.env.AJOUR_CHECK_NODE,
  });
  // A launcher no install writes: cmd.exe would run its first line.
  const unknownShim = path.join(bin, "ajour-check-unknown.cmd");
  if (windows)
    await fs.writeFile(
      unknownShim,
      `@ECHO off\r\necho pwned > "${path.join(markers, "unknown-shim")}"\r\nnode "%~dp0\\ajour-check-echo.cjs" %*\r\n`,
    );

  const api = await import(pathToFileURL(path.join(apiRoot, "server.ts")).href);
  const { MemorySecretVault } = await import(
    pathToFileURL(path.join(apiRoot, "test-support/memory-secret-vault.ts"))
      .href
  );
  const { dispatchJsonRequest } = await import(
    pathToFileURL(path.join(apiRoot, "test-support/dispatch-json-request.ts"))
      .href
  );
  const { windowServerOptions } = await import(
    pathToFileURL(path.join(apiRoot, "test-support/window-token.ts")).href
  );
  const { createRecordingSink } = await import(
    pathToFileURL(
      path.resolve(__dirname, "../../../packages/wide-events/sinks.ts"),
    ).href
  );
  const sink = createRecordingSink();
  const network = createBrokerNetwork({ net, session, randomUUID });
  /** The links main would have opened, through its own check. */
  const opened = [];
  const server = api.createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(userData, "app-api-state.json"),
    vault: new MemorySecretVault(),
    brokerTransport: network.transport,
    brokerResolver: network.resolver,
    installedPluginDirectory: path.join(userData, "plugins"),
    developmentPluginDirectories: [pluginDirectory],
    allowDevelopmentPlugins: true,
    pluginRuntime: runtime,
    eventSink: sink,
    // Ajour's own folders, as main lists them.
    protectedRepositoryFolders: protectedRepositoryFolders({
      platform: process.platform,
      packaged: false,
      userData,
      exe: app.getPath("exe"),
      resources: process.resourcesPath,
      runtimeRoot: path.resolve(__dirname, "../../.."),
      home: os.homedir(),
      env: process.env,
    }),
    openExternal: (url, declaredSchemes) =>
      openPluginLink(url, declaredSchemes, async (href) => {
        opened.push(href);
      }),
  });
  const request = (method, url, body) =>
    dispatchJsonRequest(server, {
      method,
      path: url,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const ok = async (method, url, body) => {
    const answer = await request(method, url, body);
    if (answer.status !== 200)
      throw new Error(
        `${method} ${url} answered ${answer.status}: ${JSON.stringify(answer.body)}`,
      );
    return answer.body;
  };
  report("start", { pid: process.pid, platform: process.platform });

  // Repository folders: two of the hand off's project, one of another. The
  // chooser refuses Ajour's data folder; the second of the project's own
  // becomes a junction to it after it is added, which the broker must see
  // at use.
  const alpha = await api.addRepositoryFolderForServer(
    server,
    "project-alpha",
    path.join(repos, "alpha"),
  );
  const turncoat = await api.addRepositoryFolderForServer(
    server,
    "project-alpha",
    path.join(repos, "turncoat"),
  );
  const beta = await api.addRepositoryFolderForServer(
    server,
    "project-beta",
    path.join(repos, "beta"),
  );
  let dataFolderAdd = "added";
  try {
    await api.addRepositoryFolderForServer(server, "project-alpha", userData);
  } catch (error) {
    dataFolderAdd = String(error.message);
  }
  await fs.rm(path.join(repos, "turncoat"), { recursive: true });
  await fs.symlink(
    userData,
    path.join(repos, "turncoat"),
    windows ? "junction" : "dir",
  );

  await ok("POST", `/api/plugins/${PLUGIN}/activation`, { enabled: true });
  await ok("POST", `/api/plugins/${PLUGIN}/processes`, {
    executable: "echo",
    path: echo,
  });
  if (windows)
    await ok("POST", `/api/plugins/${PLUGIN}/processes`, {
      executable: "unknown",
      path: unknownShim,
    });

  // Every tool starts off (#760).
  await ok("POST", `/api/plugins/${PLUGIN}/handoffs/tools`, {
    toolId: "probe",
    enabled: true,
  });

  let item = 0;
  /** One phase of the plugin's attacks, run as a hand off of project alpha. */
  const phase = async (name, params = {}) => {
    item += 1;
    const answer = await request("POST", "/api/handoffs", {
      pluginId: PLUGIN,
      toolId: "probe",
      workItemId: `item-${item}`,
      projectId: "project-alpha",
      folderId: alpha.id,
      projectName: "Alpha",
      item: {
        key: `ESC-${item}`,
        title: "Escape",
        type: "Task",
        url: `https://example.test/ESC-${item}`,
      },
      settings: {},
      promptOverride: JSON.stringify({ phase: name, ...params }),
    });
    return {
      status: answer.status,
      error: answer.body?.error ?? null,
      attempts: Object.fromEntries(answer.body?.native?.attempts ?? []),
    };
  };
  const accept = async () => {
    const overview = await ok("GET", "/api/plugins");
    const gate = overview.connectionGroups.find(
      (group) => group.plugin.id === PLUGIN,
    )?.processGate;
    await ok("POST", `/api/plugins/${PLUGIN}/process-acceptance`, {
      packageKey: gate?.packageKey,
      accepted: true,
    });
    return gate?.packageKey;
  };

  // 1. The gates, in order, as an unsigned plugin meets them.
  const switchOff = await phase("probe");
  await ok("POST", "/api/plugins/unsigned-processes", { enabled: true });
  const acceptanceMissing = await phase("probe");
  const firstKey = await accept();
  const flagOff = await phase("probe");
  // The package now asks for undeclared commands, with no new consent.
  const manifestPath = path.join(pluginDirectory, "plugin.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.processes.undeclaredCommands = true;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  // The broker emits one plugin.process event per call, as it ends.
  const processCalls = () =>
    sink.events.filter((event) => event.name === "plugin.process").length;
  const callsBefore = processCalls();
  const widenedWithoutConsent = await phase("probe");
  widenedWithoutConsent.processCalls = processCalls() - callsBefore;
  await ok("POST", `/api/plugins/${PLUGIN}/activation`, { enabled: true });
  const secondKey = await accept();
  report("process-gates", {
    switchOff,
    acceptanceMissing,
    flagOff,
    widenedWithoutConsent,
    packageKeyChanged: Boolean(firstKey && secondKey && firstKey !== secondKey),
  });

  // 2. The attacks, with every gate open.
  const values = injectionValues(markers);
  const inject = await phase("inject", { values, windows });
  const reach = await phase("reach", {
    folders: {
      own: alpha.id,
      otherProject: beta.id,
      dataJunction: turncoat.id,
      path: userData,
    },
  });
  const unicode = await phase("unicode");
  const modeBefore = (await ok("GET", `/api/plugins/${PLUGIN}/command-access`))
    .mode;
  const askAlways = await phase("ask", {
    marker: path.join(markers, "inline-always-ask"),
  });

  // 3. Auto, with a window that denies inline code and never answers the
  //    command no rule names: it closes instead.
  await ok("POST", `/api/plugins/${PLUGIN}/command-access`, { mode: "auto" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const stream = new AbortController();
  const bridge = await fetch(
    `http://127.0.0.1:${server.address().port}/api/process/bridge`,
    {
      headers: {
        origin: "app://local",
        "x-ajour-window-token": "test-window-token",
      },
      signal: stream.signal,
    },
  );
  if (!bridge.ok) throw new Error(`Command stream refused: ${bridge.status}`);
  const asks = [];
  const consume = (async () => {
    let pending = "";
    for await (const chunk of bridge.body) {
      pending += new TextDecoder().decode(chunk);
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const message = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = message
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!data) continue;
        const ask = JSON.parse(data.slice(6));
        if (!ask?.id) continue;
        asks.push({
          executable: ask.executable,
          argv: ask.argv,
          risky: ask.risky,
          reason: ask.reason ?? null,
          signed: ask.signed,
        });
        if (ask.argv[0] === "-e")
          await request("POST", "/api/process/answer", {
            id: ask.id,
            answer: "deny",
          });
        // No answer: the window goes away.
        else {
          stream.abort();
          server.closeAllConnections();
        }
      }
    }
  })().catch((error) => {
    if (error.name !== "AbortError") report("error", { error: String(error) });
  });
  const askAuto = await phase("ask", {
    marker: path.join(markers, "inline-auto"),
  });
  stream.abort();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await consume;

  report("process-attacks", {
    values,
    inject,
    reach,
    ownFolder: await fs.realpath(path.join(repos, "alpha")),
    dataFolderAdd,
    unicode,
    modeBefore,
    askAlways,
    askAuto,
    asks,
    opened,
    markers: await fs.readdir(markers),
    windows,
    // ADR 0011: events hold ids and outcomes, never argv, values or paths.
    // Compared value by value, since JSON escapes the `\` and `"` in these.
    eventsHoldValues: values.some((value) => eventsHold(sink.events, value)),
    eventsHoldCanary: eventsHold(sink.events, canary),
    processEvents: sink.events.filter(
      (event) => event.name === "plugin.process",
    ).length,
  });

  const rendererPids = Object.values(runtime.rendererProcessIds());
  const appPids = app.getAppMetrics().map((metric) => metric.pid);
  await api.stopAppApiServer(server).catch(() => undefined);
  await runtime.closeAll();
  report("quitting", {
    appPids,
    rendererPids,
    pluginPagesLeft: webContents
      .getAllWebContents()
      .filter((contents) => contents.getURL().startsWith(`${PLUGIN_SCHEME}:`))
      .length,
  });
  // The junction goes first, on its own, so removing the work folder never
  // reaches through it into Ajour's data folder.
  const link = path.join(repos, "turncoat");
  await fs
    .rmdir(link)
    .catch(() => fs.unlink(link))
    .catch(() => undefined);
  if (
    !(await fs.lstat(link).then(
      () => true,
      () => false,
    ))
  )
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  clearTimeout(watchdog);
  app.quit();
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    report("error", { error: String(error?.stack ?? error) });
    app.exit(2);
  });
