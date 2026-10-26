import { parentPort, workerData } from "node:worker_threads";
import { serialize } from "node:v8";

// The worker runtime (plugin-worker-runtime.ts) sends the export to call and
// its arguments, already in order: this script knows no method names. The
// table that orders them is apps/api/src/plugin-methods.ts.

if (!parentPort) {
  throw new Error("Plugin worker requires a parent port.");
}

const { entrypointUrl, method, args, maxResultBytes, maxErrorCharacters } =
  workerData;

function errorMessage(error) {
  if (!(error instanceof Error)) return undefined;
  const message = error.message;
  if (message.length <= maxErrorCharacters) {
    return message;
  }
  return `${message.slice(0, maxErrorCharacters - 1)}…`;
}

// A status the error names, so the host can tell a rejected secret (401).
// This mirrors httpStatusOf in plugin-runtime.ts.
function httpStatus(error) {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["httpStatus", "statusCode", "status"]) {
    const value = error[key];
    if (Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return undefined;
}

// The host learns the result's size, and tells a result that's too large
// from the plugin's own error.
let outcome;
try {
  const pluginModule = await import(entrypointUrl);
  const handler = pluginModule[method];
  if (typeof handler !== "function") {
    outcome = { ok: false, reason: "missing_export" };
  } else {
    const result = await handler(...args);
    const bytes = serialize(result).byteLength;
    outcome =
      bytes > maxResultBytes
        ? { ok: false, reason: "result_too_large", bytes }
        : { ok: true, result, bytes };
  }
} catch (error) {
  outcome = {
    ok: false,
    error: errorMessage(error),
    httpStatus: httpStatus(error),
  };
}
parentPort.postMessage(outcome);
