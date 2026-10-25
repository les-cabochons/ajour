// Ajour's bootstrap for one plugin operation, in a dedicated worker of the
// plugin's hidden page (#390). It gives the plugin's code the `ajour` global
// of @ajour/plugin-sdk, imports the plugin's entrypoint, calls the export and
// posts how it settled. `ajour.http` and `ajour.publicFetch` are messages to
// the page, which relays them to Ajour's broker: the plugin's one way out.
// The worker's own fetch, WebSocket and XMLHttpRequest are refused by the
// policy every file here carries, and by the session if one got past it.

// Taken before the plugin's code loads, so code that replaces or wraps
// `self.postMessage` can't change what Ajour's bootstrap sends to the page.
const post = self.postMessage.bind(self);

/** The calls waiting for the broker's answer, by id. */
const waiting = new Map();
let nextCallId = 1;

function abortError() {
  return new DOMException("The request was aborted.", "AbortError");
}

function requestError(error) {
  if (error?.name === "AbortError") return abortError();
  const failure = new Error(
    typeof error?.message === "string" ? error.message : "The request failed.",
  );
  failure.name = "AjourRequestError";
  failure.code = typeof error?.code === "string" ? error.code : "network";
  return failure;
}

/** An answer as `ajour.http` gives it, as the SDK types it. */
function ajourResponse({ status, headers, body }) {
  const text = () => new TextDecoder().decode(body);
  return Object.freeze({
    status,
    ok: status >= 200 && status < 300,
    headers: Object.freeze({ ...headers }),
    text: async () => text(),
    json: async () => JSON.parse(text()),
  });
}

function call(type, payload, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  const callId = nextCallId++;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      waiting.delete(callId);
      post({ type: "abort", callId });
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    waiting.set(callId, (answer) => {
      signal?.removeEventListener("abort", onAbort);
      if (answer?.ok) resolve(ajourResponse(answer.response));
      else reject(requestError(answer?.error));
    });
    post({ type, callId, ...payload });
  });
}

function withoutSignal(value) {
  if (typeof value !== "object" || value === null) return value;
  const { signal: _signal, ...rest } = value;
  return rest;
}

Object.defineProperty(globalThis, "ajour", {
  value: Object.freeze({
    http: (request) =>
      call("http", { request: withoutSignal(request) }, request?.signal),
    publicFetch: (url, init) =>
      call("publicFetch", { url, init: withoutSignal(init) }, init?.signal),
    // Ajour's log for plugins comes later; a line goes nowhere for now.
    log: () => undefined,
  }),
  enumerable: true,
});

// A way out the policy refused, such as the plugin's own fetch, counts as a
// blocked attempt for the plugin's Access review. Only the directive is
// sent, never the address.
self.addEventListener("securitypolicyviolation", (event) => {
  post({
    type: "blocked",
    directive: String(event.effectiveDirective ?? ""),
  });
});

function statusOf(error) {
  for (const key of ["httpStatus", "statusCode", "status"]) {
    const value = error?.[key];
    if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return undefined;
}

function failure(error) {
  const status = statusOf(error);
  return {
    ok: false,
    failure: "plugin_error",
    ...(error instanceof Error ? { message: String(error.message) } : {}),
    ...(status === undefined ? {} : { httpStatus: status }),
  };
}

async function run({ url, method, args }) {
  let outcome;
  try {
    const pluginModule = await import(url);
    const handler = pluginModule[method];
    if (typeof handler !== "function") {
      outcome = { ok: false, failure: "missing_export" };
    } else {
      outcome = { ok: true, result: await handler(...args) };
    }
  } catch (error) {
    outcome = failure(error);
  }
  try {
    post({ type: "settled", outcome });
  } catch {
    post({
      type: "settled",
      outcome: {
        ok: false,
        failure: "plugin_error",
        message: "The plugin returned a value Ajour can't read.",
      },
    });
  }
}

let started = false;
self.onmessage = ({ data }) => {
  if (data?.type === "answer") {
    const answer = waiting.get(data.callId);
    waiting.delete(data.callId);
    answer?.(data.answer);
  } else if (data?.type === "start" && !started) {
    // One operation per worker: the page starts a new worker for the next.
    started = true;
    void run(data);
  }
};
