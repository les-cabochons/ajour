import { backlogCommentOperations } from "../../../packages/shared/backlog-comments.ts";
import type { BacklogCommentOperation } from "../../../packages/shared/backlog-comments.ts";
import { calendarOperations } from "../../../packages/shared/calendar.ts";
import type { CalendarOperation } from "../../../packages/shared/calendar.ts";
import { codeHostOperations } from "../../../packages/shared/code-host.ts";
import type { CodeHostOperation } from "../../../packages/shared/code-host.ts";
import type { TeamPluginMethod } from "../../../packages/shared/team-sync.ts";

/** Every plugin method the plugin host calls. */
export type PluginMethod =
  | "validateConnection"
  | "syncConnection"
  | "listSettleStates"
  | "writeSettle"
  | "readDescription"
  | "writeDescription"
  | CodeHostOperation
  | CalendarOperation
  | BacklogCommentOperation
  | TeamPluginMethod;

/** Every data-shape method the data-shape host calls. */
export type ProjectDataShapeMethod = "exportProjects" | "importProjects";

/** The names of the host's parameters each export receives, in order. */
type ArgumentNames = readonly string[];

const CONNECTION_AND_REQUEST = ["connection", "request"] as const;

/** Each operation of a shared contract receives the connection, then its request. */
function connectionOperations<Operation extends string>(contract: {
  [Key in Operation]: unknown;
}) {
  return Object.fromEntries(
    Object.keys(contract).map((operation) => [
      operation,
      CONNECTION_AND_REQUEST,
    ]),
  ) as Record<Operation, typeof CONNECTION_AND_REQUEST>;
}

/**
 * How the host calls each plugin export. A runtime calls
 * `module[method](...args)` and knows no method names, so this table is the
 * only one. The contracts' operations come straight from packages/shared.
 */
const PLUGIN_METHOD_ARGUMENTS: Record<PluginMethod, ArgumentNames> = {
  validateConnection: ["config", "context"],
  syncConnection: ["connection", "workItems", "syncOptions"],
  listSettleStates: CONNECTION_AND_REQUEST,
  writeSettle: CONNECTION_AND_REQUEST,
  readDescription: CONNECTION_AND_REQUEST,
  writeDescription: CONNECTION_AND_REQUEST,
  ...connectionOperations(codeHostOperations),
  ...connectionOperations(calendarOperations),
  ...connectionOperations(backlogCommentOperations),
  // `createTeam` runs before the connection is saved, on the form's values.
  createTeam: ["config", "request"],
  syncTeamProjects: CONNECTION_AND_REQUEST,
};

const PROJECT_DATA_SHAPE_METHOD_ARGUMENTS: Record<
  ProjectDataShapeMethod,
  ArgumentNames
> = {
  exportProjects: ["projects"],
  importProjects: ["sheets"],
};

function argumentsOf(
  table: Record<string, ArgumentNames>,
  label: string,
  method: string,
  params: Record<string, unknown>,
): unknown[] {
  if (!Object.hasOwn(table, method)) {
    throw new Error(`Unknown ${label} method: ${method}`);
  }
  return table[method]!.map((name) => params[name]);
}

/**
 * Where plugin API 4 differs: `validateConnection` receives the connection,
 * without its secrets, so its requests can name it to the broker.
 */
const PLUGIN_API_4_METHOD_ARGUMENTS: Record<PluginMethod, ArgumentNames> = {
  ...PLUGIN_METHOD_ARGUMENTS,
  validateConnection: ["connection", "context"],
};

/** The arguments a plugin export receives from the host's named parameters. */
export function pluginMethodArguments(
  method: PluginMethod,
  params: Record<string, unknown>,
  apiVersion = 3,
): unknown[] {
  return argumentsOf(
    apiVersion === 4 ? PLUGIN_API_4_METHOD_ARGUMENTS : PLUGIN_METHOD_ARGUMENTS,
    "plugin",
    method,
    params,
  );
}

/** The arguments a data-shape export receives from the host's named parameters. */
export function projectDataShapeMethodArguments(
  method: ProjectDataShapeMethod,
  params: Record<string, unknown>,
): unknown[] {
  return argumentsOf(
    PROJECT_DATA_SHAPE_METHOD_ARGUMENTS,
    "schema plugin",
    method,
    params,
  );
}
