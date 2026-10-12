import { parentPort, workerData } from "node:worker_threads";
import { serialize } from "node:v8";

const MAX_CONNECTOR_PLUGIN_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_CONNECTOR_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;

// Keep in sync with `codeHostOperations` in packages/shared/src/code-host.ts.
const CODE_HOST_METHODS = new Set([
  "syncPullRequests",
  "getPullRequestContent",
  "getFileContent",
  "getPullRequestConversation",
  "browsePullRequests",
  "submitReview",
  "postComment",
  "replyToThread",
  "setThreadResolved",
  "setFileViewed",
  "updatePullRequest",
  "mergePullRequest",
]);

if (!parentPort) {
  throw new Error("Connector plugin worker requires a parent port.");
}

async function run() {
  const pluginModule = await import(workerData.entrypointUrl);
  const handler = pluginModule[workerData.method];
  if (typeof handler !== "function") {
    throw new Error(`Connector plugin does not export ${workerData.method}().`);
  }

  if (workerData.method === "validateConnection") {
    return await handler(workerData.params.config);
  }

  if (workerData.method === "syncConnection") {
    return await handler(
      workerData.params.connection,
      workerData.params.workItems,
    );
  }

  if (
    workerData.method === "listSettleStates" ||
    workerData.method === "writeSettle" ||
    CODE_HOST_METHODS.has(workerData.method)
  ) {
    return await handler(
      workerData.params.connection,
      workerData.params.request,
    );
  }

  throw new Error(`Unknown connector plugin method: ${workerData.method}`);
}

function errorMessage(error) {
  const message =
    error instanceof Error ? error.message : "Unknown connector plugin error.";
  if (message.length <= MAX_CONNECTOR_PLUGIN_ERROR_MESSAGE_CHARACTERS) {
    return message;
  }
  return `${message.slice(0, MAX_CONNECTOR_PLUGIN_ERROR_MESSAGE_CHARACTERS - 1)}…`;
}

try {
  const result = await run();
  if (serialize(result).byteLength > MAX_CONNECTOR_PLUGIN_RESULT_BYTES) {
    throw new Error("Connector plugin result exceeds the allowed size.");
  }
  parentPort.postMessage({
    ok: true,
    result,
  });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: errorMessage(error),
  });
}
