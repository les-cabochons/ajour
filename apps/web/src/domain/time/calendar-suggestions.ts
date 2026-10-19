import {
  calendarOccurrenceKey,
  isCapabilityActive,
  type CalendarEventFacts,
  type PluginsOverview,
} from "@ajour/shared";
import { applyLoggedTimeToWorkItems } from "@/domain/backlog/work-item-estimates";
import type {
  CalendarSuggestionSettings,
  LocalAppState,
  LocalCalendarDecision,
  LocalCalendarEventRule,
  LocalProject,
} from "@/domain/local-state";
import { formatLocalDateFromTimestamp } from "@/domain/time/duration";
import { isDateLocked } from "@/domain/time/locked-weeks";
import {
  createTimesheetEntry,
  type TimesheetEntryFactories,
} from "@/domain/time/timesheet-entry";

/*
 * Calendar suggestions: the calendar events a calendar plugin reports, shown
 * on their day for the user to add as time entries or dismiss. Ajour never
 * stores the events (ADR 0005). It keeps the user's decision per occurrence
 * and an event rule per recurring meeting, which the UI calls a remembered or
 * hidden meeting. See docs/specs/2026-10-15-calendar-suggestions-design.md.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Decisions are kept this many days past the occurrence's day. */
export const CALENDAR_DECISION_RETENTION_DAYS = 90;

export const DEFAULT_CALENDAR_SUGGESTION_SETTINGS: CalendarSuggestionSettings =
  {
    hideAllDay: true,
    hideDeclined: true,
    hideFree: true,
    hideUnanswered: false,
    minimumMinutes: 0,
    refreshMinutes: 10,
  };

export function normalizeCalendarSuggestionSettings(
  value: unknown,
): CalendarSuggestionSettings {
  const defaults = DEFAULT_CALENDAR_SUGGESTION_SETTINGS;
  const record =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<keyof CalendarSuggestionSettings, unknown>>)
      : {};
  const flag = (key: keyof CalendarSuggestionSettings, fallback: boolean) =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : fallback;
  const minutes = (
    key: keyof CalendarSuggestionSettings,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(max, Math.max(min, Math.round(raw)))
      : fallback;
  };
  return {
    hideAllDay: flag("hideAllDay", defaults.hideAllDay),
    hideDeclined: flag("hideDeclined", defaults.hideDeclined),
    hideFree: flag("hideFree", defaults.hideFree),
    hideUnanswered: flag("hideUnanswered", defaults.hideUnanswered),
    minimumMinutes: minutes("minimumMinutes", defaults.minimumMinutes, 0, 480),
    refreshMinutes: minutes("refreshMinutes", defaults.refreshMinutes, 1, 1440),
  };
}

/** Where a fetched event came from. */
export interface CalendarSource {
  pluginId: string;
  connectionId: string;
  connectionLabel: string;
}

/** One connection's events for the range the Time view shows. */
export interface FetchedCalendarEvents extends CalendarSource {
  events: CalendarEventFacts[];
}

/** Why a filter in Settings hides a suggestion. */
export type CalendarHiddenReason =
  "allDay" | "declined" | "free" | "unanswered" | "short";

export interface CalendarSuggestion extends CalendarSource {
  /** Unique across connections. */
  key: string;
  occurrenceKey: string;
  seriesId?: string;
  localDate: string;
  startsAt: number;
  endsAt: number;
  /** Rounded to the minute. */
  durationMs: number;
  /** "Busy" when the calendar hides the title. */
  title: string;
  /** The calendar gave no title. */
  untitled: boolean;
  allDay: boolean;
  /** Filled from the remembered meeting, when it still points at an active project. */
  projectId?: string;
  taskId?: string;
  /** The remembered meeting's event rule, which Forget removes. */
  ruleId?: string;
  /** A filter hides it. The Time view counts these and shows them on request. */
  hiddenBy?: CalendarHiddenReason;
}

/** Calendar connections the user can see suggestions from now. */
export function enabledCalendarGroups(overview: PluginsOverview | null) {
  return overview?.pluginsEnabled === false
    ? []
    : (overview?.connectionGroups ?? []).filter(
        (group) =>
          isCapabilityActive(group, "calendar") &&
          group.plugin.unavailableReason === undefined,
      );
}

function suggestionKey(
  source: Pick<CalendarSource, "pluginId" | "connectionId">,
  occurrenceKey: string,
) {
  return JSON.stringify([source.pluginId, source.connectionId, occurrenceKey]);
}

