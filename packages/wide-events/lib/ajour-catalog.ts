import { defineCatalog, operational } from "./fields.ts";

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
      ],
      fields: {
        mcp: {
          /** The JSON-RPC method, such as `initialize` or `tools/list`; `other` for any Ajour doesn't know. */
          method: operational(),
        },
        agent: { client_id: operational() },
      },
    },
    /** One MCP tool call, named once the request's method is read. */
    "agent_tool.call": {
      kinds: ["request", "job"],
      reasons: [
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
    /** A calendar's events for a date range. Never a title (ADR 0005). */
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
    /** A synced backlog item's comments. Never their text or authors (ADR 0008). */
    "comment.list": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
        comment: { count: operational<number>() },
      },
    },
    "comment.post": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
      },
    },
    "comment.edit": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
      },
    },
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
    /** The people a mention can name. Never their names. */
    "person.search": {
      kinds: ["command", "request", "plugin_operation"],
      reasons: ["agent_access"],
      fields: {
        plugin: { id: operational() },
        connection: { id: operational() },
        person: { count: operational<number>() },
      },
    },
  },
});

export type AjourCatalog = typeof catalog;
