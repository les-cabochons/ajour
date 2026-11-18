import type {
  AjourCatalog,
  EventName,
  ReasonOf,
} from "@ajour/wide-events/catalog.ts";

/** Every `outcome_reason` an event of Ajour's catalog can end with. */
export type CatalogOutcomeReason = {
  [Name in EventName<AjourCatalog>]: ReasonOf<AjourCatalog, Name>;
}[EventName<AjourCatalog>];

/**
 * What each `outcome_reason` means, in plain language, for the diagnostics
 * viewer's root-cause note (#444). The table is fixed, not generated, and
 * covers every reason in the catalog: a reason added there without a line
 * here fails `outcome-reasons.test.ts`, and the record's type fails the
 * typecheck.
 */
const OUTCOME_REASON_EXPLANATIONS: Readonly<
  Record<CatalogOutcomeReason, string>
> = {
  aborted: "The plugin stopped its own request before it finished.",
  access_off:
    "The connection's access doesn't include what this needs, such as editing work items. Turn that access on in the connection's settings.",
  admin_cancelled:
    "Removing the ajour command needed administrator rights, and that request was cancelled.",
  agent_access: "Agents aren't allowed to do this, so the call was refused.",
  already_running: "An agent run is already going, so a new one didn't start.",
  api_stop_failed: "Ajour quit, but stopping the local API failed first.",
  api_stop_timed_out: "Ajour quit, but the local API took too long to stop.",
  archived_by_source:
    "The project source archived or closed this project or task, so Ajour keeps it as the source has it.",
  archived_target: "The task to merge into is archived.",
  ask_queue_full:
    "Too many questions about running commands were already waiting, so this one wasn't asked.",
  ask_timeout: "Nobody answered whether the command may run in time.",
  blocked: "The agent task can't run now, so the run didn't start.",
  body_too_large: "The handoff tool's status post was too large to read.",
  bridge_timeout:
    "The Ajour window didn't answer the agent's tool call in time.",
  bridge_unavailable:
    "No Ajour window was connected to answer the agent's tool call.",
  browser_origin:
    "The request came from a web page, not from a tool, so it was refused.",
  capability_off: "That capability of the plugin is turned off.",
  capacity:
    "The plugin host was already running as many operations as it allows, so this one didn't start.",
  capture_incomplete: "The command's output couldn't be captured in full.",
  changed_since:
    "The record changed after this action, so undoing it would overwrite newer work.",
  cli_exited:
    "The agent's command-line program exited before the turn finished.",
  cli_failed: "The agent's command-line program reported an error.",
  client_closed:
    "The caller went away before the answer reached it, such as a closed window or a cancelled request.",
  concurrency: "The plugin already runs as many commands at once as it may.",
  connection_changed_during_sync:
    "The connection was saved again while the sync ran, so its answer wasn't used.",
  connection_not_found:
    "The connection doesn't exist anymore, or belongs to another plugin.",
  connection_refused:
    "Turning the capability on checked a connection, and the plugin refused it, so the capability stays off.",
  crashed:
    "The plugin's process ended while it worked: it crashed, ran out of memory or was killed.",
  debugger: "Plugins are off because a debugger is attached to Ajour.",
  deactivated_during_sync:
    "The plugin, or its backlog, was turned off while the sync ran.",
  development_build: "This development build of Ajour doesn't do this.",
  digest_mismatch:
    "The download didn't match its published checksum, so it wasn't used.",
  disconnected: "The local API closed the window's agent connection for good.",
  dismissed: "The agent session was dismissed.",
  duplicate_id: "The agent sent a request with an id it was already using.",
  environment:
    "Plugins are off because an environment setting turned them off when Ajour started.",
  escaping_entry:
    "The downloaded archive held a file that would land outside its folder, so nothing was installed.",
  executable_missing:
    "The command's program isn't installed, or isn't on the PATH.",
  exited_early: "The plugin stopped before it returned a result.",
  expired: "Undo is no longer available for this action.",
  files_in_use:
    "An ajour command running in Linux holds its files, so the old version stays until it ends.",
  folder_refused: "The plugin may not run commands in that folder.",
  follow_failed: "Updating the ajour command to this version of Ajour failed.",
  foreign_command:
    "Another ajour command that Ajour didn't install is already there. Remove it, then try again.",
  foreign_sender:
    "The call came from a window or page that may not make it, so it was refused.",
  handoff_refused: "The handoff was refused: nothing it names could take it.",
  has_dependents:
    "Later changes depend on this one, so it can't be undone alone.",
  header_refused:
    "The plugin tried to send a header Ajour never sends, or one its manifest doesn't list.",
  hook_refused:
    "The plugin passed a status hook to a command that doesn't have one.",
  host_refused:
    "The request named a host the local API doesn't answer, so it was refused.",
  host_stopping: "The plugin host was stopping, for a quit or a restart.",
  input_limit: "The plugin sent the command more input than it may.",
  installed: "The plugin is still installed. Uninstall it to remove its data.",
  invalid_address: "The connection's saved address can't be used.",
  invalid_archive: "The downloaded archive couldn't be read.",
  invalid_call:
    "The agent called a tool that doesn't exist, or gave it arguments it doesn't take.",
  invalid_query:
    "The viewer asked the log file for something outside what it answers.",
  invalid_request:
    "The request was malformed: a value was missing or invalid. This usually points to a bug in the caller.",
  invalid_result: "The plugin returned a result Ajour can't use.",
  invalid_settings:
    "The settings sent were outside what's allowed, so nothing changed.",
  invalid_signature:
    "The download's signature didn't check out, so it wasn't used.",
  launch_flag:
    "Plugins are off because Ajour was started with a flag that turns them off.",
  listen_error: "The local API couldn't start listening for connections.",
  load_cancelled: "Loading the window was cancelled.",
  load_failed: "The page failed to load.",
  local_only_target:
    "The task to merge into exists only in Ajour, not in the project source.",
  locked_week:
    "The change touches a submitted week, which stays locked, so nothing was written.",
  lossy_not_allowed:
    "Writing the description would lose formatting the source keeps, and that loss wasn't allowed.",
  mcp_failed:
    "The agent's MCP server didn't start, so it couldn't reach Ajour.",
  mcp_off: "The MCP server is turned off in Settings.",
  missing: "The task to merge into doesn't exist anymore.",
  missing_asset: "The release has no download for this computer.",
  missing_digest:
    "The release published no checksum for its download, so it wasn't used.",
  missing_release:
    "The ajour command's release for this version of Ajour couldn't be found.",
  needs_consent: "The plugin's access needs your review and approval first.",
  network:
    "The service couldn't be reached: no network, a name that didn't resolve, or a refused connection.",
  no_agent_task: "The plugin has no agent task with that id.",
  no_origin:
    "The window's agent connection carried no origin, so it was refused.",
  no_route: "No route of the local API matches that address.",
  no_transport: "Plugins reach the network only from the desktop app.",
  no_window: "No Ajour window was open to ask whether the command may run.",
  not_allowed:
    "The plugin's manifest doesn't allow that endpoint, host or address.",
  not_installed: "The plugin isn't installed.",
  not_managed: "The task isn't in a project its source manages.",
  not_running: "No agent run was going, so there was nothing to stop.",
  not_sandboxed:
    "A plugin's process didn't report Ajour's sandbox, so every plugin was turned off.",
  not_secret: "That field isn't one the plugin marks as secret.",
  not_supported: "The plugin doesn't offer that capability or feature.",
  operation_ended:
    "The plugin operation it belonged to ended first, so it was cancelled.",
  origin_refused:
    "The request came from a browser origin the local API doesn't accept.",
  other_project: "The task to merge into belongs to another project.",
  output_limit: "The command printed more output than the plugin may read.",
  output_mismatch: "The tool's answer didn't match the shape it declares.",
  outside_pull_request:
    "The pull request's agent called a tool outside its pull request, so the call was refused.",
  package_change:
    "The plugin's package changed while it ran, such as during an update.",
  package_unverified: "The plugin's package couldn't be verified.",
  packaged_build:
    "Development plugins can only be set up in a development build.",
  plugin_error: "The plugin ran into an error of its own while it worked.",
  plugin_off: "The plugin is turned off.",
  port_in_use: "Another program is using the port the local API listens on.",
  private_address:
    "The address resolved to, or answered from, a private network address, which this connection may not reach.",
  process_acceptance_required:
    "The plugin needs your permission before it runs programs on this computer.",
  protocol_error: "The agent's message didn't follow the MCP protocol.",
  query_failed:
    "Ajour couldn't ask the system which plugin processes were still running.",
  question_closed:
    "The agent's question had already closed when it was answered.",
  rate_limit: "The plugin opened too many terminals in the last minute.",
  rate_limited:
    "Too many requests in a short time: Ajour's broker holds each plugin to a rate, and this request's turn would have come after its time limit.",
  ready_timeout: "A plugin's page didn't report that it was ready in time.",
  redirect_off_https:
    "The download redirected away from https, so it was stopped.",
  redirect_refused:
    "The address redirected too often, or away from https, so the request stopped.",
  refresh_failed: "Reading the handoff tool's threads again failed.",
  remove_failed: "Removing the ajour command failed.",
  renderer_integrity:
    "Plugins are off because a plugin's page failed Ajour's integrity check.",
  renderer_not_sandboxed:
    "Plugins are off because a plugin's page ran outside the sandbox.",
  renderer_unknown:
    "Plugins are off because Ajour couldn't tell whether plugin pages run in the sandbox.",
  request_too_large: "The plugin's request was larger than the broker sends.",
  response_too_large:
    "The service's answer was larger than the broker accepts.",
  result_too_large: "The plugin's result was larger than Ajour accepts.",
  runs_no_code: "The plugin has no code to run for this.",
  runtime_unavailable:
    "Plugins are off: this computer can't run them in a sandbox.",
  same_task: "A task can't be merged into itself.",
  secret_unavailable:
    "The connection's secret can't be read now, so the connection is paused.",
  session_closed: "The agent session had already ended.",
  session_ended: "The command's session ended.",
  session_limit:
    "The plugin already keeps as many command sessions open as it may.",
  settle_ended:
    "The settle ended before its comment was sent, so the comment was kept.",
  shared_process:
    "Plugins are off because a plugin's page shared its process with another page.",
  shutdown: "Ajour was quitting.",
  spawn_failed: "The command's program couldn't be started.",
  spawn_refused: "Ajour refused to start the command.",
  stale_window:
    "Another Ajour window changed the data first, so this window's change was refused.",
  stalled: "The agent stopped answering, so the turn ended.",
  startup_failed: "Ajour failed while it started.",
  stdin_failed: "Sending input to the command failed.",
  still_running: "A plugin process from the last session was still running.",
  stopping: "The local API was stopping, so it cut the request off.",
  superseded:
    "A newer one started before this one finished, so this one gave way.",
  suspended:
    "The plugin stopped 3 times in 10 minutes, so it runs nothing until you turn it back on.",
  system_off: "Plugins are turned off for all of Ajour.",
  timeout: "It took longer than its time limit, so Ajour stopped waiting.",
  token_missing: "The agent didn't send its token.",
  token_refused:
    "The request to the local API didn't carry this window's token.",
  token_revoked: "The agent's token was revoked.",
  token_unknown: "The agent's token isn't one Ajour gave out.",
  too_large: "The download was larger than Ajour accepts.",
  too_many_queued:
    "The plugin had too many requests waiting at once, so the broker refused this one.",
  tool_failed: "The agent tool failed while it ran.",
  tool_not_declared:
    "The agent task's client called a tool its task doesn't declare.",
  tool_off: "That handoff tool is turned off.",
  tool_refused:
    "The tool declined the call and told the agent why. That is the tool working as designed.",
  two_running_entries: "Undoing it would leave two entries running at once.",
  unchecked_response:
    "The answer couldn't be checked for secrets within the broker's budget, so it was dropped.",
  undeclared: "The plugin asked for something its manifest doesn't declare.",
  uninstalled: "The plugin was uninstalled while it ran.",
  unknown_client: "The agent client isn't one Ajour knows.",
  unknown_distro: "That WSL distro isn't installed.",
  unknown_hook:
    "The handoff status post named an unknown handoff, or its token was wrong, missing or revoked.",
  unknown_operation: "The route doesn't have the operation it was asked for.",
  unknown_run: "A plugin page reported on a run Ajour doesn't know.",
  unknown_tool: "The plugin's manifest declares no tool with that id.",
  unreadable: "Ajour's saved data couldn't be read.",
  unreadable_record:
    "The record of the last session's plugin processes couldn't be read.",
  unsigned_processes_off:
    "Unsigned plugins may not run programs on this computer right now.",
  unsupported_os:
    "Plugins are off because this operating system can't sandbox them.",
  unsupported_platform:
    "The ajour command isn't available for this computer's platform.",
  update_cancelled: "Installing the update was cancelled during the quit.",
  url_not_allowed: "That address isn't one Ajour allows here.",
  user_denied: "You said no when asked whether the command may run.",
  vault_unavailable:
    "The vault can't encrypt or remove secrets on this computer right now.",
  version_changed:
    "The plugin was updated after you reviewed its access, so it needs a new review.",
  window_closed: "The window closed before it finished loading.",
  would_lock_week: "Undoing it would change a submitted week.",
  wrong_version:
    "The downloaded ajour command reported another version than expected.",
  wsl1_unsupported:
    "The WSL distro runs on WSL 1, where the ajour command can't be checked.",
  wsl_add_failed: "Adding the ajour command to WSL failed.",
  wsl_remove_failed: "Removing the ajour command from WSL failed.",
};

