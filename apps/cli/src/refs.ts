import type {
  AgentRunningTimer,
  AgentTimeEntry,
} from "../../../packages/shared/agent-tools.ts";
import { normalizeTaskName } from "../../../packages/shared/task-names.ts";
import {
  addDays,
  dayNumber,
  isoWeekMonday,
  isoWeekOf,
  isoWeeksIn,
  isRealDate,
  mondayOf,
  weekdayIndex,
  type IsoWeek,
} from "./dates.ts";
import { CliError, EXIT, UsageError } from "./errors.ts";
import { entryRow, formatRows, runningRow } from "./format/rows.ts";
import { painter } from "./format/style.ts";

/**
 * Turns what the user typed into what Ajour's tools take: a task, an
 * entry, a duration, a day or a range of days. Pure: the lists come from Ajour's read tools.
 */

/** A reference that matched nothing or several things. */
export class ReferenceError extends CliError {
  constructor(message: string) {
    super(message, EXIT.reference, "error");
  }
}

export interface ProjectRef {
  projectId: string;
  /** The project's display name. */
  name: string;
  /** The name the external timesheet knows. */
  fullName?: string;
  code?: string;
  tasks: readonly { taskId: string; name: string; pinnedSlot?: number }[];
}

export interface ResolvedTask {
  projectId: string;
  taskId: string;
  /** "AJR/07 Export", for messages. */
  label: string;
}

type Tier = "exact" | "prefix" | "inside";
const TIERS: readonly Tier[] = ["exact", "prefix", "inside"];

function tierOf(candidate: string, query: string): Tier | undefined {
  const name = normalizeTaskName(candidate);
  if (name === query) return "exact";
  if (name.startsWith(query)) return "prefix";
  if (name.includes(query)) return "inside";
  return undefined;
}

/** The best tier's matches: an exact name wins, then a prefix, then a part. */
function bestMatches<T>(
  items: readonly T[],
  query: string,
  names: (item: T) => (string | undefined)[],
): T[] {
  const tiered = items.map((item) => {
    const tiers = names(item)
      .filter((name): name is string => Boolean(name))
      .map((name) => tierOf(name, query))
      .filter((tier): tier is Tier => tier !== undefined);
    return {
      item,
      tier: TIERS.find((tier) => tiers.includes(tier)),
    };
  });
  for (const tier of TIERS) {
    const found = tiered.filter((entry) => entry.tier === tier);
    if (found.length) return found.map((entry) => entry.item);
  }
  return [];
}

function labelOf(project: ProjectRef, taskName: string): string {
  return `${project.code?.trim() || project.name}/${taskName}`;
}

/**
 * Finds one active task from `PROJECT/TASK`, `TASK`, or a pinned key 1 to 0.
 * PROJECT matches the code, the display name or the full name, with the
 * same tiers. Names compare as task imports do:
 * trimmed, spaces collapsed, case and accents ignored. Throws exit 4 when
 * nothing or more than one task matches.
 */
export function resolveTask(
  query: string,
  projects: readonly ProjectRef[],
): ResolvedTask {
  const typed = query.trim();
  if (/^\d$/.test(typed)) {
    const slot = typed === "0" ? 10 : Number(typed);
    for (const project of projects) {
      const task = project.tasks.find((item) => item.pinnedSlot === slot);
      if (task) {
        return {
          projectId: project.projectId,
          taskId: task.taskId,
          label: labelOf(project, task.name),
        };
      }
    }
    throw new ReferenceError(`No task is pinned to ${typed}.`);
  }

  const slash = typed.indexOf("/");
  const projectQuery =
    slash >= 0 ? normalizeTaskName(typed.slice(0, slash)) : undefined;
  const taskQuery = normalizeTaskName(
    slash >= 0 ? typed.slice(slash + 1) : typed,
  );
  if (!taskQuery || projectQuery === "") {
    throw new UsageError(`"${typed}" isn't a task. Use TASK or PROJECT/TASK.`);
  }

  const inProjects =
    projectQuery === undefined
      ? projects
      : bestMatches(projects, projectQuery, (project) => [
          project.code,
          project.name,
          project.fullName,
        ]);
  const tasks = inProjects.flatMap((project) =>
    project.tasks.map((task) => ({ project, task })),
  );
  const matches = bestMatches(tasks, taskQuery, ({ task }) => [task.name]);

  if (matches.length === 1) {
    const [{ project, task }] = matches as [(typeof matches)[number]];
    return {
      projectId: project.projectId,
      taskId: task.taskId,
      label: labelOf(project, task.name),
    };
  }
  if (matches.length === 0) {
    throw new ReferenceError(`No active task matches "${typed}".`);
  }
  const labels = matches
    .map(({ project, task }) => labelOf(project, task.name))
    .sort((left, right) => left.localeCompare(right));
  const example = labels.at(-1)!;
  throw new ReferenceError(
    `"${typed}" matches ${labels.length} tasks:\n` +
      labels.map((label) => `  ${label}`).join("\n") +
      `\nSay which, such as: ajour start ${/\s/.test(example) ? `"${example}"` : example}`,
  );
}

