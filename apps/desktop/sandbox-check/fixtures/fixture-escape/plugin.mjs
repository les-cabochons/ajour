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

/** Tries every way out, given the check's catch-all server and Ajour's local API. */
export async function tryExits({ catchAll, localApi, otherPlugin }) {
  return [
    await attempt("fetch", () => settle(fetch(`${catchAll}/fetch`))),
    await attempt("fetch-public", () => settle(fetch("https://example.com/"))),
    await attempt("fetch-local-api", () =>
      settle(fetch(`${localApi}/api/plugins`)),
    ),
    await attempt("fetch-other-plugin", () =>
      settle(fetch(`${otherPlugin}/lib/plugin.mjs`)),
    ),
    await attempt("fetch-file", () =>
      settle(fetch("file:///C:/Windows/win.ini")),
    ),
    await attempt("import-remote", () =>
      settle(import(`${catchAll}/module.js`)),
    ),
    await attempt("import-other-plugin", () =>
      settle(import(`${otherPlugin}/lib/plugin.mjs`)),
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
