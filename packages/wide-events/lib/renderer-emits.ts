import { catalog, type AjourCatalog } from "./ajour-catalog.ts";
import type { Kind } from "./envelope.ts";
import type { EventName, KindOf } from "./fields.ts";
import { MAIN_ONLY_KINDS } from "./forwarding.ts";
import { rendererEvents } from "./renderer-catalog.ts";

/**
 * The names a local API client call can take: the request event of the
 * route it calls, which allows the kind `command`, for a call a user or
 * agent action makes, or `job`, for a call only a job makes.
 */
export type ClientEventName = {
  [
    Name in EventName<AjourCatalog>
  ]: AjourCatalog["events"][Name]["fields"] extends {
    http: object;
  }
    ? [Extract<KindOf<AjourCatalog, Name>, "command" | "job">] extends [never]
      ? never
      : Name
    : never;
}[EventName<AjourCatalog>];

/**
 * Every local API client function, by the event it opens when no unit is
 * active: the request event of the route it calls. `appApiRequest` takes the
 * function's key, so a new client function fails to compile until it has a
 * name here.
 */
export const APP_API_CLIENT = {
  syncCodeHostConnection: "pull_request.sync",
  getProjectDataShapePlugins: "schema.list",
  exportProjectsWithDataShape: "project.export",
  importProjectsWithDataShape: "project.import",
  fetchPluginsOverview: "plugin.list",
  getPluginsOverview: "plugin.list",
  setPluginEnabled: "plugin.activate",
  setPluginSystemEnabled: "plugin_system.toggle",
  setUnsignedPluginsEnabled: "unsigned_plugins.toggle",
  getBacklogSourceStatuses: "source_state.list",
  upsertBacklogSourceStatuses: "source_state.update",
  savePluginConnection: "connection.save",
  deletePluginConnection: "connection.delete",
  removeConnectionSecrets: "connection.remove_secrets",
  removeMissingPluginData: "plugin.remove_data",
  retryVault: "vault.retry",
  listItemComments: "comment.list",
  postItemComment: "comment.post",
  editItemComment: "comment.edit",
  deleteItemComment: "comment.delete",
  searchItemPeople: "mention.search",
  setItemCommentReaction: "comment.react",
  listCalendarEvents: "calendar.fetch",
  createTeam: "team.create",
  runTeamSyncRound: "team.sync",
  syncBacklogConnection: "backlog.sync",
  listBacklogSettleStates: "source_state.list",
  writeBacklogSettle: "backlog.write_source",
  readBacklogDescription: "description.read",
  writeBacklogDescription: "description.write",
  listBacklogImportCandidates: "backlog_import.list",
  updateBacklogImportSelection: "backlog_import.select",
  dismissBacklogImportCandidates: "backlog_import.dismiss",
  restoreDismissedBacklogImports: "backlog_import.restore",
  commitSelectedBacklogImportsToLocalStore: "backlog_import.commit",
  getAgentRunner: "agent_runner.status",
  updateAgentRunnerSettings: "agent_runner.configure",
  saveAgentTaskSettings: "agent_task.configure",
  startAgentRun: "agent_run.start",
  getMcpSettings: "mcp.status",
  updateMcpSettings: "mcp.configure",
  createMcpClient: "agent_client.create",
  revokeMcpClient: "agent_client.revoke",
  postMcpBridgeResult: "mcp_bridge.result",
  answerAgentQuestion: "question.answer",
  dismissAgentSession: "agent_session.dismiss",
  stopAgentRun: "agent_run.stop",
  markAgentsSeen: "agent_session.mark_seen",
} as const satisfies Record<string, ClientEventName>;

/**
 * The jobs the renderer starts by name that are not in the renderer
 * catalog: the MCP bridge's, whose events the local API names too. The
 * catalog audit checks this and the tables above against the units the
 * renderer's code starts.
 */
const RENDERER_BRIDGE_JOBS = [
  "agent_tool.call",
  "mcp_bridge.connection",
] as const satisfies readonly EventName<AjourCatalog>[];

/** The kinds a local API client call opens its unit as. */
const CLIENT_KINDS: readonly Kind[] = ["command", "job"];

/**
 * Every event name the renderer emits, with the kinds it emits it as, for
 * the receiving side of forwarding (#440). It is derived from the code's
 * tables, never listed again: the renderer catalog (store commands, jobs,
 * navigation, `app.boot`), the local API client table, the bridge's jobs,
 * and the renderer's `app.error`. The kinds `ipc`, `request` and
 * `plugin_operation` are the main process's and the local API's: they are
 * never in it.
 */
export const rendererEmits: ReadonlyMap<string, readonly Kind[]> = (() => {
  const emits = new Map<string, Set<Kind>>();
  const add = (name: string, kinds: readonly Kind[]) => {
    const allowed = emits.get(name) ?? new Set<Kind>();
    for (const kind of kinds) {
      if (!MAIN_ONLY_KINDS.includes(kind)) allowed.add(kind);
    }
    if (allowed.size > 0) emits.set(name, allowed);
  };
  const kindsOf = (name: string): readonly Kind[] =>
    (catalog.events as Record<string, { kinds: readonly Kind[] }>)[name]!.kinds;
  for (const [name, spec] of Object.entries(rendererEvents)) {
    add(name, spec.kinds);
  }
  for (const name of Object.values(APP_API_CLIENT)) {
    add(
      name,
      kindsOf(name).filter((kind) => CLIENT_KINDS.includes(kind)),
    );
  }
  for (const name of RENDERER_BRIDGE_JOBS) add(name, ["job"]);
  add("app.error", ["crash"]);
  return new Map(
    [...emits].map(([name, kinds]) => [name, [...kinds]] as const),
  );
})();
