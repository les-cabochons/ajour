import { defineCatalog, operational, type EventOf } from "./fields.ts";
import { rendererCounters, rendererEvents } from "./renderer-catalog.ts";

/**
 * The MCP methods an `mcp.request` event names: those of the MCP spec, a
 * `batch` of several messages, and `other` for any Ajour doesn't know.
 */
export type McpMethod =
  | "initialize"
  | "ping"
  | "notifications/initialized"
  | "notifications/cancelled"
  | "notifications/progress"
  | "notifications/roots/list_changed"
  | "tools/list"
  | "tools/call"
  | "resources/list"
  | "resources/templates/list"
  | "resources/read"
  | "resources/subscribe"
  | "resources/unsubscribe"
  | "prompts/list"
  | "prompts/get"
  | "logging/setLevel"
  | "completion/complete"
  | "batch"
  | "other";

/** Why the desktop main process could not start the local API. */
export type ApiStartFailure =
  "port_in_use" | "listen_error" | "health_timeout" | "entry_missing";

/** How the local API's stop ended before a quit or an update. */
export type ApiStop = "stopped" | "failed" | "timed_out";

/** What every IPC event carries: the channel, never its arguments. */
const ipcFields = {
  channel: operational(),
  /** `invoke` returns a promise, `message` is one-way, `sync` blocks the renderer. */
  mode: operational<"invoke" | "message" | "sync">(),
  /** False when a window other than the active one sent it. */
  sender_accepted: operational<boolean>(),
} as const;

/** An HTTP method, from a closed set: any other is `other`. */
export type HttpMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "other";

/**
 * What every `request` event carries, whatever its route: the method, the
 * route's pattern (never its values), the status and the sizes.
 */
const requestFields = {
  http: {
    method: operational<HttpMethod>(),
    /** The route's pattern, such as `/api/plugins/:pluginId/connections`. */
    route: operational(),
    status_code: operational<number>(),
    request_bytes: operational<number>(),
    response_bytes: operational<number>(),
    /** Whether the caller sent an allowed browser origin, none, or another. */
    origin: operational<"app" | "none" | "refused">(),
  },
} as const;

/**
 * How any request can end other than by its route's own reasons: its body
 * or parameters didn't validate, the caller's mistake, its client left
 * before the response reached it, or the API stopped and cut it off.
 */
const requestReasons = [
  "invalid_request",
  "client_closed",
  "stopping",
] as const;

/**
 * Why a plugin activation or capability check refuses work. They double as
 * plugin operation reasons, so a request and its operation say the same.
 */
const inactiveReasons = ["system_off", "plugin_off", "capability_off"] as const;

/**
 * What every `plugin_operation` event carries: one worker run, in the plugin
 * host or the schema host.
 */
const pluginOperationFields = {
  plugin: {
    id: operational(),
    version: operational(),
    source: operational<"installed" | "development">(),
    api_version: operational<number>(),
  },
  connection: { id: operational() },
  worker: {
    host: operational<"plugin" | "schema">(),
    /** The plugin method the worker ran, such as `syncConnection`. */
    method: operational(),
    /** The switchable capability the method serves, if any. */
    capability: operational(),
    /** The host's other operations running when this one was admitted. */
    active_operations: operational<number>(),
    /** From admission to the worker's start: discovery, gates, validation. */
    prepare_ms: operational<number>(),
    /** From the worker's start to its result, failure or termination. */
    worker_ms: operational<number>(),
    timeout_ms: operational<number>(),
    /** The serialized size of the worker's result. */
    result_bytes: operational<number>(),
  },
} as const;

/**
 * Every way a plugin operation ends other than `ok`. Refused: `capacity`,
 * the inactive reasons, `host_stopping`, `package_change`, `not_installed`,
 * `runs_no_code`, `not_supported` for a capability or feature the plugin
 * doesn't declare, and `agent_access` when its route's admission check
 * refuses it. Cancelled: the inactive reasons, `uninstalled` and
 * `shutdown`. Then `timeout`, and the errors `result_too_large`,
 * `invalid_result`, `exited_early` and `plugin_error`.
 */
