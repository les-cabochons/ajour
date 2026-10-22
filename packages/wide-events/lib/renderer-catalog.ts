import type { Kind } from "./envelope.ts";
import { operational, sensitive, type FieldTree } from "./fields.ts";

/**
 * The renderer's events: its store commands, boot, Undo, reloads,
 * preferences and uncaught errors (#307). They join Ajour's one catalog in
 * `ajour-catalog.ts`. Each store command of the local store maps to one of
 * these names in the store's typed command table.
 *
 * A store command's write counts, bytes and the records it changed are
 * counters, so a store command that folds into another unit, such as a sync,
 * adds them to that unit's event. No field holds content (ADR 0011): records
 * are named by Ajour's IDs, and the days, weeks and durations of time records
 * are sensitive.
 */

/** What `count` adds to: one name per counter, for every event. */
export const rendererCounters = {
  /** Writes of the local state to browser storage. */
  store_write_count: operational<number>(),
  /** What those writes stored: UTF-16 code units times two, as browser storage holds them. */
  store_write_bytes: operational<number>(),
  /**
   * Writes whose revision hint could not be saved, so other windows reload
   * before each write instead of trusting it.
   */
  store_revision_hint_failure_count: operational<number>(),
  /** The records an undoable action changed, or an Undo restored, per local state list. */
  changed_project_count: operational<number>(),
  changed_time_entry_count: operational<number>(),
  changed_tombstone_count: operational<number>(),
  changed_submitted_week_count: operational<number>(),
  changed_running_entry_count: operational<number>(),
  changed_import_draft_count: operational<number>(),
  changed_backlog_item_count: operational<number>(),
  changed_workflow_state_count: operational<number>(),
  changed_source_state_mapping_count: operational<number>(),
  changed_write_rule_count: operational<number>(),
  changed_calendar_decision_count: operational<number>(),
  changed_event_rule_count: operational<number>(),
  /** 1 when the action reordered the backlog. */
  changed_backlog_order_count: operational<number>(),
} as const;

/** Why the store refused a write: a submitted week, or another window's write. */
const WRITE_REFUSALS = ["locked_week", "stale_window"] as const;

/** Every store command's own fields, beyond the counters. */
const store = {
  store: {
    /** The write found that another window wrote since this one read. */
    revision_changed: operational<boolean>(),
    /** The command left an Undo behind. */
    undo_offered: operational<boolean>(),
  },
};

/** Where the entry form that saved a time entry sat. */
type EntryHost = "side_panel" | "dialog" | "popover" | "grid_cell" | "agent";

/**
 * A store command's catalog entry: kind `command`, the write refusals among
 * its reasons, and the store's fields with its own.
 */
function command<
  const Fields extends FieldTree,
  const Kinds extends readonly Kind[] = readonly ["command"],
  const Reasons extends readonly string[] = readonly [],
>(fields: Fields, options: { kinds?: Kinds; reasons?: Reasons } = {}) {
  return {
    kinds: (options.kinds ?? ["command"]) as Kinds,
    reasons: [...WRITE_REFUSALS, ...((options.reasons ?? []) as Reasons)] as [
      ...typeof WRITE_REFUSALS,
      ...Reasons,
    ],
    fields: { ...store, ...fields },
  };
}