/**
 * Finds one project from its code, name or full name, matched as a TASK's PROJECT
 * part is. Throws exit 4 when nothing or more than one project matches.
 */
export function resolveProject(
  query: string,
  projects: readonly ProjectRef[],
): ProjectRef {
  const typed = query.trim();
  const normalized = normalizeTaskName(typed);
  if (!normalized) throw new UsageError(`"${typed}" isn't a project.`);
  const matches = bestMatches(projects, normalized, (project) => [
    project.code,
    project.name,
    project.fullName,
  ]);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new ReferenceError(`No active project matches "${typed}".`);
  }
  const labels = matches
    .map((project) =>
      project.code?.trim()
        ? `${project.code.trim()}  ${project.name}`
        : project.name,
    )
    .sort((left, right) => left.localeCompare(right));
  throw new ReferenceError(
    `"${typed}" matches ${labels.length} projects:\n` +
      labels.map((label) => `  ${label}`).join("\n") +
      "\nSay which with more of its code or name.",
  );
}

const MAX_MINUTES = 24 * 60;

/**
 * Reads a duration as whole minutes: "1:30", "1.5" or "1,5" hours, "1h30",
 * "2h", "90m" or "45min". Up to 24 hours. Zero only where the running entry
 * counts on from it.
 */
export function parseDuration(
  text: string,
  options: { allowZero: boolean },
): number {
  const minutes = readMinutes(text.trim().toLowerCase());
  const lowest = options.allowZero ? 0 : 1;
  if (minutes === undefined || minutes < lowest || minutes > MAX_MINUTES) {
    throw new UsageError(
      `--duration takes a time such as 1:30, 1h30, 90m or 1.5, from ${options.allowZero ? "0:00" : "1 minute"} to 24 hours, not "${text}"`,
    );
  }
  return minutes;
}

function readMinutes(text: string): number | undefined {
  const clock = /^(\d+):(\d{2})$/.exec(text);
  if (clock) {
    const minutes = Number(clock[2]);
    return minutes < 60 ? Number(clock[1]) * 60 + minutes : undefined;
  }
  const hoursAndMinutes = /^(\d+)h(?:(\d{1,2})(?:m|min)?)?$/.exec(text);
  if (hoursAndMinutes) {
    const minutes = Number(hoursAndMinutes[2] ?? 0);
    return minutes < 60 ? Number(hoursAndMinutes[1]) * 60 + minutes : undefined;
  }
  const minutesOnly = /^(\d+)(?:m|min)$/.exec(text);
  if (minutesOnly) return Number(minutesOnly[1]);
  const decimal = /^(\d*)[.,]?(\d*)$/.exec(text);
  if (decimal && /\d/.test(text)) {
    const hours = Number(`${decimal[1] || "0"}.${decimal[2] || "0"}`);
    return Number.isFinite(hours) ? Math.round(hours * 60) : undefined;
  }
  return undefined;
}

/** What an ENTRY argument names, before Ajour is asked. */
export type EntryRef =
  { kind: "running" } | { kind: "last" } | { kind: "prefix"; prefix: string };

/**
 * Reads an ENTRY: `running`, `last`, or the start of an entry's short id,
 * 4 to 32 hex characters, as `ajour log` prints it.
 */
export function parseEntryRef(text: string): EntryRef {
  const typed = text.trim().toLowerCase();
  if (typed === "running") return { kind: "running" };
  if (typed === "last") return { kind: "last" };
  if (/^[0-9a-f]{4,32}$/.test(typed)) return { kind: "prefix", prefix: typed };
  throw new UsageError(
    `"${text}" isn't an entry. Use running, last, or 4 or more characters of an id from ajour log.`,
  );
}

export type FoundEntry =
  | { kind: "running"; running: AgentRunningTimer }
  | { kind: "entry"; entry: AgentTimeEntry };

/**
 * The one entry find_entries found for `prefix`. A saved entry the running
 * entry continues is the running entry. Nothing, or several, is exit 4,
 * with the candidates as rows.
 */