const pluginOperationReasons = [
  "capacity",
  ...inactiveReasons,
  "host_stopping",
  "package_change",
  "not_installed",
  "runs_no_code",
  "not_supported",
  /** The route's own admission check refused the call, such as an agent's comment. */
  "agent_access",
  "uninstalled",
  "shutdown",
  "timeout",
  "result_too_large",
  "invalid_result",
  "exited_early",
  "plugin_error",
] as const;

/**
 * A route that runs a plugin operation: the request and the operation share
 * the name. The route also refuses a connection it doesn't have.
 */
const pluginRequestReasons = [
  ...requestReasons,
  ...pluginOperationReasons,
  "connection_not_found",
] as const;

/**
 * Ajour's event names, one table for every runtime: an operation keeps its
 * name in each runtime that sees it, and `kind` and `runtime` tell the hops
 * apart. Each entry lists the event's own fields, beyond the envelope, in
 * nested objects named for glossary terms. No field holds content: no text
 * anyone wrote, no name, URL, path, source tool key or secret (ADR 0011).
 *
 * The entries below are the local API's events, and the renderer's from
 * `renderer-catalog.ts`. The seams of #304 add the rest.
 */
export const catalog = defineCatalog({
  counters: {
    ...rendererCounters,
    /** A plugin folder discovery skipped because its package is invalid. */
    invalid_plugin: operational<number>(),
    /** A bundled plugin archive that failed to install. */
    bundled_plugin_failed: operational<number>(),
    /** A leftover plugin backup that couldn't be restored or removed. */
    plugin_backup_failed: operational<number>(),
  },
  events: {
    ...rendererEvents,
    // The local API itself.

    /** A request refused before routing, or one that matches no route. */
    "api.request": {
      kinds: ["request"],
      reasons: [
        "host_refused",
        "origin_refused",
        /** A request to `/api` without the window token, or with a wrong one. */
        "token_refused",
        "no_route",
        /** A route that names its operations, called with one it doesn't have. */
        "unknown_operation",
        ...requestReasons,
      ],
      fields: { ...requestFields },
    },
    "api.health": {
      kinds: ["request"],
      reasons: requestReasons,
      fields: { ...requestFields },
    },
    /** The local API starts listening. */
    "api.start": {
      kinds: ["lifecycle"],
      reasons: ["port_in_use", "listen_error"],
      fields: {
        api: { port: operational<number>(), listen_ms: operational<number>() },
      },
    },
    /** The local API stops: each phase's duration, and what still ran. */
    "api.stop": {
      kinds: ["lifecycle"],
      fields: {
        api: {
          port: operational<number>(),
          agent_runner_ms: operational<number>(),
          plugins_ms: operational<number>(),
          close_ms: operational<number>(),
          plugin_operations_running: operational<number>(),
        },
      },
    },
    /** The local API's first read of its state file, shared by every first reader. */
    "storage.load": {
      kinds: ["lifecycle"],
      reasons: ["unreadable"],
      fields: {
        storage: {
          /** False when no state file exists yet, and the defaults load. */
          found: operational<boolean>(),
          /** The file's state version, before migration. */
          version_from: operational<number>(),
          version_to: operational<number>(),
          bytes: operational<number>(),
          /** The file exists but is not JSON. Every read fails until it is fixed. */
          unreadable: operational<boolean>(),
        },
      },
    },
    // Agents and MCP.

    /** An MCP request other than a tool call, or one refused before it reached a tool. */
    "mcp.request": {
      kinds: ["request"],
      reasons: [
        "mcp_off",
        "browser_origin",
        "token_missing",
        "token_unknown",
        "token_revoked",
        "protocol_error",
        "duplicate_id",
        ...requestReasons,
      ],
      fields: {
        ...requestFields,
        mcp: {
          /** The JSON-RPC method, from a closed set. */
          method: operational<McpMethod>(),
          /** In a `batch`, how many of its messages call a tool. */
          call_count: operational<number>(),
        },
        agent: { client_id: operational() },
      },
    },
    /** One call of an agent tool, named once the request's method is read. */
    "agent_tool.call": {
      kinds: ["request", "job"],
      reasons: [
        "invalid_call",
        "protocol_error",
        "bridge_unavailable",
        "bridge_timeout",
        "tool_failed",
        "output_mismatch",
        ...requestReasons,
      ],
      fields: {
        ...requestFields,
        agent: {
          client_id: operational(),
          /** The client's newest open session when the call ended. */
          session_id: operational(),
        },
        agent_tool: {
          /** One of Ajour's tools, or `other` for a name it doesn't have. */
          name: operational(),
          /** Read and write tools run in the renderer; session tools in the API. */
          access: operational<"read" | "write" | "session">(),
          /** How long the renderer took to answer over the bridge. */
          bridge_ms: operational<number>(),
        },
      },
    },
    /** The renderer's bridge stream, from open to close. */
    "mcp_bridge.connection": {
      kinds: ["job", "request"],
      reasons: ["mcp_off", "no_origin", ...requestReasons],
      fields: {
        ...requestFields,
        /** The tool calls the stream carried to the renderer. */
        mcp_bridge: { call_count: operational<number>() },
      },
    },
    /** The renderer's answer to a tool call it was sent over the bridge. */
    "mcp_bridge.result": {
      kinds: ["request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        /** False when the call had already timed out. */
        mcp_bridge: { resolved: operational<boolean>() },
      },
    },
    "mcp.status": {
      kinds: ["request"],
      reasons: requestReasons,
      fields: { ...requestFields },
    },
    "mcp.configure": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: { ...requestFields, mcp: { enabled: operational<boolean>() } },
    },
    "agent_client.create": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: { ...requestFields, agent: { client_id: operational() } },
    },
    "agent_client.revoke": {
      kinds: ["command", "request"],
      reasons: ["unknown_client", ...requestReasons],
      fields: { ...requestFields, agent: { client_id: operational() } },
    },
    /** The user's answer to an agent's question. Never its text. */
    "question.answer": {
      kinds: ["command", "request"],
      reasons: ["question_closed", ...requestReasons],
      fields: { ...requestFields, agent: { question_id: operational() } },
    },
    "agent_session.dismiss": {
      kinds: ["command", "request"],
      reasons: ["session_closed", ...requestReasons],
      fields: { ...requestFields, agent: { session_id: operational() } },
    },
    /** The user opened the agent panel: earlier errors are seen. */
    "agent_session.mark_seen": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: { ...requestFields },
    },
    /** An agent session, from begin to end. */
    "agent.session": {
      kinds: ["job"],
      reasons: ["dismissed"],
      fields: {
        agent: {
          client_id: operational(),
          session_id: operational(),
          /** Joins a session the runner began to its `agent.run`. */
          run_id: operational(),
          update_count: operational<number>(),
          question_count: operational<number>(),
          stall_count: operational<number>(),
        },
      },
    },
    /** One agent run, from the start's first launch step to its one finalizer. */
    "agent.run": {
      kinds: ["job"],
      fields: {
        agent: {
          run_id: operational(),
          /** Absent when the launch failed before the session began. */
          session_id: operational(),
          /** Absent when the launch failed before the client was created. */
          client_id: operational(),
          task_id: operational(),
          cli: operational(),
          /** Only when it looks like a version: raw `--version` output stays out. */
          cli_version: operational(),
          browser_mode: operational(),
          stop_reason: operational<
            "user" | "stalled" | "mcp" | "shutdown" | "ended"
          >(),
          exit_code: operational<number | null>(),
          tool_call_count: operational<number>(),
        },
        plugin: { id: operational() },
        launch: {
          failed_step: operational<
            | "find_executable"
            | "read_prompt"
            | "create_client"
            | "begin_session"
            | "create_work_folder"
            | "build_invocation"
            | "write_files"
            | "spawn"
          >(),
        },
        cleanup: {
          outcome: operational<"ok" | "failed">(),
          /** Every cleanup step that failed. */
          failed_steps:
            operational<
              ("end_session" | "revoke_client" | "remove_work_folder")[]
            >(),
          /** The first failed step's error: its type and code, never its message. */
          error: { type: operational(), code: operational() },
        },
      },
    },
    "agent_run.start": {
      kinds: ["command", "request"],
      reasons: [
        "already_running",
        "no_agent_task",
        "blocked",
        ...requestReasons,
      ],
      fields: {
        ...requestFields,
        agent: { run_id: operational(), task_id: operational() },
        plugin: { id: operational() },
      },
    },
    "agent_run.stop": {
      kinds: ["command", "request"],
      reasons: ["not_running", ...requestReasons],
      fields: { ...requestFields, agent: { run_id: operational() } },
    },
    "agent_run.status": {
      kinds: ["request"],
      reasons: requestReasons,
      fields: { ...requestFields },
    },
    "agent_runner.status": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: { ...requestFields },
    },
    "agent_runner.configure": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: { ...requestFields },
    },
    "agent_task.configure": {
      kinds: ["command", "request"],
      reasons: ["no_agent_task", ...requestReasons],
      fields: {
        ...requestFields,
        plugin: { id: operational() },
        agent_task: { field_count: operational<number>() },
      },
    },

    // Plugins, connections and activation.

    /** The plugins overview, or the runnable plugins' manifests. */
    "plugin.list": {
      kinds: ["request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        plugin_list: {
          plugin_count: operational<number>(),
          unavailable_count: operational<number>(),
          discovery_ms: operational<number>(),
        },
      },
    },
    /** A plugin, or one of its capabilities, turned on or off. */
    "plugin.activate": {
      kinds: ["command", "request"],
      reasons: ["not_installed", "not_supported", ...requestReasons],
      fields: {
        ...requestFields,
        plugin: { id: operational() },
        activation: {
          capability: operational(),
          enabled: operational<boolean>(),
          /** Running plugin operations the turn-off cancelled. */
          operations_cancelled: operational<number>(),
        },
      },
    },
    "plugin_system.toggle": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        activation: {
          enabled: operational<boolean>(),
          operations_cancelled: operational<number>(),
        },
      },
    },
    /** A connection's settings validated by its plugin and saved. */
    "connection.save": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        connection: {
          id: operational(),
          /** True for a connection saved for the first time. */
          is_new: operational<boolean>(),
          /** How many of the plugin's own fields the settings hold. */
          field_count: operational<number>(),
          /** The switchable capabilities that were on, so checked. */
          capability_count: operational<number>(),
        },
      },
    },
    "connection.delete": {
      kinds: ["command", "request"],
      reasons: [
        ...rendererEvents["connection.delete"].reasons,
        "connection_not_found",
        ...requestReasons,
      ],
      fields: {
        ...requestFields,
        ...rendererEvents["connection.delete"].fields,
      },
    },

    // Backlog.

    /** One backlog sync of a connection. */
    "backlog.sync": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: [...pluginRequestReasons, "deactivated_during_sync"],
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        backlog_sync: {
          trigger: operational<"manual" | "auto" | "source_write">(),
          mode: operational<"review" | "backlog">(),
          /** The synced items Ajour sent, for their updates. */
          items_sent: operational<number>(),
          items_received: operational<number>(),
          staged_count: operational<number>(),
          updated_count: operational<number>(),
          skipped_count: operational<number>(),
          done_count: operational<number>(),
          work_item_update_count: operational<number>(),
          comment_fact_count: operational<number>(),
        },
      },
    },
    /** A settle's state or priority, written to the source after the Undo window. */
    "backlog.write_source": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        source_write: {
          state_sent: operational<boolean>(),
          priority_sent: operational<boolean>(),
        },
      },
    },
    /** A synced item's description as its source holds it now. */
    "description.read": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    /** A synced item's description written to its source. Its length, never its text. */
    "description.write": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: [...pluginRequestReasons, "lossy_not_allowed"],
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        description: {
          length: operational<number>(),
          allowed_loss_count: operational<number>(),
        },
      },
    },
    /**
     * Source states: those Ajour has seen on synced items, or those a settle
     * can write, which the plugin lists.
     */
    "source_state.list": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        source_state: { count: operational<number>() },
      },
    },
    "source_state.update": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        source_state: { count: operational<number>() },
      },
    },
    /** Candidates a plugin or the renderer pushes to Sync review. */
    "backlog_import.stage": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        backlog_import: {
          candidate_count: operational<number>(),
          staged_count: operational<number>(),
          updated_count: operational<number>(),
        },
      },
    },
    "backlog_import.list": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        backlog_import: { candidate_count: operational<number>() },
      },
    },
    "backlog_import.select": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        backlog_import: {
          candidate_count: operational<number>(),
          updated_count: operational<number>(),
        },
      },
    },
    "backlog_import.dismiss": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        backlog_import: { candidate_count: operational<number>() },
      },
    },
    "backlog_import.restore": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: { ...requestFields },
    },
    "backlog_import.commit": {
      kinds: ["command", "request"],
      reasons: [
        ...rendererEvents["backlog_import.commit"].reasons,
        ...requestReasons,
      ],
      fields: {
        ...requestFields,
        ...rendererEvents["backlog_import.commit"].fields,
        backlog_import: {
          ...rendererEvents["backlog_import.commit"].fields.backlog_import,
          committed_count: operational<number>(),
        },
      },
    },

    // Comments.

    /**
     * A synced backlog item's comments. Never their text or authors (ADR
     * 0008). The renderer's hop adds Ajour's item ID and the cache hit (#310).
     */
    "comment.list": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        comment: {
          /** The newest comments, or an earlier page through a cursor. */
          page: operational<"latest" | "earlier">(),
          comment_count: operational<number>(),
        },
      },
    },
    /** A comment posted on a synced backlog item: its length, never its text. */
    "comment.post": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        comment: {
          body_length: operational<number>(),
          mention_count: operational<number>(),
        },
      },
    },
    "comment.edit": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        comment: {
          body_length: operational<number>(),
          mention_count: operational<number>(),
        },
      },
    },
    /** Sent after the Undo window, so a job in the renderer. */
    "comment.delete": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    "comment.react": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    /** The people a mention can name, for the editor's @ suggestions. Never their names. */
    "mention.search": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        mention: { result_count: operational<number>() },
      },
    },

    // The desktop main process (#308). Every IPC channel's event carries
    // `ipc`; the channel table is apps/desktop/electron/ipc-channels.cjs.

    /** One launch, from the process start until the window has loaded. */
    "app.launch": {
      kinds: ["lifecycle"],
      reasons: ["startup_failed", "load_failed", "load_cancelled"],
      fields: {
        launch: {
          /** The version the previous launch ran, absent on a first launch. */
          previous_version: operational(),
          /** From the process start until Electron is ready. */
          ready_ms: operational<number>(),
          api_start_ms: operational<number>(),
          /** Creating the window and loading the renderer in it. */
          window_ms: operational<number>(),
          renderer_load_ms: operational<number>(),
          renderer_source: operational<"app_protocol" | "dev_server">(),
        },
        api: {
          outcome: operational<"started" | "failed">(),
          failure_reason: operational<ApiStartFailure>(),
        },
        catalog: {
          settings_source: operational<"saved" | "default">(),
          refresh_minutes: operational<number>(),
        },
      },
    },
    /** Quitting, from the first quit request until the process quits. */
    "app.quit": {
      kinds: ["lifecycle"],
      reasons: ["api_stop_failed", "api_stop_timed_out", "update_cancelled"],
      fields: {
        quit: {
          /** `os` is a shutdown or a logout; `other`, a quit no Ajour code saw. */
          trigger: operational<
            | "all_windows_closed"
            | "menu"
            | "os"
            | "update_install"
            | "recovery_dialog"
            | "startup_failure"
            | "other"
          >(),
          updater_ms: operational<number>(),
          api_stop_ms: operational<number>(),
          api_stop: operational<ApiStop>(),
        },
      },
    },
    /** Another launch while Ajour runs: the running app shows its window. */
    "app.second_launch": {
      kinds: ["lifecycle"],
      fields: {
        second_launch: {
          had_window: operational<boolean>(),
          restored: operational<boolean>(),
          focused: operational<boolean>(),
        },
      },
    },
    /** Emitted by the second process, just before it exits. */
    "app.lock_refused": { kinds: ["lifecycle"], fields: {} },
    /**
     * One load of the app in the window. A failed load stays open until the
     * user answers Try again or Quit.
     */
    "window.load": {
      kinds: ["lifecycle"],
      reasons: ["aborted", "superseded", "window_closed"],
      fields: {
        window: {
          trigger: operational<
            "launch" | "activate" | "retry" | "crash_reload" | "reload"
          >(),
          load_ms: operational<number>(),
          answer: operational<
            "try_again" | "quit" | "replaced" | "dialog_failed"
          >(),
        },
      },
    },
    /** A window that stopped responding, until it responds, crashes or closes. */
    "window.unresponsive": {
      kinds: ["crash"],
      fields: {
        unresponsive: {
          answer: operational<
            "wait" | "reload" | "replaced" | "dialog_failed"
          >(),
          recovered: operational<boolean>(),
        },
      },
    },
    /** A renderer, GPU or utility process that ended. */
    "process.gone": {
      kinds: ["crash"],
      fields: {
        process: {
          type: operational(),
          /** Electron's reason, such as `crashed`, `oom` or `killed`. */
          reason: operational(),
          exit_code: operational<number>(),
        },
        recovery: {
          action: operational<
            "reloaded" | "cap_reached" | "killed_on_purpose" | "window_closed"
          >(),
          /** The answer to "Ajour keeps crashing", when it showed. */
          answer: operational<
            "reload" | "quit" | "replaced" | "dialog_failed"
          >(),
        },
      },
    },
    /**
     * An error nothing else caught, or a startup that failed. The renderer
     * reports a refused write its toast showed as handled `toast`.
     */
    "app.error": {
      kinds: ["crash"],
      fields: {
        crash: {
          origin: operational<
            "uncaught_exception" | "unhandled_rejection" | "startup_failure"
          >(),
          /** The unit of work that was active, by name. */
          active_unit: operational(),
          handled_by: operational<"dialog" | "toast" | "none">(),
        },
      },
    },
    /** A link or navigation from the window: the scheme only, never the URL. */
    "window.navigate": {
      kinds: ["navigation"],
      fields: {
        navigation: {
          destination: operational<"app" | "external" | "blocked">(),
          /** Such as `https:`, or `other` for a malformed URL. */
          scheme: operational(),
          source: operational<"will_navigate" | "window_open">(),
        },
      },
    },
    /** The plugin index refreshed from the network, the cache or the built-in snapshot. */
    "catalog.refresh": {
      kinds: ["job"],
      fields: {
        catalog: {
          trigger: operational<"launch" | "interval" | "request">(),
          source: operational<"network" | "cache" | "built_in">(),
          /** The index file's HTTP status, absent when the request failed. */
          status: operational<number>(),
          /** Whether the index request was conditional. */
          revalidated: operational<boolean>(),
          entry_count: operational<number>(),
          definitions_fetched: operational<number>(),
          definitions_revalidated: operational<number>(),
          definitions_failed: operational<number>(),
          images_fetched: operational<number>(),
          images_revalidated: operational<number>(),
          images_failed: operational<number>(),
          skipped_plugin_ids: operational<string[]>(),
          bytes: operational<number>(),
        },
      },
    },
    "catalog.get": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: { ipc: ipcFields },
    },
    "catalog.get_settings": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: { ipc: ipcFields },
    },
    "catalog.configure": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        catalog: {
          refresh_minutes_before: operational<number>(),
          refresh_minutes_after: operational<number>(),
        },
      },
    },
    /** Choosing or clearing the development plugin folders, in development builds. */
    "dev_plugins.configure": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender", "packaged_build"],
      fields: {
        ipc: ipcFields,
        dev_plugins: {
          action: operational<"select" | "clear">(),
          directory_count_before: operational<number>(),
          directory_count_after: operational<number>(),
          result: operational<"applied" | "rolled_back" | "cancelled">(),
        },
      },
    },
    "dev_plugins.get_settings": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: { ipc: ipcFields },
    },
    /** An application update check, asked for or on its schedule. */
    "update.check": {
      kinds: ["command", "job", "ipc"],
      reasons: ["foreign_sender", "superseded"],
      fields: {
        ipc: ipcFields,
        update: {
          trigger: operational<"manual" | "schedule" | "track_change">(),
          track: operational<"stable" | "nightly">(),
          current_version: operational(),
          latest_version: operational(),
          available: operational<boolean>(),
          /** `joined` waited for a check already running. */
          cache: operational<"hit" | "joined" | "miss">(),
          github_statuses: operational<number[]>(),
          result: operational<
            "available" | "up_to_date" | "failed" | "superseded" | "unchanged"
          >(),
        },
      },
    },
    /**
     * Update and restart: emitted just before the installer takes over, or
     * where the install stopped.
     */
    "update.install": {
      kinds: ["command", "ipc", "job"],
      reasons: ["foreign_sender", "superseded"],
      fields: {
        ipc: ipcFields,
        update: {
          from_version: operational(),
          to_version: operational(),
          track: operational<"stable" | "nightly">(),
          confirm: operational<"update" | "cancel">(),
          download_bytes: operational<number>(),
          download_ms: operational<number>(),
          stopped_at: operational<
            | "not_ready"
            | "confirm"
            | "recheck"
            | "download"
            | "prepare"
            | "install"
          >(),
          api_stop: operational<ApiStop>(),
          api_stop_ms: operational<number>(),
          /**
           * How the wait after the handoff ended: the app quit for the
           * installer, the installer failed to start, or the quit's time ran
           * out with the app still open.
           */
          handoff: operational<"app_quit" | "installer_failed" | "timed_out">(),
        },
      },
    },
    "update.get_state": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: { ipc: ipcFields },
    },
    "update.open_release": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender", "url_not_allowed"],
      fields: {
        ipc: ipcFields,
        update: { release_allowed: operational<boolean>() },
      },
    },
    /** A plugin installed from an archive the user picked, or downloaded from the catalog. */
    "plugin.install": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender", "development_build"],
      fields: {
        ipc: ipcFields,
        plugin: {
          id: operational(),
          version: operational(),
          source: operational<"archive" | "catalog">(),
          replaced: operational<boolean>(),
          archive_bytes: operational<number>(),
          dialog_ms: operational<number>(),
          download_ms: operational<number>(),
          install_ms: operational<number>(),
          result: operational<
            | "installed"
            | "updated"
            | "cancelled"
            | "busy"
            | "invalid_archive"
            | "not_available"
            | "api_unavailable"
            | "failed"
          >(),
        },
      },
    },
    "plugin.uninstall": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender", "development_build"],
      fields: {
        ipc: ipcFields,
        plugin: {
          id: operational(),
          result: operational<"uninstalled" | "api_unavailable" | "failed">(),
        },
      },
    },
    /** A native right-click menu: the item picked, never a label. */
    "context_menu.show": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        context_menu: {
          item_count: operational<number>(),
          kept_count: operational<number>(),
          picked: operational<boolean>(),
          /** The object action picked, such as `backlog.settle`. */
          action_id: operational(),
        },
      },
    },
    /** The app's theme, for native menus and the window chrome. */
    "window.set_theme": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        theme: { value: operational<"system" | "dark" | "light">() },
      },
    },
    "edit.run": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        edit: { command: operational<"cut" | "copy">() },
      },
    },
    "menu.run_item": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        menu: { item_id: operational() },
      },
    },
    "app.runtime_info": { kinds: ["ipc"], fields: { ipc: ipcFields } },
    "app.menu_model": { kinds: ["ipc"], fields: { ipc: ipcFields } },
    /** The desktop recovery input the renderer reads once at boot. */
    "local_state.recover": {
      kinds: ["ipc"],
      fields: {
        ipc: ipcFields,
        local_state: {
          source: operational<"recovery_file" | "legacy_profile" | "none">(),
          legacy_folder_count: operational<number>(),
          bytes_scanned: operational<number>(),
          /** Each collection's record count in the state found, never a record. */
          record_counts: operational<Record<string, number>>(),
          /** A reload after a crash gets this launch's first answer. */
          cached: operational<boolean>(),
        },
      },
    },

    // Calendar.

    /**
     * A calendar's events for a date range. Never a title (ADR 0005). The
     * renderer's hop adds whether it was forced and fresh from cache (#310).
     */
    "calendar.fetch": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        calendar: {
          range_days: operational<number>(),
          event_count: operational<number>(),
        },
      },
    },

    // Pull requests. A pull request's repository and number are a source
    // tool's keys, so they stay out.

    "pull_request.sync": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        pull_request: {
          tracked_count: operational<number>(),
          received_count: operational<number>(),
        },
      },
    },
    "pull_request.load": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        pull_request: { file_count: operational<number>() },
      },
    },
    "pull_request.load_file": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    "pull_request.load_conversation": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        pull_request: { thread_count: operational<number>() },
      },
    },
    "pull_request.browse": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    "pull_request.submit_review": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        pull_request: {
          verdict: operational<"approve" | "request_changes" | "comment">(),
          comment_count: operational<number>(),
        },
      },
    },
    "pull_request.comment": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    "pull_request.reply": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    "pull_request.resolve_thread": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    "pull_request.mark_file_viewed": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    "pull_request.update": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: { ...requestFields, ...pluginOperationFields },
    },
    "pull_request.merge": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        pull_request: { merge_method: operational() },
      },
    },

    // Teams and schemas.

    "team.create": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: [
        ...rendererEvents["team.create"].reasons,
        ...pluginRequestReasons,
      ],
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        ...rendererEvents["team.create"].fields,
      },
    },
    /** One round of a team sync. */
    "team.sync": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        team_sync: {
          /** The local changes sent this round. */
          projects_sent: operational<number>(),
          projects_received: operational<number>(),
          assigned_count: operational<number>(),
          has_more: operational<boolean>(),
        },
      },
    },
    /** The schema plugins a project import or export can use. */
    "schema.list": {
      kinds: ["request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        schema_list: { plugin_count: operational<number>() },
      },
    },
    "project.export": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        project_data: {
          project_count: operational<number>(),
          task_count: operational<number>(),
          row_count: operational<number>(),
        },
      },
    },
    "project.import": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: [
        ...rendererEvents["project.import"].reasons,
        ...pluginRequestReasons,
      ],
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        ...rendererEvents["project.import"].fields,
        project_data: {
          project_count: operational<number>(),
          task_count: operational<number>(),
          row_count: operational<number>(),
        },
      },
    },
  },
});

export type AjourCatalog = typeof catalog;

/** Any of Ajour's events, as a sink or a test reads it. */
export type AjourEvent = EventOf<AjourCatalog>;
