import { parentPort, workerData } from "node:worker_threads";
import { serialize } from "node:v8";

const MAX_PLUGIN_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;

if (!parentPort) {
  throw new Error("Schema plugin worker requires a parent port.");
}

async function run() {
  const pluginModule = await import(workerData.entrypointUrl);
  const handler = pluginModule[workerData.method];
  if (typeof handler !== "function") {
    throw new Error(`Schema plugin does not export ${workerData.method}().`);
  }

  if (workerData.method === "exportProjects") {
    return await handler(workerData.params.projects);
  }
  if (workerData.method === "importProjects") {
    return await handler(workerData.params.datasets);
  }

  throw new Error(`Unknown schema plugin method: ${workerData.method}`);
}

function errorMessage(error) {
  const message =
    error instanceof Error ? error.message : "Unknown schema plugin error.";
  if (message.length <= MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS) {
    return message;
  }
  return `${message.slice(0, MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS - 1)}…`;
}

// The host learns the result's size, and tells a result that's too large
// from the plugin's own error.
let outcome;
try {
  const result = await run();
  const bytes = serialize(result).byteLength;
  outcome =
    bytes > MAX_PLUGIN_RESULT_BYTES
      ? {
          ok: false,
          error: "Schema plugin result exceeds the allowed size.",
          reason: "result_too_large",
          bytes,
        }
      : { ok: true, result, bytes };
} catch (error) {
  outcome = { ok: false, error: errorMessage(error) };
}
parentPort.postMessage(outcome);