function sameSource(
  left: Pick<CalendarSource, "pluginId" | "connectionId">,
  right: Pick<CalendarSource, "pluginId" | "connectionId">,
) {
  return (
    left.pluginId === right.pluginId && left.connectionId === right.connectionId
  );
}

function findRule(
  rules: readonly LocalCalendarEventRule[],
  source: Pick<CalendarSource, "pluginId" | "connectionId">,
  seriesId: string | undefined,
) {
  return seriesId === undefined
    ? undefined
    : rules.find(
        (rule) => sameSource(rule, source) && rule.seriesId === seriesId,
      );
}

/** The rule's project and task, if both are still there and active. */
function activeAssignment(
  projects: readonly LocalProject[],
  rule: LocalCalendarEventRule | undefined,
) {
  if (rule?.action !== "assign" || !rule.projectId) return undefined;
  const project = projects.find((item) => item._id === rule.projectId);
  if (!project || project.status !== "active") return undefined;
  if (rule.taskId) {
    const task = project.tasks.find((item) => item._id === rule.taskId);
    if (!task || task.status === "archived") return undefined;
  }
  return { projectId: rule.projectId, taskId: rule.taskId };
}

function hiddenReason(
  event: CalendarEventFacts,
  allDay: boolean,
  durationMs: number,
  settings: CalendarSuggestionSettings,
): CalendarHiddenReason | undefined {
  if (allDay && settings.hideAllDay) return "allDay";
  if (event.response === "declined" && settings.hideDeclined) return "declined";
  if (!event.busy && settings.hideFree) return "free";
  if (event.response === "needsAction" && settings.hideUnanswered) {
    return "unanswered";
  }
  if (durationMs < settings.minimumMinutes * MINUTE_MS) return "short";
  return undefined;
}

/**
 * The suggestions for fetched events, oldest first. Cancelled occurrences,
 * occurrences the user dismissed or added (while the entry exists) and hidden
 * meetings are left out. Filtered ones are kept with `hiddenBy`. Days of a
 * submitted week get none.
 */
export function buildCalendarSuggestions(
  state: Pick<
    LocalAppState,
    | "projects"
    | "timesheetEntries"
    | "calendarDecisions"
    | "calendarEventRules"
    | "lockedWeeks"
  >,
  fetched: readonly FetchedCalendarEvents[],
  settings: CalendarSuggestionSettings = DEFAULT_CALENDAR_SUGGESTION_SETTINGS,
): CalendarSuggestion[] {
  const entryIds = new Set(state.timesheetEntries.map((entry) => entry._id));
  const decided = new Set(
    (state.calendarDecisions ?? [])
      .filter(
        (decision) =>
          decision.decision === "dismissed" ||
          (decision.entryId !== undefined && entryIds.has(decision.entryId)),
      )
      .map((decision) => suggestionKey(decision, decision.occurrenceKey)),
  );
  const rules = state.calendarEventRules ?? [];
  const seen = new Set<string>();
  const suggestions: CalendarSuggestion[] = [];

  for (const source of fetched) {
    for (const event of source.events) {
      if (event.status === "cancelled") continue;
      const occurrenceKey = calendarOccurrenceKey(event);
      const key = suggestionKey(source, occurrenceKey);
      if (seen.has(key) || decided.has(key)) continue;
      seen.add(key);

      const rule = findRule(rules, source, event.seriesId);
      if (rule?.action === "hide") continue;
      const localDate = formatLocalDateFromTimestamp(event.startsAt);
      // A submitted week takes no new entry, so it has nothing to suggest.
      if (isDateLocked(state, localDate)) continue;

      const spanMs = Math.max(0, event.endsAt - event.startsAt);
      const allDay = event.allDay || spanMs > DAY_MS;
      const durationMs = Math.round(spanMs / MINUTE_MS) * MINUTE_MS;
      const title = event.title.trim();
      const assignment = activeAssignment(state.projects, rule);
      const reason = hiddenReason(event, allDay, durationMs, settings);
      suggestions.push({
        key,
        pluginId: source.pluginId,
        connectionId: source.connectionId,
        connectionLabel: source.connectionLabel,
        occurrenceKey,
        ...(event.seriesId ? { seriesId: event.seriesId } : {}),
        localDate,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        durationMs,
        title: title || "Busy",
        untitled: !title,
        allDay,
        ...assignment,
        ...(rule?.action === "assign" ? { ruleId: rule._id } : {}),
        ...(reason ? { hiddenBy: reason } : {}),
      });
    }
  }

  return suggestions.sort(
    (left, right) =>
      left.startsAt - right.startsAt ||
      left.endsAt - right.endsAt ||
      left.key.localeCompare(right.key),
  );
}