/**
 * Where one event's reason means something narrower than the table's line,
 * keyed by `<event name>:<reason>`.
 */
const EVENT_REASON_EXPLANATIONS: Readonly<Record<string, string>> = {
  "handoff.hook:rate_limited":
    "The handoff tool posted its state too often, for this handoff or for all of them.",
  "window.load:aborted": "The window's load was interrupted.",
  "plugin_renderer.blocked:blocked":
    "A plugin's page tried to go somewhere it may not, and Ajour blocked it.",
};

/** The reasons the table explains, for the test that keeps it complete. */
export const EXPLAINED_OUTCOME_REASONS: readonly string[] = Object.keys(
  OUTCOME_REASON_EXPLANATIONS,
);

/**
 * The plain-language line for an event's `outcome_reason`, or null for a
 * reason the catalog doesn't have (an event written by another version).
 */
export function explainOutcomeReason(
  reason: string,
  eventName?: string,
): string | null {
  if (eventName) {
    const narrower = EVENT_REASON_EXPLANATIONS[`${eventName}:${reason}`];
    if (narrower) return narrower;
  }
  return Object.hasOwn(OUTCOME_REASON_EXPLANATIONS, reason)
    ? OUTCOME_REASON_EXPLANATIONS[reason as CatalogOutcomeReason]
    : null;
}
