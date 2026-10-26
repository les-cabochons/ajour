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

/** Why plugins are off on this computer (apps/desktop/electron/plugin-sandbox.cjs). */
export type PluginSandboxCause =
  | "launch_flag"
  | "debugger"
  | "environment"
  | "unsupported_os"
  | "renderer_not_sandboxed"
  | "renderer_integrity"
  | "renderer_unknown"
  | "shared_process";

/** Whether the local log file writes (local-log-file.ts). */
export type LocalLogState = "off" | "on" | "warning";

/** Why the local log file stopped writing. */
export type LocalLogWarning = "disk_full" | "no_permission" | "write_failed";

/** What every IPC event carries: the channel, never its arguments. */
const ipcFields = {
  channel: operational(),
  /** `invoke` returns a promise, `message` is one-way, `sync` blocks the renderer. */
  mode: operational<"invoke" | "message" | "sync">(),
  /** False when a window other than the active one sent it. */
  sender_accepted: operational<boolean>(),
} as const;

/**
 * What the renderer forwarded to the local log file since launch (#440),
 * counted here instead of on an event per batch.
 */
const forwardedFields = {
  /** Batches received from the window and read. */
  batch_count: operational<number>(),
  /** Batches that arrived before the file opened, or after it failed to load. */
  dropped_batch_count: operational<number>(),
  /** Batches refused whole because they held too many events. */
  rejected_batch_count: operational<number>(),
  /** Events the file queued to write. */
  event_count: operational<number>(),
  /**
   * Valid events the file didn't queue: writing had stopped on a warning,
   * or its queue was full.
   */
  dropped_event_count: operational<number>(),
  /**
   * Events left out: an invalid envelope, a name or kind the renderer
   * doesn't emit, or the events of a batch refused whole.
   */
  rejected_event_count: operational<number>(),
  /** Events the renderer dropped because their batch couldn't be sent. */
  unsent_event_count: operational<number>(),
} as const;

/** An HTTP method, from a closed set: any other is `other`. */
export type HttpMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "other";

/** Where a broker request went: the connection's address, a derived host, a secret address, or a public host. */
export type PluginRequestHostKind =
  "base" | "derived" | "secret_address" | "public";

/**
 * How far the broker could judge the address that answered a request:
 * `checked` against private addresses, `proxy` when a system proxy answered
 * for it, which isn't judged, or `unknown` when the network stack named no
 * address, so only the check before the request held (ADR 0010).
 */
export type PluginRequestAnswerAddress = "checked" | "proxy" | "unknown";

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
const inactiveReasons = [
  "system_off",
  "plugin_off",
  "needs_consent",
  "capability_off",
] as const;

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
    /** Why the plugin's process ended under the run, when it `crashed`. */
    crash_cause: operational<"crashed" | "oom" | "killed" | "memory">(),
  },
} as const;