/** Suggestions by day, visible ones and the ones a filter hides. */
export function groupCalendarSuggestionsByDay(
  suggestions: readonly CalendarSuggestion[],
) {
  const days = new Map<
    string,
    { visible: CalendarSuggestion[]; hidden: CalendarSuggestion[] }
  >();
  for (const suggestion of suggestions) {
    const day = days.get(suggestion.localDate) ?? { visible: [], hidden: [] };
    (suggestion.hiddenBy ? day.hidden : day.visible).push(suggestion);
    days.set(suggestion.localDate, day);
  }
  return days;
}

/**
 * What the Calendar panel adds: every visible suggestion with a project that
 * the user did not uncheck, and their total time.
 */
export function selectCheckedSuggestions(
  suggestions: readonly CalendarSuggestion[],
  uncheckedKeys: ReadonlySet<string>,
) {
  const checked = suggestions.filter(
    (suggestion) =>
      !suggestion.hiddenBy &&
      suggestion.projectId !== undefined &&
      !uncheckedKeys.has(suggestion.key),
  );
  return {
    checked,
    totalMs: checked.reduce((total, item) => total + item.durationMs, 0),
  };
}

function upsertDecision(
  decisions: readonly LocalCalendarDecision[],
  suggestion: CalendarSuggestion,
  decision: Pick<LocalCalendarDecision, "decision" | "entryId">,
  factories: TimesheetEntryFactories,
): LocalCalendarDecision[] {
  const existing = decisions.find(
    (item) =>
      sameSource(item, suggestion) &&
      item.occurrenceKey === suggestion.occurrenceKey,
  );
  const next: LocalCalendarDecision = {
    _id: existing?._id ?? factories.createId("calendar_decision"),
    pluginId: suggestion.pluginId,
    connectionId: suggestion.connectionId,
    occurrenceKey: suggestion.occurrenceKey,
    localDate: suggestion.localDate,
    decision: decision.decision,
    ...(decision.entryId ? { entryId: decision.entryId } : {}),
    decidedAt: factories.now(),
  };
  return existing
    ? decisions.map((item) => (item === existing ? next : item))
    : [...decisions, next];
}

function upsertRule(
  rules: readonly LocalCalendarEventRule[],
  suggestion: CalendarSuggestion & { seriesId: string },
  rule: Pick<LocalCalendarEventRule, "action" | "projectId" | "taskId">,
  factories: TimesheetEntryFactories,
): LocalCalendarEventRule[] {
  const existing = findRule(rules, suggestion, suggestion.seriesId);
  const next: LocalCalendarEventRule = {
    _id: existing?._id ?? factories.createId("calendar_rule"),
    pluginId: suggestion.pluginId,
    connectionId: suggestion.connectionId,
    seriesId: suggestion.seriesId,
    label: suggestion.untitled ? (existing?.label ?? "Busy") : suggestion.title,
    action: rule.action,
    ...(rule.projectId ? { projectId: rule.projectId } : {}),
    ...(rule.taskId ? { taskId: rule.taskId } : {}),
    createdAt: existing?.createdAt ?? factories.now(),
  };
  return existing
    ? rules.map((item) => (item === existing ? next : item))
    : [...rules, next];
}

export interface CalendarAcceptance {
  suggestion: CalendarSuggestion;
  projectId: string;
  taskId?: string;
  /** Remember the project and task for every occurrence of the meeting. */
  remember?: boolean;
}

export interface CalendarAcceptResult {
  entryIds: string[];
  /** Suggestions left alone: no project, or already added. */
  skipped: number;
}

/**
 * Adds suggestions as time entries in one change: the event's day and
 * duration, its title as the note, and the chosen project and task. Each
 * gets an added decision, and `remember` writes the meeting's event rule.
 */
