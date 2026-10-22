import { defineCatalog, operational, type EventOf } from "./fields.ts";

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

/**
 * Ajour's event names, one table for every runtime: an operation keeps its
 * name in each runtime that sees it, and `kind` and `runtime` tell the hops
 * apart. Each entry lists the event's own fields, beyond the envelope, in
 * nested objects named for glossary terms. No field holds content: no text
 * anyone wrote, no name, URL, path, source tool key or secret (ADR 0011).
 *
 * The entries below are the local API's first events. The seams of #304 add
 * the rest.
 */
export const catalog = defineCatalog({
  counters: {},
  events: {
    /** An MCP request other than a tool call, or one refused before it reached a tool. */
    "mcp.request": {
      kinds: ["request"],
      reasons: [
        "browser_origin",
        "token_missing",
        "token_unknown",
        "token_revoked",
        "protocol_error",
        "duplicate_id",
      ],
      fields: {
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
      ],
      fields: {
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
    /**
     * A calendar's events for a date range. Never a title (ADR 0005). The
     * renderer's hop adds whether it was forced and fresh from cache (#310).
     */
    "calendar.fetch": {
      kinds: ["job", "request", "plugin_operation"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
        calendar: {
          range_days: operational<number>(),
          event_count: operational<number>(),
        },
      },
    },
    /**
     * A synced backlog item's comments. Never their text or authors (ADR
     * 0008). The renderer's hop adds Ajour's item ID and the cache hit (#310).
     */
    "comment.list": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
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
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
        comment: {
          body_length: operational<number>(),
          mention_count: operational<number>(),
        },
      },
    },
    "comment.edit": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
        comment: {
          body_length: operational<number>(),
          mention_count: operational<number>(),
        },
      },
    },
    /** Sent after the Undo window, so a job in the renderer. */
    "comment.delete": {
      kinds: ["job", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
      },
    },
    "comment.react": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
      },
    },
    /** The people a mention can name, for the editor's @ suggestions. Never their names. */
    "mention.search": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
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
    /** An error nothing else caught, or a startup that failed. */
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
  },
});

export type AjourCatalog = typeof catalog;

/** Any of Ajour's events, as a sink or a test reads it. */
export type AjourEvent = EventOf<AjourCatalog>;