/**
 * Every way a plugin operation ends other than `ok`. Refused: `capacity`,
 * the inactive reasons, `host_stopping`, `package_change`, `not_installed`,
 * `runs_no_code`, `not_supported` for a capability or feature the plugin
 * doesn't declare, `agent_access` when its route's admission check
 * refuses it, `runtime_unavailable` when this computer can't sandbox
 * plugins, and `suspended` while the plugin keeps stopping. Cancelled: the inactive reasons, `uninstalled` and `shutdown`.
 * Then `timeout`, and the errors `result_too_large`, `invalid_result`,
 * `exited_early`, `crashed` and `plugin_error`.
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
  /**
   * The connection's access doesn't include the choice the operation needs,
   * such as editing work items (#395); or a save turned it off while the
   * operation ran.
   */
  "access_off",
  /** Plugins are off: this computer can't run them in a sandbox. */
  "runtime_unavailable",
  /** The plugin stopped 3 times in 10 minutes, so it runs nothing until Turn back on. */
  "suspended",
  "uninstalled",
  "shutdown",
  "timeout",
  "result_too_large",
  "invalid_result",
  "exited_early",
  /** The plugin's process ended under the run: `worker.crash_cause` says how. */
  "crashed",
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
  /** The connection's secrets can't reach the plugin now, so it is paused. */
  "secret_unavailable",
  /** A save with a secret the vault can't encrypt on this computer. */
  "vault_unavailable",
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
    /** A plugin's 401 that couldn't be saved as a rejected secret. */
    secrets_rejected_mark_failed: operational<number>(),
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
          /** How long the running requests and plugin operations took to finish, up to the drain's 5 s. */
          drain_ms: operational<number>(),
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
          /** Temp files an interrupted save left that couldn't be deleted. */
          orphans_undeletable_count: operational<number>(),
        },
        /** The vault, opened with the state: `none` for an API without one. */
        vault: {
          state: operational<
            "available" | "unavailable" | "unreadable" | "none"
          >(),
          entry_count: operational<number>(),
          orphans_undeletable_count: operational<number>(),
        },
        /** The move of plain-text secrets into the vault, when a load ran it. */
        vault_migration: {
          /** Connections and agent task settings moved, or checked and clean. */
          moved_count: operational<number>(),
          /** Those still holding a secret in plain text, paused until the next launch. */
          pending_count: operational<number>(),
          /** Whether the state file without the moved secrets was saved. */
          saved: operational<boolean>(),
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
        /** In the renderer: the tool refused the call, with a sentence for the agent. */
        "tool_refused",
        /** An agent task run's client called a tool its task doesn't declare. */
        "tool_not_declared",
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
          /** In the renderer: how long the call waited behind earlier calls. */
          queue_ms: operational<number>(),
          /** In the renderer: the write left an Undo behind. */
          undo_offered: operational<boolean>(),
        },
      },
    },
    /**
     * The renderer's bridge stream, from open to close. The renderer's job
     * ends `disconnected` when the API closed the stream for good.
     */
    "mcp_bridge.connection": {
      kinds: ["job", "request"],
      reasons: ["mcp_off", "no_origin", "disconnected", ...requestReasons],
      fields: {
        ...requestFields,
        mcp_bridge: {
          /** The tool calls the stream carried to the renderer. */
          call_count: operational<number>(),
          /** In the renderer: how often the stream reconnected on its own. */
          reconnect_count: operational<number>(),
        },
      },
    },
    /** The renderer's answer to a tool call it was sent over the bridge. */
    "mcp_bridge.result": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        /** False when the call had already timed out. */
        mcp_bridge: { resolved: operational<boolean>() },
      },
    },
    "mcp.status": {
      kinds: ["command", "request"],
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
      reasons: ["no_agent_task", "vault_unavailable", ...requestReasons],
      fields: {
        ...requestFields,
        plugin: { id: operational() },
        agent_task: { field_count: operational<number>() },
      },
    },

    // Plugins, connections and activation.

    /** The plugins overview, or the runnable plugins' manifests. */
    "plugin.list": {
      kinds: ["command", "request"],
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
      reasons: [
        "not_installed",
        "not_supported",
        /** The plugin was updated since the user reviewed its access. */
        "version_changed",
        ...requestReasons,
      ],
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
    /** An API 4 plugin's Advanced section saved: Start and Memory ceiling. */
    "plugin.runtime_update": {
      kinds: ["command", "request"],
      reasons: ["not_installed", "not_supported", ...requestReasons],
      fields: {
        ...requestFields,
        plugin: { id: operational() },
        plugin_runtime: {
          start: operational<"plugin" | "whenNeeded" | "alwaysReady">(),
          memory_ceiling_mb: operational<number>(),
        },
      },
    },
    /** Turn back on, for a plugin that kept stopping. */
    "plugin.resume": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        plugin: { id: operational() },
        /** False when the plugin wasn't suspended. */
        plugin_runtime: { resumed: operational<boolean>() },
      },
    },
    /**
     * A plugin's renderer stopped 3 times in 10 minutes, by crashes, memory
     * kills or timeouts, so the plugin runs nothing until Turn back on or a
     * restart of Ajour.
     */
    "plugin.suspended": {
      kinds: ["lifecycle"],
      fields: {
        plugin: { id: operational() },
        suspension: {
          /** The last stop's cause. */
          cause: operational<
            "crashed" | "oom" | "killed" | "memory" | "timeout"
          >(),
          stops: operational<number>(),
        },
      },
    },
    /**
     * One request an API 4 plugin sent through Ajour's broker: through one
     * of its connections, or a public fetch. The path is the manifest's
     * endpoint pattern it matched, never the path sent, and no header, body
     * or query value is kept.
     */
    "plugin.request": {
      kinds: ["job"],
      reasons: [
        /** The request isn't one: no connection id, an unknown method, a bad query or body. */
        "invalid_request",
        /** The plugin has no connection with that id: another plugin's looks the same. */
        "connection_not_found",
        /** The connection's credential can't be read now, so it is paused. */
        "secret_unavailable",
        ...inactiveReasons,
        /** The manifest allows no such endpoint, host or address. */
        "not_allowed",
        /** A header the denylist holds or the manifest doesn't list. */
        "header_refused",
        /** The endpoint is behind an access choice the connection hasn't turned on. */
        "access_off",
        /** The connection's saved address can't be used. */
        "invalid_address",
        /** The host resolved, or answered, from a private address. */
        "private_address",
        /** A secret address redirected too often, or away from https. */
        "redirect_refused",
        /** Outside the desktop app, which has no network stack for plugins. */
        "no_transport",
        "request_too_large",
        "response_too_large",
        /** The answer couldn't be checked for secrets within the redaction's budget, so it was dropped. */
        "unchecked_response",
        "rate_limited",
        "too_many_queued",
        /** The plugin operation that sent it ended first. */
        "operation_ended",
        /** The plugin aborted it. */
        "aborted",
        "timeout",
        /** The service couldn't be reached. */
        "network",
      ],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
        broker: {
          method: operational<HttpMethod>(),
          host_kind: operational<PluginRequestHostKind>(),
          /** The manifest's endpoint pattern the path matched, such as `/rest/api/3/issue/*`. */
          path_template: operational(),
          status_code: operational<number>(),
          /** Redirects the broker followed. */
          redirects: operational<number>(),
          request_bytes: operational<number>(),
          response_bytes: operational<number>(),
          on_premises: operational<boolean>(),
          /** Sent while a connection was validated, before it was saved. */
          pending: operational<boolean>(),
          /** How long it waited for one of the plugin's request slots. */
          queued_ms: operational<number>(),
          /** Absent on-premises, where no address is judged. Its least judged exchange's. */
          answer_address: operational<PluginRequestAnswerAddress>(),
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
    /** Unsigned plugins allowed to run again, or all of them deactivated. */
    "unsigned_plugins.toggle": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        activation: {
          enabled: operational<boolean>(),
          /** Installed plugins without a signed origin, when turned off. */
          unsigned_plugin_count: operational<number>(),
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
        /** The vault can't drop the connection's secrets this launch. */
        "vault_unavailable",
        ...requestReasons,
      ],
      fields: {
        ...requestFields,
        ...rendererEvents["connection.delete"].fields,
      },
    },
    /** Saved secrets of a connection deleted, which pauses it until a new one is saved. */
    "connection.remove_secrets": {
      kinds: ["command", "request"],
      reasons: [
        "connection_not_found",
        /** The field isn't one the plugin marks secret. */
        "not_secret",
        /** The vault can't drop the secrets this launch. */
        "vault_unavailable",
        ...requestReasons,
      ],
      fields: {
        ...requestFields,
        plugin: { id: operational() },
        connection: { id: operational() },
        secret: { field_count: operational<number>() },
      },
    },
    /** The connections and saved secrets of a plugin whose package is missing deleted. */
    "plugin.remove_data": {
      kinds: ["command", "request"],
      reasons: [
        /** The plugin is installed: uninstall it instead. */
        "installed",
        "vault_unavailable",
        ...requestReasons,
      ],
      fields: {
        ...requestFields,
        plugin: { id: operational() },
      },
    },
    /** The vault opened again, after a failure that may have passed. */
    "vault.retry": {
      kinds: ["command", "request"],
      reasons: requestReasons,
      fields: {
        ...requestFields,
        vault: {
          state: operational<"available" | "unavailable" | "unreadable">(),
        },
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
          /**
           * The items whose estimates the sync didn't upload: the connection
           * can't edit work items, or the change waits for review (#395).
           */
          held_estimate_count: operational<number>(),
          /** In the renderer: the items the answer added straight to the backlog. */
          imported_count: operational<number>(),
        },
      },
    },
    /**
     * A settle's state or priority, written to the source after the Undo
     * window. The renderer's job starts its own trace and joins the settle
     * that caused it by the settle ID (#310).
     */
    "backlog.write_source": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: [...pluginRequestReasons, "superseded"],
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        backlog_item: { id: operational(), settle_id: operational() },
        source_write: {
          state_sent: operational<boolean>(),
          priority_sent: operational<boolean>(),
          /** In the renderer: from the end of the Undo window until the send. */
          delay_ms: operational<number>(),
          /** In the renderer: `deferred` waits for the Undo window, `superseded` for a newer write. */
          result: operational<
            "sent" | "failed" | "deferred" | "superseded" | "held"
          >(),
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
     * 0008). The renderer's hop adds Ajour's item ID, never the item's ID in
     * its source (ADR 0011), and whether the cache answered (#310).
     */
    "comment.list": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        backlog_item: { id: operational() },
        comment: {
          /** The newest comments, or an earlier page through a cursor. */
          page: operational<"latest" | "earlier">(),
          comment_count: operational<number>(),
          /**
           * In the renderer: the thread showed its cached newest page, so no
           * request followed. A cache hit is a `command` event without one.
           */
          cache_hit: operational<boolean>(),
        },
      },
    },
    /**
     * A comment posted on a synced backlog item: its length, never its text.
     * The renderer's hop adds Ajour's item ID (#310).
     */
    "comment.post": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        backlog_item: { id: operational() },
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
        backlog_item: { id: operational() },
        comment: {
          body_length: operational<number>(),
          mention_count: operational<number>(),
        },
      },
    },
    /**
     * Sent after the Undo window, so a job in the renderer, which names
     * Ajour's backlog item: the comment's ID in its source stays out (ADR
     * 0011).
     */
    "comment.delete": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        backlog_item: { id: operational() },
        /** In the renderer: from the delete until it was sent. */
        comment: { queued_ms: operational<number>() },
      },
    },
    "comment.react": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        backlog_item: { id: operational() },
      },
    },
    /** The people a mention can name, for the editor's @ suggestions. Never their names. */
    "mention.search": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: pluginRequestReasons,
      fields: {
        ...requestFields,
        ...pluginOperationFields,
        backlog_item: { id: operational() },
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
        /** The plugin whose renderer it was, for a `plugin_renderer`. */
        plugin: { id: operational() },
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
    /**
     * One message from a plugin's hidden page to its host (#390): never its
     * arguments. A sender that isn't a registered plugin page's main frame on
     * its own origin is `foreign_sender`; a run the page doesn't have,
     * another plugin's included, is `unknown_run`.
     */
    "plugin_renderer.call": {
      kinds: ["ipc"],
      reasons: ["foreign_sender", "unknown_run"],
      fields: {
        ipc: ipcFields,
        plugin: { id: operational() },
        plugin_renderer: {
          message: operational<
            | "ready"
            | "next"
            | "settled"
            | "http"
            | "publicFetch"
            | "abort"
            | "blocked"
            | "other"
          >(),
        },
      },
    },
    /** A plugin's renderer opening, until its page loaded and its sandbox was checked. */
    "plugin_renderer.open": {
      kinds: ["lifecycle"],
      reasons: [
        "ready_timeout",
        "load_failed",
        /** Its process doesn't report the sandbox, so every plugin turned off. */
        "not_sandboxed",
      ],
      fields: {
        plugin: { id: operational() },
        plugin_renderer: {
          open_ms: operational<number>(),
          /** Its start mode is "Always ready": it never closes for being idle. */
          always_ready: operational<boolean>(),
        },
        sandbox: { cause: operational<PluginSandboxCause>() },
      },
    },
    /**
     * A plugin's renderer that had opened, closed (#391): idle for 2 minutes,
     * a call past its time, above its memory ceiling, its process gone, its
     * page failed to load, its package changed, its plugin turned off or
     * suspended, plugins off, or Ajour quitting.
     */
    "plugin_renderer.close": {
      kinds: ["lifecycle"],
      fields: {
        plugin: { id: operational() },
        plugin_renderer: {
          close_reason: operational<
            | "idle"
            | "package_change"
            | "plugin_off"
            | "quit"
            | "timeout"
            | "memory"
            | "crashed"
            | "failed"
            | "sandbox_off"
          >(),
          /** From the start of its opening to its close. */
          life_ms: operational<number>(),
          always_ready: operational<boolean>(),
          memory_ceiling_mb: operational<number>(),
          /** Its process's memory at the last sample, when one was read. */
          memory_mb: operational<number>(),
        },
      },
    },
    /**
     * The launch's sweep of plugin renderers a previous session left
     * running (#391), by the process ids it recorded: how many it found
     * listed, ended, found gone already, and left alone because another
     * program now holds the id, and how many it let go of without asking:
     * no start time, more than a week old, or past the newest 64.
     */
    "plugin_renderer.sweep": {
      kinds: ["lifecycle"],
      reasons: ["unreadable_record", "query_failed", "still_running"],
      fields: {
        sweep: {
          recorded: operational<number>(),
          ended: operational<number>(),
          gone: operational<number>(),
          not_ours: operational<number>(),
          still_running: operational<number>(),
          expired: operational<number>(),
          sweep_ms: operational<number>(),
        },
      },
    },
    /**
     * A way out a plugin's sandbox closed: the kind of exit, never where it
     * led. The renderer goes on.
     */
    "plugin_renderer.blocked": {
      kinds: ["navigation"],
      reasons: ["blocked"],
      fields: {
        plugin: { id: operational() },
        blocked: {
          /** `request`: its session cancelled one; `policy`: its page's policy refused one. */
          exit: operational<
            | "request"
            | "policy"
            | "permission"
            | "device"
            | "download"
            | "navigation"
            | "window_open"
          >(),
        },
      },
    },
    /** Plugins turned off: this computer can't run them in a sandbox. */
    "plugin_sandbox.off": {
      kinds: ["lifecycle"],
      reasons: [
        "launch_flag",
        "debugger",
        "environment",
        "unsupported_os",
        "renderer_not_sandboxed",
        "renderer_integrity",
        "renderer_unknown",
        "shared_process",
      ],
      fields: { sandbox: { cause: operational<PluginSandboxCause>() } },
    },
    /**
     * Every plugin source read again: from the network, the saved listings or
     * the built-in snapshot. Counts only: a source's address is content.
     */
    "catalog.refresh": {
      kinds: ["job"],
      fields: {
        catalog: {
          trigger: operational<"launch" | "interval" | "request">(),
          source: operational<"network" | "cache" | "built_in">(),
          entry_count: operational<number>(),
          sources_total: operational<number>(),
          sources_read: operational<number>(),
          /** Unreachable, so their saved listing was used. */
          sources_cached: operational<number>(),
          /** Unreachable with nothing saved, or with an unreadable listing. */
          sources_unreachable: operational<number>(),
          sources_signed: operational<number>(),
          sources_unsigned: operational<number>(),
          /** A changed key, a lost signature or one that does not match. */
          sources_blocked: operational<number>(),
          images_fetched: operational<number>(),
          images_cached: operational<number>(),
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
          allow_unsigned_installs_before: operational<boolean>(),
          allow_unsigned_installs_after: operational<boolean>(),
        },
      },
    },
    /** A plugin source read before the person adds it. Never its address. */
    "catalog.inspect_source": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        source: {
          host_kind: operational<"github" | "gitlab" | "gitea">(),
          official: operational<boolean>(),
          signed: operational<boolean>(),
          plugin_count: operational<number>(),
          result: operational<"read" | "failed">(),
        },
      },
    },
    /** A plugin source added, or the key it is signed with approved. */
    "catalog.add_source": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        source: {
          host_kind: operational<"github" | "gitlab" | "gitea">(),
          official: operational<boolean>(),
          signed: operational<boolean>(),
          source_count: operational<number>(),
          result: operational<
            "added" | "key_approved" | "key_mismatch" | "failed"
          >(),
        },
      },
    },
    "catalog.remove_source": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        source: {
          official: operational<boolean>(),
          source_count: operational<number>(),
          result: operational<"removed" | "not_found">(),
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
    /** Saving the local log file's settings (ADR 0014). */
    "logs.configure": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender", "invalid_settings"],
      fields: {
        ipc: ipcFields,
        logs: {
          enabled_before: operational<boolean>(),
          enabled_after: operational<boolean>(),
          retention_days: operational<number>(),
          size_limit_mb: operational<number>(),
          include_sensitive: operational<boolean>(),
        },
      },
    },
    /** The local log file's settings, state and what its folder holds. */
    "logs.status": {
      kinds: ["ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        logs: {
          state: operational<LocalLogState>(),
          warning: operational<LocalLogWarning>(),
          file_count: operational<number>(),
          storage_bytes: operational<number>(),
          /** Events dropped since launch because too many waited to be written. */
          dropped_event_count: operational<number>(),
          forwarded: forwardedFields,
        },
      },
    },
    /** Delete all logs: the local log file's folder goes. */
    "logs.delete_all": {
      kinds: ["command", "ipc"],
      reasons: ["foreign_sender"],
      fields: {
        ipc: ipcFields,
        logs: {
          deleted_file_count: operational<number>(),
          deleted_bytes: operational<number>(),
        },
      },
    },
    /** A retention sweep of the local log file's folder: at launch, hourly, or once its limits change. */
    "logs.sweep": {
      kinds: ["job"],
      fields: {
        logs: {
          trigger: operational<"launch" | "interval" | "settings">(),
          deleted_file_count: operational<number>(),
          deleted_bytes: operational<number>(),
          file_count: operational<number>(),
          storage_bytes: operational<number>(),
          /** Events dropped since launch, as in `logs.status`. */
          dropped_event_count: operational<number>(),
          forwarded: forwardedFields,
        },
      },
    },
    /**
     * A batch of the renderer's events that main did not take, for the local
     * log file (#440): from a sender other than the window, or a call that
     * failed. A batch it takes emits nothing, so forwarding never writes a
     * line per batch: `logs.sweep` counts them in `logs.forwarded`.
     */
    "wide_events.forward": {
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
          /** Whether the plugin came from a source whose signature verified. */
          signed: operational<boolean>(),
          result: operational<
            | "installed"
            | "updated"
            | "cancelled"
            | "busy"
            | "invalid_archive"
            | "not_available"
            | "unsigned_not_allowed"
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
          record_counts: operational<Record<string, number>>("numbers"),
          /** A reload after a crash gets this launch's first answer. */
          cached: operational<boolean>(),
        },
      },
    },

    // Calendar.

    /**
     * A calendar's events for a date range. Never a title (ADR 0005). The
     * renderer's hop adds whether it was forced (#310). A fetch the cache
     * answers emits nothing, so the 30-second refresh doesn't emit an event
     * each time: there is no fresh-from-cache field.
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
          /** In the renderer: Refresh fetched it, whatever the cache held. */
          forced: operational<boolean>(),
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
          /** In the renderer: a reinstalled plugin's connection took back the records it kept. */
          reattached: operational<boolean>(),
          /** In the renderer: why the answer was not applied. */
          discarded: operational<
            "generation_changed" | "capability_off" | "connection_gone"
          >(),
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
          // In the renderer, for the whole sync: its rounds and what they did.
          round_count: operational<number>(),
          created_count: operational<number>(),
          updated_count: operational<number>(),
          held_arrival_count: operational<number>(),
          unsendable_count: operational<number>(),
          /** Changes or pages were left for the next sync. */
          incomplete: operational<boolean>(),
          /** The connection now names another team, so its links were dropped. */
          identity_changed: operational<boolean>(),
        },
      },
    },
    /** The schema plugins a project import or export can use. */
    "schema.list": {
      kinds: ["command", "request"],
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