const timeEntryCount = {
  time_entry: {
    count: operational<number>(),
    mode: operational<"copy" | "cut">(),
    to_day: sensitive(),
  },
};
const backlogItem = {
  backlog_item: { id: operational() },
};
const projectId = { project: { id: operational() } };
const changedProject = {
  project: { id: operational(), changed_fields: operational<string[]>() },
};
const changedTask = {
  project: { id: operational() },
  task: {
    id: operational(),
    changed_fields: operational<string[]>(),
    pinned_slot: operational<string | null>(),
  },
};
const connectionData = {
  plugin: { id: operational() },
  connection: { id: operational() },
  /** The records the delete took out of the local state, per kind. */
  removed: {
    pull_request_count: operational<number>(),
    calendar_decision_count: operational<number>(),
    event_rule_count: operational<number>(),
    team_project_count: operational<number>(),
  },
};
const importCounts = {
  timesheet_import: {
    row_count: operational<number>(),
    conflict_count: operational<number>(),
    committed_count: operational<number>(),
    dismissed_count: operational<number>(),
  },
};
const projectImport = {
  project_import: {
    /** `default`, or the plugin ID of the schema. */
    schema: operational(),
    row_count: operational<number>(),
    project_count: operational<number>(),
    task_count: operational<number>(),
    created_project_count: operational<number>(),
    merged_project_count: operational<number>(),
    added_task_count: operational<number>(),
    updated_task_count: operational<number>(),
  },
};
const backlogImport = {
  backlog_import: {
    candidate_count: operational<number>(),
    imported_count: operational<number>(),
    updated_count: operational<number>(),
    archived_count: operational<number>(),
  },
};
const workflowState = {
  workflow_state: {
    id: operational(),
    done: operational<boolean>(),
    closed_count: operational<number>(),
    write_rule: operational<"state" | "ask" | "none" | "cleared">(),
  },
};
const pullRequest = {
  pull_request: { id: operational() },
};

/** A settings key and its value, kept only when it is an enum, a number or a boolean. */
type PreferenceValue = string | number | boolean;

