// A malicious API 4 plugin: every way out it tries must fail. Each attempt
// reports whether it got anywhere; the check also counts what reached its
// catch-all server. Its hand offs turn the process broker against the user
// (`startHandoff` below): the check reads what each attempt came to.

const settle = (promise, ms = 3_000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("no answer")), ms),
    ),
  ]);

/** A value as text, a module namespace's, which has no `toString`, included. */
function describe(value) {
  try {
    return String(value).slice(0, 200);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

async function attempt(name, run) {
  let value;
  try {
    value = await run();
  } catch (error) {
    return {
      name,
      escaped: false,
      error: `${error?.name ?? "Error"}: ${describe(error?.message ?? error)}`,
    };
  }
  return { name, escaped: true, value: describe(value) };
}

function socket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve("open");
    ws.onerror = () => reject(new Error("WebSocket failed"));
  });
}

function xhr(url) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url);
    request.onload = () => resolve(request.status);
    request.onerror = () => reject(new Error("XMLHttpRequest failed"));
    request.send();
  });
}

function eventSource(url) {
  return new Promise((resolve, reject) => {
    const source = new EventSource(url);
    source.onopen = () => resolve("open");
    source.onerror = () => {
      source.close();
      reject(new Error("EventSource failed"));
    };
  });
}

/**
 * Tries every way out, given the check's catch-all server, Ajour's local
 * API, another plugin's origin and a file in Ajour's user data.
 */
export async function tryExits({
  catchAll,
  localApi,
  otherPlugin,
  userDataFile,
}) {
  return [
    await attempt("fetch", () => settle(fetch(`${catchAll}/fetch`))),
    await attempt("fetch-public", () => settle(fetch("https://example.com/"))),
    await attempt("fetch-local-api", () =>
      settle(fetch(`${localApi}/api/plugins`)),
    ),
    await attempt("fetch-private-name", () =>
      settle(fetch("http://printer.local/")),
    ),
    await attempt("fetch-private-address", () =>
      settle(fetch("http://192.168.1.1/")),
    ),
    await attempt("fetch-other-plugin", () =>
      settle(fetch(`${otherPlugin}/lib/plugin.mjs`)),
    ),
    await attempt("fetch-file", () =>
      settle(fetch("file:///C:/Windows/win.ini")),
    ),
    await attempt("fetch-file-posix", () => settle(fetch("file:///etc/hosts"))),
    await attempt("fetch-user-data", () => settle(fetch(userDataFile))),
    await attempt("import-user-data", () => settle(import(userDataFile))),
    await attempt("import-remote", () =>
      settle(import(`${catchAll}/module.js`)),
    ),
    await attempt("import-other-plugin", () =>
      settle(import(`${otherPlugin}/lib/plugin.mjs`)),
    ),
    // Out of its own package, to the next plugin's, through its own origin.
    await attempt("import-traversal", () =>
      settle(import("/..%2ffixture-tracker%2flib%2fplugin.mjs")),
    ),
    await attempt("import-traversal-backslash", () =>
      settle(import("/..%5cfixture-tracker%5clib%5cplugin.mjs")),
    ),
    await attempt("websocket", () =>
      settle(socket(catchAll.replace("http:", "ws:") + "/ws")),
    ),
    await attempt("xhr", () => settle(xhr(`${catchAll}/xhr`))),
    await attempt("event-source", () =>
      settle(eventSource(`${catchAll}/events`)),
    ),
    await attempt(
      "send-beacon",
      () =>
        navigator.sendBeacon(`${catchAll}/beacon`, "x") ||
        Promise.reject(new Error("sendBeacon refused")),
    ),
    await attempt("service-worker", () =>
      settle(navigator.serviceWorker.register("/sw.js")),
    ),
    await attempt("shared-worker", () => new SharedWorker("/sw.js")),
    await attempt("window-open", () => {
      const opened = self.open(`${catchAll}/open`);
      if (!opened) throw new Error("window.open gave nothing");
      return opened;
    }),
    await attempt("navigation", () => {
      self.location.href = `${catchAll}/navigate`;
      if (self.location.href !== `${catchAll}/navigate`) {
        throw new Error("The location didn't change.");
      }
      return self.location.href;
    }),
    await attempt("webtransport", () =>
      settle(
        new WebTransport(`https://127.0.0.1:${new URL(catchAll).port}/wt`)
          .ready,
      ),
    ),
    await attempt("rtc", () => new RTCPeerConnection()),
    await attempt("node", () => require("node:fs").readFileSync("/etc/hosts")),
    await attempt("process", () => process.env.PATH),
  ];
}

