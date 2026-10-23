import { parentPort, workerData } from "node:worker_threads";
import { serialize } from "node:v8";

const MAX_PLUGIN_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_ERROR_MESSAGE_CHARACTERS = 4_096;

// Keep in sync with `codeHostOperations` in packages/shared/code-host.ts.
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

// Keep in sync with `calendarOperations` in packages/shared/calendar.ts.
const CALENDAR_METHODS = new Set(["listCalendarEvents"]);

// Keep in sync with `backlogCommentOperations` in packages/shared/backlog-comments.ts.
const BACKLOG_COMMENT_METHODS = new Set([
  "listItemComments",
  "postItemComment",
  "editItemComment",
  "deleteItemComment",
  "setItemCommentReaction",
  "searchItemPeople",
]);

// Keep in sync with `teamPluginMethods` in packages/shared/team-sync.ts.
const TEAM_CONNECTION_METHODS = new Set(["syncTeamProjects"]);

if (!parentPort) {
  throw new Error("Plugin worker requires a parent port.");
}

async function run() {
  const pluginModule = await import(workerData.entrypointUrl);
  const handler = pluginModule[workerData.method];
  if (typeof handler !== "function") {
    throw new Error(`Plugin does not export ${workerData.method}().`);
  }

  if (workerData.method === "validateConnection") {
    return await handler(workerData.params.config, workerData.params.context);
  }

  if (workerData.method === "createTeam") {
    return await handler(workerData.params.config, workerData.params.request);
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
    workerData.method === "readDescription" ||
    workerData.method === "writeDescription" ||
    CODE_HOST_METHODS.has(workerData.method) ||
    CALENDAR_METHODS.has(workerData.method) ||
    BACKLOG_COMMENT_METHODS.has(workerData.method) ||
    TEAM_CONNECTION_METHODS.has(workerData.method)
  ) {
    return await handler(
      workerData.params.connection,
      workerData.params.request,
    );
  }

  throw new Error(`Unknown plugin method: ${workerData.method}`);
}

function errorMessage(error) {
  const message =
    error instanceof Error ? error.message : "Unknown plugin error.";
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
          error: "Plugin result exceeds the allowed size.",
          reason: "result_too_large",
          bytes,
        }
      : { ok: true, result, bytes };
} catch (error) {
  outcome = { ok: false, error: errorMessage(error) };
}
parentPort.postMessage(outcome);