export function pickFoundEntry(
  prefix: string,
  found: {
    entries: readonly AgentTimeEntry[];
    running: AgentRunningTimer | null;
  },
  today: string,
): FoundEntry {
  const candidates: FoundEntry[] = [
    ...found.entries
      .filter((entry) => !(found.running && entry.state === "running"))
      .map((entry) => ({ kind: "entry" as const, entry })),
    ...(found.running
      ? [{ kind: "running" as const, running: found.running }]
      : []),
  ];
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new ReferenceError(`No entry has an id starting with "${prefix}".`);
  }
  const rows = formatRows(
    candidates.map((candidate) =>
      candidate.kind === "entry"
        ? entryRow(candidate.entry)
        : runningRow(candidate.running),
    ),
    { paint: painter(false), today },
  );
  throw new ReferenceError(
    `"${prefix}" matches ${candidates.length} entries:\n` +
      rows
        .trimEnd()
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n") +
      "\nSay which with more of its id.",
  );
}

const WEEKDAY_NAMES = [
  ["mon", "monday"],
  ["tue", "tuesday"],
  ["wed", "wednesday"],
  ["thu", "thursday"],
  ["fri", "friday"],
  ["sat", "saturday"],
  ["sun", "sunday"],
] as const;

/** A DAY, or undefined when `text` isn't one. */
function readDay(text: string, today: string): string | undefined {
  const typed = text.trim().toLowerCase();
  if (typed === "today") return today;
  if (typed === "yesterday") return addDays(today, -1);
  const weekday = WEEKDAY_NAMES.findIndex((names) =>
    (names as readonly string[]).includes(typed),
  );
  if (weekday >= 0) {
    // The most recent such day, today included.
    return addDays(today, -((weekdayIndex(today) - weekday + 7) % 7));
  }
  const date = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(typed);
  if (!date) return undefined;
  const year = date[1] ? Number(date[1]) : Number(today.slice(0, 4));
  const month = Number(date[2]);
  const day = Number(date[3]);
  if (!isRealDate(year, month, day)) return undefined;
  return `${String(year).padStart(4, "0")}-${date[2]}-${date[3]}`;
}

/**
 * Reads a DAY: `today`, `yesterday`, `mon` to `sun` (the most recent such
 * day, today included), `YYYY-MM-DD`, or `MM-DD` in today's year.
 */
export function parseDay(text: string, today: string): string {
  const day = readDay(text, today);
  if (day === undefined) {
    throw new UsageError(
      `"${text}" isn't a day. Use today, yesterday, mon to sun, 2026-11-03 or 11-03.`,
    );
  }
  return day;
}

/** The days a print covers, both included, and its ISO week when it is one. */
export interface DateRange {
  from: string;
  to: string;
  week?: IsoWeek;
}

/** The most days one print covers: what list_time_entries reads at once. */
export const MAX_RANGE_DAYS = 62;

function weekRange(monday: string): DateRange {
  return { from: monday, to: addDays(monday, 6), week: isoWeekOf(monday) };
}

/**
 * Reads a RANGE: a DAY, `DAY..DAY` with both days included, `week` (Monday
 * to Sunday of today), `last-week`, or an ISO week such as `2026-W45`.
 * Nothing means today. At most 62 days.
 */
export function parseRange(text: string, today: string): DateRange {
  const typed = text.trim().toLowerCase();
  const notRange = () =>
    new UsageError(
      `"${text}" isn't a range. Use a DAY, DAY..DAY, week, last-week or 2026-W45.`,
    );
  if (typed === "" || typed === "today") return { from: today, to: today };
  if (typed === "week") return weekRange(mondayOf(today));
  if (typed === "last-week") return weekRange(addDays(mondayOf(today), -7));
  const isoWeek = /^(\d{4})-w(\d{2})$/.exec(typed);
  if (isoWeek) {
    const year = Number(isoWeek[1]);
    const week = Number(isoWeek[2]);
    if (week < 1) throw notRange();
    const weeks = isoWeeksIn(year);
    if (week > weeks) {
      throw new UsageError(
        `${year} has ${weeks} weeks, so "${text}" isn't one.`,
      );
    }
    return weekRange(isoWeekMonday(year, week));
  }
  const ends = typed.split("..");
  if (ends.length > 2) throw notRange();
  if (ends.length === 1) ends.push(ends[0]!);
  const [from, to] = ends.map((end) => readDay(end, today));
  if (from === undefined || to === undefined) throw notRange();
  if (from > to) {
    throw new UsageError(
      `In "${text}", ${from} comes after ${to}. Put the earlier day first.`,
    );
  }
  const days = dayNumber(to) - dayNumber(from) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new UsageError(
      `A range covers at most ${MAX_RANGE_DAYS} days, and "${text}" covers ${days}. Print it in parts.`,
    );
  }
  return { from, to };
}