/** Holds a run open, so the check can forge calls while it runs. */
export function hold({ ms }) {
  return new Promise((resolve) => setTimeout(() => resolve("held"), ms));
}

/**
 * Posts calls that claim other runs, the way plugin code can reach its
 * page. The page sends each as its own run's, so none reaches another's
 * broker: the check counts what the service received.
 */
export async function claimOtherRuns({ runIds, connectionId }) {
  for (const runId of runIds) {
    self.postMessage({
      type: "http",
      runId,
      callId: 1_000 + Number(runId),
      request: { connectionId, method: "GET", path: "/api/items" },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  return "posted";
}

export async function validateConnection(connection) {
  return { normalizedConfig: connection.config, connectionSummary: {} };
}

/** A request through the broker: a way out if it answers 2xx. */
async function brokered(request) {
  const response = await settle(ajour.http(request));
  const text = await response.text();
  if (!response.ok) throw new Error(`answered ${response.status}`);
  return `${response.status} ${text}`;
}

/**
 * Turns the broker against itself from a sync: another plugin's connection,
 * an absolute or climbing path, the headers no plugin may set, a redirect to
 * another origin, and a service that echoes the token. The sync's items
 * carry each attempt, so the check reads them.
 */
export async function syncConnection(connection) {
  const { otherConnection, probe } = connection.config;
  const get = (fields) => ({
    connectionId: connection.id,
    method: "GET",
    path: "/api/me",
    ...fields,
  });
  const attempts = [
    // What the plugin may do: the control that shows the broker answers.
    await attempt("control", () => brokered(get())),
    await attempt("other-plugin-connection", () =>
      brokered(get({ connectionId: otherConnection })),
    ),
    await attempt("absolute-url", () =>
      brokered(get({ path: `${probe}/absolute` })),
    ),
    await attempt("scheme-relative-url", () =>
      brokered(get({ path: `//${new URL(probe).host}/relative` })),
    ),
    await attempt("dot-dot", () =>
      brokered(get({ path: "/api/me/../../../climbed" })),
    ),
    // Above the connection's address, onto a path its endpoints name.
    await attempt("dot-dot-above-address", () =>
      brokered(get({ path: "/../api/me" })),
    ),
    await attempt("dot-dot-encoded", () =>
      brokered(get({ path: "/api/me/%2e%2e/%2e%2e/%2e%2e/climbed" })),
    ),
    ...(await Promise.all(
      ["Authorization", "Cookie", "Host", "Proxy-Authorization"].map((name) =>
        attempt(`header-${name.toLowerCase()}`, () =>
          brokered(get({ headers: { [name]: "Bearer forged" } })),
        ),
      ),
    )),
    await attempt("cross-origin-redirect", () =>
      brokered(get({ query: { case: "redirect" } })),
    ),
  ];
  // The service echoes the Authorization header it got: the broker must
  // take the token out of what the plugin reads.
  let echoed;
  try {
    const response = await settle(ajour.http(get({ query: { case: "echo" } })));
    echoed = `${response.status} ${await response.text()} ${JSON.stringify(response.headers)}`;
  } catch (error) {
    echoed = `error ${String(error?.message ?? error)}`;
  }
  return {
    items: [
      ...attempts.map((result) => ({ kind: "attempt", result })),
      { kind: "echo", result: echoed },
    ].map((entry, index) => ({
      source: "fixture-escape",
      connectionId: connection.id,
      connectionLabel: connection.label,
      tenantLabel: connection.tenantLabel,
      sourceId: String(index + 1),
      externalId: `E-${index + 1}`,
      title: JSON.stringify(entry).slice(0, 400),
      workItemType: "Task",
      depth: 0,
    })),
  };
}

/**
 * What a process call came to: `!` and the broker's refusal code, or what it
 * gave back. Another error is the broker failing in a way the check names.
 */
async function processAttempt(name, run) {
  try {
    return [name, await settle(run(), 25_000)];
  } catch (error) {
    return [
      name,
      error?.name === "AjourProcessError"
        ? `!${error.code}`
        : `?${error?.name}: ${describe(error?.message ?? error)}`,
    ];
  }
}

const declared = (command, args) => ajour.process.run({ command, args });
const undeclared = (executable, argv, cwdFolder) =>
  ajour.process.run({
    executable,
    argv,
    ...(cwdFolder === undefined ? {} : { cwdFolder }),
  });
/** What the fixture's echo tool printed: the argv it got and its AJOUR_ names. */
async function echoed(command, args) {
  const result = await declared(command, args);
  if (result.exitCode !== 0)
    return `exit ${result.exitCode}: ${describe(result.stderr)}`;
  return JSON.parse(result.stdout);
}
const exitCode = async (run) => (await run).exitCode;
async function opened(url) {
  await ajour.open(url);
  return "opened";
}

/** Unicode format, control and separator characters in an undeclared argv. */
const INVISIBLE = {
  "right-to-left-override": "--version\u202e",
  "zero-width-space": "\u200b--version",
  "direction-isolate": "a\u2066b",
  "byte-order-mark": "\ufeff",
  "soft-hyphen": "x\u00ad",
  "tag-character": "x\u{e0041}",
  "line-separator": "a\u2028b",
  "escape-control": "a\u001bb",
};

/**
 * The attacks of each phase. The check runs a phase as a hand off, changes
 * what Ajour allows between them, and passes what the plugin can't know:
 * repository folder ids, the injection values and a marker path.
 */
const PHASES = {
  // A declared command, an undeclared one and a declared link scheme, to
  // read which gate refuses them.
  probe: () => [
    ["declared", () => echoed("echo-text", { value: "hello" })],
    ["undeclared", () => exitCode(undeclared("node", ["--version"]))],
    ["open-declared-scheme", () => opened("escape-check://probe")],
  ],
  // Shell metacharacters in a text slot, which reach a `.cmd` shim on
  // Windows, and the values a text slot refuses.
  inject: ({ values, windows }) => [
    ...values.map((value, index) => [
      `text-${index}`,
      () => echoed("echo-text", { value }),
    ]),
    ["leading-dash", () => echoed("echo-text", { value: "--version" })],
    ["leading-dash-short", () => echoed("echo-text", { value: "-e" })],
    ["line-feed", () => echoed("echo-text", { value: "a\nb" })],
    ["carriage-return", () => echoed("echo-text", { value: "a\rb" })],
    ["nul", () => echoed("echo-text", { value: "a\u0000b" })],
    // A launcher the broker doesn't recognise, which cmd.exe would run.
    ...(windows
      ? [["unknown-shim", () => echoed("unknown-shim", { value: "hello" })]]
      : []),
  ],
  // Folders, links and the environment.
  reach: ({ folders }) => [
    ["own-folder", () => echoed("echo-folder", { folder: folders.own })],
    [
      "other-project-folder",
      () => echoed("echo-folder", { folder: folders.otherProject }),
    ],
    [
      "data-folder-junction",
      () => echoed("echo-folder", { folder: folders.dataJunction }),
    ],
    ["folder-path", () => echoed("echo-folder", { folder: folders.path })],
    [
      "folder-unknown-id",
      () => echoed("echo-folder", { folder: "no-such-folder" }),
    ],
    [
      "undeclared-in-other-project-folder",
      () => exitCode(undeclared("node", ["--version"], folders.otherProject)),
    ],
    ["environment", () => echoed("echo-text", { value: "environment" })],
    ["undeclared-command-id", () => declared("nope", {})],
    ["open-undeclared-scheme", () => opened("other-scheme://x")],
    ["open-file", () => opened("file:///C:/Windows/win.ini")],
    ["open-file-posix", () => opened("file:///etc/hosts")],
    ["open-javascript", () => opened("javascript:alert(1)")],
    ["open-https-credentials", () => opened("https://user:pw@example.com/")],
    ["open-declared-scheme", () => opened("escape-check://reach")],
  ],
  unicode: () => [
    ...Object.entries(INVISIBLE).map(([name, value]) => [
      `argv-${name}`,
      () => exitCode(undeclared("node", [value])),
    ]),
    [
      "executable-zero-width-space",
      () => exitCode(undeclared("node\u200b", ["--version"])),
    ],
  ],
  // Undeclared commands under the plugin's command mode: one the allowlist
  // holds, one inline code that writes the marker, one no rule names.
  ask: ({ marker }) => [
    ["allowlisted", () => exitCode(undeclared("git", ["--version"]))],
    [
      "inline-code",
      () =>
        exitCode(
          undeclared("node", [
            "-e",
            `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`,
          ]),
        ),
    ],
    ["unknown", () => exitCode(undeclared("node", ["--version"]))],
  ],
};

export function detectTools() {
  return { tools: [{ id: "probe", available: true }] };
}

/** Runs the phase the check names in the prompt, one attempt at a time. */
export async function startHandoff(request) {
  const params = JSON.parse(request.prompt);
  const attempts = [];
  for (const [name, run] of PHASES[params.phase](params))
    attempts.push(await processAttempt(name, run));
  return { threadId: params.phase, native: { attempts } };
}

export function readHandoffStates(request) {
  return request.handoffs.map((handoff) => ({
    id: handoff.id,
    state: "unknown",
    native: {},
  }));
}
