// Ajour's script in a plugin's hidden page (#390, decided in #231). The
// plugin's code never runs here: each operation runs in a dedicated worker
// of its own, started from Ajour's bootstrap, with no DOM. This script asks
// Ajour's main process for its next command through the one function the
// preload gives it, and relays each worker's calls to the broker. Which run
// a call belongs to comes from the worker that sent it, never from what the
// worker says.
const { invoke } = window.ajourPlugin;

/** The worker of each run, by its id. */
const workers = new Map();

/** The calls a worker may make, with the message main receives for each. */
const RELAYED = new Set(["http", "publicFetch", "abort", "blocked"]);

function stop(runId) {
  const worker = workers.get(runId);
  if (!worker) return;
  workers.delete(runId);
  worker.terminate();
}

function settle(runId, outcome) {
  if (!workers.has(runId)) return;
  stop(runId);
  invoke({ type: "settled", runId, outcome }).catch(() => undefined);
}

function start({ runId, url, method, args }) {
  const worker = new Worker("/.ajour/worker.js", { type: "module" });
  workers.set(runId, worker);
  worker.onmessage = ({ data }) => {
    if (typeof data !== "object" || data === null) return;
    if (data.type === "settled") {
      settle(runId, data.outcome);
      return;
    }
    if (!RELAYED.has(data.type)) return;
    const call = invoke({ ...data, runId }).then(
      (answer) => answer,
      () => ({
        ok: false,
        error: {
          name: "AjourRequestError",
          code: "network",
          message: "Ajour couldn't send the request.",
        },
      }),
    );
    if (data.type === "http" || data.type === "publicFetch") {
      void call.then((answer) => {
        if (workers.get(runId) === worker) {
          worker.postMessage({ type: "answer", callId: data.callId, answer });
        }
      });
    }
  };
  // Code that fails to load, or throws outside a call, ends the run.
  worker.onerror = (event) => {
    event.preventDefault();
    settle(runId, {
      ok: false,
      failure: "plugin_error",
      ...(typeof event.message === "string" && event.message
        ? { message: event.message }
        : {}),
    });
  };
  worker.onmessageerror = () => {
    settle(runId, {
      ok: false,
      failure: "plugin_error",
      message: "The plugin sent a message Ajour can't read.",
    });
  };
  worker.postMessage({ type: "start", url, method, args });
}

await invoke({ type: "ready" });
for (;;) {
  const command = await invoke({ type: "next" });
  if (command?.type === "start") start(command);
  else if (command?.type === "stop") stop(command.runId);
}
