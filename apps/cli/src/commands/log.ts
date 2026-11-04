import type {
  AgentRunningTimer,
  AgentTimeEntry,
  DataToolOutput,
} from "../../../../packages/shared/agent-tools.ts";
import { localDate, type Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import {
  formatDelimited,
  formatLogByTask,
  formatLogSummary,
  formatLogTable,
  logView,
} from "../format/log.ts";
import { parseRange, resolveProject, resolveTask } from "../refs.ts";

export interface LogOptions {
  range?: string;
  format?: string;
  by?: string;
  summary: boolean;
  project?: string;
  task?: string;
  committed: boolean;
  uncommitted: boolean;
}

type Format = "table" | "tsv" | "csv" | "json";
const FORMATS: readonly Format[] = ["table", "tsv", "csv", "json"];

type Listed = DataToolOutput<"list_time_entries">;

/** Which entries a print keeps. */
interface Filter {
  projectId?: string;
  taskId?: string;
  committed?: boolean;
}

/**
 * Prints a day, several days or a week: the table on a terminal, TSV in a
 * pipe, or CSV or the tool's JSON when asked. Every option is read before
 * Ajour is asked, so a bad one costs no call.
 */
export async function log(ctx: Context, options: LogOptions): Promise<number> {
  const today = localDate(ctx.io.now());
  const range = parseRange(options.range ?? "", today);
  const format = formatOf(ctx, options.format);
  const view = viewOf(options);
  if (view !== "entries" && format !== "table") {
    throw new UsageError(
      `--${view === "summary" ? "summary" : "by task"} prints a table. Leave it out for --format ${format}, which prints one line per entry.`,
    );
  }
  if (options.committed && options.uncommitted) {
    throw new UsageError("Use --committed or --uncommitted, not both.");
  }

  const client = await ctx.client();
  const filtersByTask =
    options.project !== undefined || options.task !== undefined;
  const projects =
    format === "table" || filtersByTask
      ? (await client.call("list_projects", {})).projects
      : undefined;
  const filter: Filter = {
    ...(options.committed ? { committed: true } : {}),
    ...(options.uncommitted ? { committed: false } : {}),
  };
  if (options.project !== undefined) {
    filter.projectId = resolveProject(options.project, projects!).projectId;
  }
  if (options.task !== undefined) {
    const task = resolveTask(options.task, projects!);
    if (filter.projectId !== undefined && filter.projectId !== task.projectId) {
      throw new UsageError(
        `${task.label} isn't in the project --project names.`,
      );
    }
    filter.projectId = task.projectId;
    filter.taskId = task.taskId;
  }

  const listed = applyFilter(
    await client.call("list_time_entries", { from: range.from, to: range.to }),
    filter,
  );
  if (format === "json") {
    ctx.io.stdout.write(`${JSON.stringify(listed, null, 2)}\n`);
    return 0;
  }
  const printed = logView({ range, today, listed, projects });
  if (format === "tsv" || format === "csv") {
    ctx.io.stdout.write(formatDelimited(printed, format));
    return 0;
  }
  const print = {
    paint: ctx.paint,
    columns: ctx.io.stdout.isTTY ? ctx.io.stdout.columns : undefined,
  };
  ctx.io.stdout.write(
    view === "summary"
      ? formatLogSummary(printed, print)
      : view === "task"
        ? formatLogByTask(printed, print)
        : formatLogTable(printed, print),
  );
  return 0;
}

/** --json, else --format, else the table on a terminal and TSV in a pipe. */
function formatOf(ctx: Context, typed: string | undefined): Format {
  if (ctx.json) {
    if (typed !== undefined && typed !== "json") {
      throw new UsageError(`Use --json or --format ${typed}, not both.`);
    }
    return "json";
  }
  if (typed === undefined) return ctx.io.stdout.isTTY ? "table" : "tsv";
  const format = FORMATS.find((name) => name === typed.trim().toLowerCase());
  if (!format) {
    throw new UsageError(
      `--format takes table, tsv, csv or json, not "${typed}"`,
    );
  }
  return format;
}

function viewOf(options: LogOptions): "entries" | "summary" | "task" {
  const by = options.by?.trim().toLowerCase();
  if (by !== undefined && by !== "day" && by !== "task") {
    throw new UsageError(`--by takes day or task, not "${options.by}"`);
  }
  if (options.summary && by === "task") {
    throw new UsageError("Use --summary or --by task, not both.");
  }
  if (options.summary) return "summary";
  return by === "task" ? "task" : "entries";
}

function keeps(
  filter: Filter,
  item: AgentTimeEntry | AgentRunningTimer,
  committed: boolean,
): boolean {
  if (filter.projectId !== undefined && item.projectId !== filter.projectId) {
    return false;
  }
  if (filter.taskId !== undefined && item.taskId !== filter.taskId) {
    return false;
  }
  return filter.committed === undefined || filter.committed === committed;
}

/** The tool's output with only the entries the filter keeps. */
function applyFilter(listed: Listed, filter: Filter): Listed {
  const running =
    listed.running && keeps(filter, listed.running, false)
      ? listed.running
      : null;
  return {
    ...listed,
    entries: listed.entries.filter((entry) =>
      keeps(filter, entry, entry.state === "committed"),
    ),
    running,
  };
}