export const rendererEvents = {
  /** The renderer's boot: loading the local state until the first render. */
  "app.boot": {
    kinds: ["lifecycle"],
    fields: {
      boot: {
        load_path: operational<
          "stored" | "empty" | "unreadable" | "storage_unavailable"
        >(),
        /** The stored-state migrations this load applied, from a closed set. */
        migrations: operational<string[]>(),
        state_bytes: operational<number>(),
        /** False when the state lives in memory only: storage refused it. */
        persisted: operational<boolean>(),
        first_render_ms: operational<number>(),
      },
      recovery: {
        decision: operational<
          | "none"
          | "already_applied"
          | "used_whole"
          | "merged"
          | "nothing_to_merge"
        >(),
        reason: operational<
          "submitted_weeks" | "no_entries" | "default_projects"
        >(),
        /** Storage changed while it ran, so it ran once more. */
        retried: operational<boolean>(),
        left_out_entry_count: operational<number>(),
        left_out_running_entry_count: operational<number>(),
        unsubmitted_week_count: operational<number>(),
      },
      records: {
        project_count: operational<number>(),
        time_entry_count: operational<number>(),
        running_entry_count: operational<number>(),
        backlog_item_count: operational<number>(),
        pull_request_count: operational<number>(),
        submitted_week_count: operational<number>(),
        workflow_state_count: operational<number>(),
      },
    },
  },
  /** Another window's write, picked up from browser storage. */
  "local_state.reload": {
    kinds: ["job"],
    fields: {
      local_state: {
        revision_changed: operational<boolean>(),
        storage_cleared: operational<boolean>(),
      },
    },
  },
  /** An uncaught error or unhandled rejection. */
  "app.error": {
    kinds: ["crash"],
    fields: {
      crash: {
        origin: operational<"uncaught_exception" | "unhandled_rejection">(),
        /** The unit of work that was active, by name. */
        active_unit: operational(),
        handled_by_toast: operational<boolean>(),
      },
    },
  },
  "undo.restore": command(
    {
      undo: {
        result: operational<"restored" | "stale" | "expired">(),
      },
    },
    {
      reasons: [
        "expired",
        "changed_since",
        "two_running_entries",
        "would_lock_week",
      ],
    },
  ),
  /** The Undo window closed: its undo is dropped. */
  "undo.expire": command({}),
  /** Store commands run as one undoable action, as agent tools do. */
  "undo.group": command({}),
  /** User preferences and device UI settings. */
  "preferences.update": command({
    preferences: {
      scope: operational<"user" | "device">(),
      setting: operational<
        | "user_preferences"
        | "backlog_view"
        | "sidebar_layout"
        | "side_panel_width"
        | "app_sidebar"
      >(),
      changed_keys: operational<string[]>(),
      /** The changed keys whose values are enums, numbers or booleans. */
      values: operational<Record<string, PreferenceValue>>(),
    },
  }),

  // Time entries and weeks
  "time_entry.start": command({
    time_entry: {
      id: operational(),
      entry_id: operational(),
      project_id: operational(),
      task_id: operational(),
      backlog_item_id: operational(),
      replaced_running: operational<boolean>(),
      counted_ms: sensitive<number>(),
    },
  }),
  "time_entry.stop": command({
    time_entry: { id: operational(), duration_ms: sensitive<number>() },
  }),
  "time_entry.discard": command({
    time_entry: { id: operational(), duration_ms: sensitive<number>() },
  }),
  "time_entry.continue": command({ time_entry: { id: operational() } }),
  "time_entry.create": command({
    time_entry: {
      id: operational(),
      project_id: operational(),
      task_id: operational(),
      backlog_item_id: operational(),
      day: sensitive(),
      duration_ms: sensitive<number>(),
      host: operational<EntryHost>(),
    },
  }),
  "time_entry.update": command({
    time_entry: {
      id: operational(),
      running: operational<boolean>(),
      changed_fields: operational<string[]>(),
      duration_before_ms: sensitive<number>(),
      duration_after_ms: sensitive<number>(),
      host: operational<EntryHost>(),
    },
  }),
  "time_entry.delete": command({
    time_entry: { count: operational<number>() },
  }),
  "time_entry.duplicate": command(timeEntryCount),
  "time_entry.move": command(timeEntryCount),
  "time_entry.paste": command(timeEntryCount),
  "time_entry.drop": command(timeEntryCount),
  "time_entry.reorder": command(timeEntryCount),
  "time_entry.commit": command({
    time_entry: { count: operational<number>() },
  }),
  "time_entry.uncommit": command({
    time_entry: { count: operational<number>() },
  }),
  "week.submit": command({
    week: {
      week_of: sensitive(),
      result: operational<
        | "submitted"
        | "already_submitted"
        | "uncommitted_changes"
        | "running_entry"
      >(),
      uncommitted_count: operational<number>(),
      pace_warning_shown: operational<boolean>(),
    },
  }),
  "week.reopen": command({ week: { week_of: sensitive() } }),
  "week.prompt_commit": command({ week: { week_of: sensitive() } }),
  "timesheet_import.stage": command(importCounts),
  "timesheet_import.dismiss": command(importCounts),
  "timesheet_import.commit": command(importCounts),

  // Calendar
  "suggestion.add": command({
    suggestion: {
      count: operational<number>(),
      skipped_count: operational<number>(),
      remembered_series_count: operational<number>(),
      project_ids: operational<string[]>(),
      task_ids: operational<string[]>(),
    },
  }),
  "suggestion.dismiss": command({
    suggestion: { count: operational<number>() },
  }),
  "event_rule.hide": command({}),
  "event_rule.forget": command({ event_rule: { id: operational() } }),

  // Projects, tasks and teams
  "project.create": command(changedProject),
  "project.update": command(changedProject),
  "project.archive": command(changedProject),
  "project.restore": command(changedProject),
  "project.reorder": command({ project: { count: operational<number>() } }),
  "project.import": command(projectImport, {
    kinds: ["command", "request", "plugin_operation"],
  }),
  "project.share": command({
    ...projectId,
    connection: { id: operational() },
    share: {
      result: operational<
        | "shared"
        | "missing"
        | "already_shared"
        | "same_name_shared"
        | "same_name_held"
        | "not_synced"
      >(),
    },
  }),
  "project.unshare": command(projectId),
  "task.create": command(changedTask),
  "task.update": command(changedTask),
  "task.archive": command(changedTask),
  "task.restore": command(changedTask),
  "task.reorder": command(changedTask),
  "task.pin": command(changedTask),
  "task.import": command({
    ...projectId,
    task_import: {
      imported_count: operational<number>(),
      duplicate_count: operational<number>(),
      blank_count: operational<number>(),
      header_count: operational<number>(),
    },
  }),
  "team.create": command(
    {},
    {
      kinds: ["command", "request", "plugin_operation"],
    },
  ),
  "team.apply_sync": command({
    connection: { id: operational() },
    team_sync: {
      result: operational(),
    },
  }),
  "team.resolve_arrival": command({
    connection: { id: operational() },
    team: {
      choice: operational<"link" | "add_separately">(),
      result: operational(),
    },
  }),
  "connection.delete": command(connectionData, {
    kinds: ["command", "request"],
  }),

  // Backlog
  "backlog_item.create": command({
    backlog_item: {
      id: operational(),
      parent_id: operational(),
      closed: operational<boolean>(),
    },
  }),
  "backlog_item.update": command({
    backlog_item: {
      id: operational(),
      changed_fields: operational<string[]>(),
    },
  }),
  "backlog_item.move": command({
    backlog_item: {
      id: operational(),
      workflow_state_from: operational(),
      workflow_state_to: operational(),
      closed: operational<boolean>(),
      reopened: operational<boolean>(),
      subitems_included: operational<boolean>(),
      subitem_count: operational<number>(),
      source_writes_queued: operational<number>(),
      result: operational<"moved" | "unchanged" | "cancelled">(),
    },
  }),
  "backlog_item.settle": command({
    backlog_item: {
      id: operational(),
      behavior: operational<"local" | "rule" | "ask">(),
      state_changed: operational<boolean>(),
      priority_changed: operational<boolean>(),
      subitems_included: operational<boolean>(),
      subitem_count: operational<number>(),
      settle_id: operational(),
      archived: operational<boolean>(),
    },
    comment: {
      queued: operational<boolean>(),
      body_length: operational<number>(),
    },
  }),
  "backlog_item.unsettle": command(backlogItem),
  "backlog_item.archive": command(backlogItem),
  "backlog_item.restore": command(backlogItem),
  "backlog_item.delete": command(backlogItem),
  "backlog_item.snooze": command(backlogItem),
  "backlog_item.unsnooze": command(backlogItem),
  "backlog_item.pin": command(backlogItem),
  "backlog_item.unpin": command(backlogItem),
  "backlog_item.reorder": command({
    backlog_item: { count: operational<number>() },
  }),
  "backlog_item.open": command(backlogItem),
  "backlog_item.change_source_state": command(backlogItem),
  "backlog_item.apply_timelog": command(backlogItem),
  "backlog_item.resolve_estimate": command({
    backlog_item: {
      id: operational(),
      estimate_resolution: operational<
        "keep_local" | "accept_source" | "dismiss"
      >(),
    },
  }),
  "backlog_item.resolve_description": command(backlogItem),
  "backlog_item.save_description": command(backlogItem),
  "backlog_item.complete_source_write": command(backlogItem),
  "backlog_item.fail_source_write": command(backlogItem),
  "backlog_item.return": command({}),
  "backlog.sort": command({ backlog: { sort_mode: operational() } }),
  "backlog.archive_done": command(backlogImport),
  "backlog.apply_updates": command(backlogImport),
  "backlog_import.commit": command(backlogImport, {
    kinds: ["command", "request"],
  }),
  "workflow_state.create": command(workflowState),
  "workflow_state.update": command(workflowState),
  "workflow_state.delete": command(workflowState),
  "workflow_state.move": command(workflowState),
  "workflow_state.map": command(workflowState),
  "workflow_state.auto_map": command(workflowState),
  "workflow_state.set_write_rule": command(workflowState),
  "settle_rule.set": command({
    settle_rule: { mode: operational<"ask" | "apply">() },
  }),

  // Pull requests
  "pull_request.apply_sync": command({
    plugin: { id: operational() },
    connection: { id: operational() },
    pull_request: { received_count: operational<number>() },
  }),
  /** A pull request change whose type Ajour couldn't read. */
  "pull_request.change": command(pullRequest),
  "pull_request.open": command(pullRequest),
  "pull_request.settle": command(pullRequest),
  "pull_request.unsettle": command(pullRequest),
  "pull_request.snooze": command(pullRequest),
  "pull_request.unsnooze": command(pullRequest),

  // The retired activity timeline, kept for stored data.
  "timeline.import": command({}),
  "timeline.update": command({}),
  "timeline.dismiss": command({}),
  "timeline.commit": command({}),
  "timeline.save_rule": command({}),
} as const;