export function acceptCalendarSuggestions(
  state: LocalAppState,
  acceptances: readonly CalendarAcceptance[],
  factories: TimesheetEntryFactories,
): { state: LocalAppState; result: CalendarAcceptResult } {
  const entryIds = new Set(state.timesheetEntries.map((entry) => entry._id));
  let decisions = state.calendarDecisions ?? [];
  let rules = state.calendarEventRules ?? [];
  let workItems = state.workItems;
  const entries = [...state.timesheetEntries];
  const added: string[] = [];
  let skipped = 0;

  for (const { suggestion, projectId, taskId, remember } of acceptances) {
    const alreadyAdded = decisions.some(
      (decision) =>
        sameSource(decision, suggestion) &&
        decision.occurrenceKey === suggestion.occurrenceKey &&
        decision.decision === "added" &&
        decision.entryId !== undefined &&
        entryIds.has(decision.entryId),
    );
    const project = state.projects.find((item) => item._id === projectId);
    if (alreadyAdded || !project || project.status !== "active") {
      skipped += 1;
      continue;
    }

    const entry = createTimesheetEntry(
      state.projects,
      {
        localDate: suggestion.localDate,
        projectId,
        taskId,
        note: suggestion.untitled ? undefined : suggestion.title,
        durationMs: suggestion.durationMs,
        sourceBlockIds: [],
      },
      factories,
    );
    entries.push(entry);
    entryIds.add(entry._id);
    added.push(entry._id);
    workItems = applyLoggedTimeToWorkItems(workItems, {
      projectId,
      taskId,
      durationMsDelta: entry.durationMs,
    });
    decisions = upsertDecision(
      decisions,
      suggestion,
      { decision: "added", entryId: entry._id },
      factories,
    );
    if (remember && suggestion.seriesId) {
      rules = upsertRule(
        rules,
        { ...suggestion, seriesId: suggestion.seriesId },
        { action: "assign", projectId, taskId },
        factories,
      );
    }
  }

  if (added.length === 0) {
    return { state, result: { entryIds: [], skipped } };
  }
  return {
    state: {
      ...state,
      timesheetEntries: entries,
      workItems,
      calendarDecisions: decisions,
      calendarEventRules: rules,
    },
    result: { entryIds: added, skipped },
  };
}

/** Hides these occurrences. Other occurrences of the same meeting stay. */
export function dismissCalendarSuggestions(
  state: LocalAppState,
  suggestions: readonly CalendarSuggestion[],
  factories: TimesheetEntryFactories,
): LocalAppState {
  if (suggestions.length === 0) return state;
  let decisions = state.calendarDecisions ?? [];
  for (const suggestion of suggestions) {
    decisions = upsertDecision(
      decisions,
      suggestion,
      { decision: "dismissed" },
      factories,
    );
  }
  return { ...state, calendarDecisions: decisions };
}

/** Hides every occurrence of a recurring meeting. A one-off event has no meeting to hide. */
export function hideCalendarMeeting(
  state: LocalAppState,
  suggestion: CalendarSuggestion,
  factories: TimesheetEntryFactories,
): LocalAppState {
  if (!suggestion.seriesId) return state;
  return {
    ...state,
    calendarEventRules: upsertRule(
      state.calendarEventRules ?? [],
      { ...suggestion, seriesId: suggestion.seriesId },
      { action: "hide" },
      factories,
    ),
  };
}

/** Removes a remembered or hidden meeting. Its occurrences ask again. */
export function forgetCalendarEventRule(
  state: LocalAppState,
  ruleId: string,
): LocalAppState {
  const rules = state.calendarEventRules ?? [];
  if (!rules.some((rule) => rule._id === ruleId)) return state;
  return {
    ...state,
    calendarEventRules: rules.filter((rule) => rule._id !== ruleId),
  };
}

/** Removes a connection's decisions and remembered meetings. Entries stay. */
export function removeCalendarConnectionData(
  state: LocalAppState,
  source: Pick<CalendarSource, "pluginId" | "connectionId">,
): LocalAppState {
  const decisions = state.calendarDecisions ?? [];
  const rules = state.calendarEventRules ?? [];
  const keptDecisions = decisions.filter((item) => !sameSource(item, source));
  const keptRules = rules.filter((item) => !sameSource(item, source));
  if (
    keptDecisions.length === decisions.length &&
    keptRules.length === rules.length
  ) {
    return state;
  }
  return {
    ...state,
    calendarDecisions: keptDecisions,
    calendarEventRules: keptRules,
  };
}

/** The local date `days` before a "YYYY-MM-DD" date. */
function localDateBefore(localDate: string, days: number) {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) - days * DAY_MS,
  );
  return date.toISOString().slice(0, 10);
}

/** Drops decisions whose day is more than the retention period before `today`. */
export function pruneCalendarDecisions(
  decisions: readonly LocalCalendarDecision[],
  today: string,
): LocalCalendarDecision[] {
  const cutoff = localDateBefore(today, CALENDAR_DECISION_RETENTION_DAYS);
  return decisions.filter((decision) => decision.localDate >= cutoff);
}
