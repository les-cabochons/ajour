// PROTOTYPE (#230, #260). Throwaway, never merged.
// The host loop. The page has one function, `invoke`. Each invoke carries the
// previous answer and its reply carries the next call, so main drives every
// call through `ipcMain.handle` and times the round trip itself.
import * as plugin from "./plugin.js";

const { invoke } = window.ajourHost;

let message = {
  type: "ready",
  selfCheck: {
    origin: location.origin,
    require: typeof require,
    process: typeof process,
    bridgeKeys: Object.keys(window.ajourHost),
  },
};

for (;;) {
  const call = await invoke(message);
  if (!call) break;
  try {
    if (!Object.hasOwn(plugin, call.method)) throw new Error("Unknown method.");
    const value = await plugin[call.method](...call.args);
    message = { type: "result", callId: call.callId, ok: true, value };
  } catch (error) {
    message = {
      type: "result",
      callId: call.callId,
      ok: false,
      error: String(error),
    };
  }
}
