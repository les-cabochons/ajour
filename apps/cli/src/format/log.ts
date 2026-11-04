import type {
  AgentRunningTimer,
  AgentTimeEntry,
  DataToolOutput,
} from "../../../../packages/shared/agent-tools.ts";
import { datesBetween, weekdayIndex } from "../dates.ts";
import type { DateRange } from "../refs.ts";
import {
  displayIds,
  entryRow,
  formatRows,
  runningRow,
  type Row,
} from "./rows.ts";
import type { Paint } from "./style.ts";
import {
  displayWidth,
  formatClock,
  padEnd,
  padStart,
  truncate,
} from "./text.ts";

/**
 * `ajour log`'s prints: the table, its totals-only and per-task views, and
 * TSV and CSV for tools. Pure: the entries, targets and projects come from
 * Ajour's read tools, already filtered.
 */

type Listed = DataToolOutput<"list_time_entries">;
type Project = DataToolOutput<"list_projects">["projects"][number];

/** Time that never goes to Workday, or has no Workday task yet. */
export type CommitMark = "local" | "not-known-yet";

export interface LogRow extends Row {
  mark?: CommitMark;
  /** The project and task, so --by task adds up each task's time. */
  taskKey: string;
}

export interface LogView {
  range: DateRange;
  today: string;
  /** Oldest day first; in each day the running entry, then the saved ones. */
  rows: LogRow[];
  /** Each day's target in minutes. Empty from an older Ajour. */
  targets: ReadonlyMap<string, number>;
}

export interface LogPrintOptions {
  paint: Paint;
  /** The terminal's width. Without one, as in a pipe, nothing is cut. */
  columns?: number;
}

const MARK_TAGS: Record<CommitMark, { tag: string; role: keyof Paint }> = {
  local: { tag: "local", role: "muted" },
  "not-known-yet": { tag: "not known yet", role: "warning" },
};

/**
 * The rows and targets of a range. A saved entry the running entry
 * continues is left out: the running entry counts its time again.
 */
export function logView(input: {
  range: DateRange;
  today: string;
  listed: Listed;
  projects?: readonly Project[];
}): LogView {
  const { range, listed } = input;
  const marks = commitMarks(input.projects ?? []);
  const running =
    listed.running &&
    listed.running.date >= range.from &&
    listed.running.date <= range.to
      ? listed.running
      : null;
  const toRow = (row: Row, from: AgentRunningTimer | AgentTimeEntry) => {
    const mark = marks.get(taskKeyOf(from)) ?? marks.get(projectKeyOf(from));
    return {
      ...row,
      taskKey: taskKeyOf(from),
      ...(mark
        ? { mark, tag: MARK_TAGS[mark].tag, tagRole: MARK_TAGS[mark].role }
        : {}),
    };
  };
  const rows: LogRow[] = [];
  for (const date of datesBetween(range.from, range.to)) {
    if (running?.date === date) rows.push(toRow(runningRow(running), running));
    for (const entry of listed.entries) {
      if (entry.date !== date) continue;
      if (running && entry.state === "running") continue;
      rows.push(toRow(entryRow(entry), entry));
    }
  }
  return {
    range,
    today: input.today,
    rows,
    targets: new Map(
      (listed.targets ?? []).map((target) => [
        target.date,
        Math.round(target.hours * 60),
      ]),
    ),
  };
}

function taskKeyOf(value: { projectId?: string; taskId?: string }): string {
  return `${value.projectId ?? ""}/${value.taskId ?? ""}`;
}

function projectKeyOf(value: { projectId?: string }): string {
  return `${value.projectId ?? ""}/*`;
}

/** Local only projects and tasks, and tasks Not known yet, by key. */
function commitMarks(projects: readonly Project[]): Map<string, CommitMark> {
  const marks = new Map<string, CommitMark>();
  for (const project of projects) {
    if (project.localOnly) marks.set(projectKeyOf(project), "local");
    for (const task of project.tasks) {
      const kind = task.commitsAs?.kind;
      const key = taskKeyOf({ projectId: project.projectId, ...task });
      if (kind === "local-only") marks.set(key, "local");
      if (kind === "not-known-yet") marks.set(key, "not-known-yet");
    }
  }
  return marks;
}

// Totals and targets

function totalOf(rows: readonly LogRow[]): number {
  return rows.reduce((total, row) => total + row.minutes, 0);
}

function targetOf(view: LogView, dates: readonly string[]): number {
  return dates.reduce(
    (total, date) => total + (view.targets.get(date) ?? 0),
    0,
  );
}

/** The days a print shows: Saturday and Sunday only with time or a target. */
function shownDays(view: LogView): string[] {
  return datesBetween(view.range.from, view.range.to).filter(
    (date) =>
      weekdayIndex(date) < 5 ||
      view.range.from === view.range.to ||
      (view.targets.get(date) ?? 0) > 0 ||
      view.rows.some((row) => row.date === date),
  );
}

// Names of days and ranges

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/** "Mon 2", with " Nov" when the print spans months, and " 2026" for years. */
function shortDay(date: string, withMonth: boolean, withYear = false): string {
  const { year, month, day } = parts(date);
  return [
    WEEKDAYS[weekdayIndex(date)],
    day,
    withMonth ? MONTHS[month - 1]!.slice(0, 3) : undefined,
    withYear ? year : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
}

/** "Wednesday 4 November 2026". */
function longDay(date: string): string {
  const { year, month, day } = parts(date);
  return `${LONG_WEEKDAYS[weekdayIndex(date)]} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** "Mon 2 – Sun 8 Nov 2026", naming each end's month and year only as needed. */
function spanOf(from: string, to: string): string {
  const start = parts(from);
  const end = parts(to);
  const sameYear = start.year === end.year;
  const sameMonth = sameYear && start.month === end.month;
  return `${shortDay(from, !sameMonth, !sameYear)} – ${shortDay(to, true, true)}`;
}

function spansMonths(range: DateRange): boolean {
  return range.from.slice(0, 7) !== range.to.slice(0, 7);
}

function relativeDay(date: string, today: string): string | undefined {
  if (date === today) return "today";
  return undefined;
}

// Lines

interface Piece {
  text: string;
  role?: keyof Paint;
}

function piecesWidth(pieces: readonly Piece[]): number {
  return pieces.reduce((total, piece) => total + displayWidth(piece.text), 0);
}

function paintPieces(pieces: readonly Piece[], paint: Paint): string {
  return pieces
    .map((piece) => (piece.role ? paint[piece.role](piece.text) : piece.text))
    .join("");
}

/** The pieces cut to `width` cells, ending with "…" when cut. */
function cutPieces(pieces: readonly Piece[], width: number): Piece[] {
  if (piecesWidth(pieces) <= width) return [...pieces];
  const kept: Piece[] = [];
  let room = width;
  for (const piece of pieces) {
    const cells = displayWidth(piece.text);
    if (cells < room) {
      kept.push(piece);
      room -= cells;
      continue;
    }
    // Pieces follow, so a piece that just fits still ends with the ellipsis.
    const text = truncate(`${piece.text} `, room);
    kept.push({ ...piece, text });
    break;
  }
  return kept;
}

/**
 * `left`, then `right` ending at `width`, at least two spaces apart. When
 * they don't fit, the left side is cut, and the line itself when even the
 * right side doesn't.
 */
function spread(
  left: readonly Piece[],
  right: readonly Piece[],
  width: number,
  paint: Paint,
): string {
  const room = width - piecesWidth(right) - 2;
  const fitted = cutPieces(left, Math.max(1, room));
  const gap = Math.max(2, width - piecesWidth(fitted) - piecesWidth(right));
  const pieces = [...fitted, { text: " ".repeat(gap) }, ...right];
  const plain = pieces.map((piece) => piece.text).join("");
  return fit(paintPieces(pieces, paint), plain, width).trimEnd();
}

/** The widest line may take: one cell less than the terminal, so none wraps. */
function maxWidth(options: LogPrintOptions): number {
  return options.columns === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(options.columns - 1, 1);
}

/** A line cut to the width, plain when it had to be cut. */
function fit(line: string, plain: string, width: number): string {
  return displayWidth(plain) > width ? truncate(plain, width) : line;
}

const DAY_BAR_CELLS = 10;

/**
 * `cells` cells, `filled` of them in the accent color. Never full while
 * under target, so a full bar always means the target is met.
 */
function bar(minutes: number, target: number, cells: number): Piece[] {
  if (cells <= 0) return [];
  let filled = target > 0 ? Math.round((minutes / target) * cells) : cells;
  if (minutes < target) filled = Math.min(filled, cells - 1);
  filled = Math.max(0, Math.min(cells, filled));
  const pieces: Piece[] = [
    { text: "▮".repeat(filled), role: "accent" },
    { text: "▯".repeat(cells - filled), role: "muted" },
  ];
  return pieces.filter((piece) => piece.text);
}

/** "6:39 of 8:00", or "6:39" without a target. */
function totalPieces(minutes: number, target: number): Piece[] {
  return [
    { text: formatClock(minutes), role: "bold" },
    ...(target > 0
      ? [{ text: ` of ${formatClock(target)}`, role: "muted" as const }]
      : []),
  ];
}

/**
 * How the week stands against the targets of its days up to today:
 * "on pace", "1:51 behind" or "0:30 ahead".
 */
function pacePieces(view: LogView, total: number): Piece[] {
  const dates = datesBetween(view.range.from, view.range.to);
  if (targetOf(view, dates) === 0) return [];
  const expected = targetOf(
    view,
    dates.filter((date) => date <= view.today),
  );
  const difference = total - expected;
  if (difference === 0) return [{ text: "on pace", role: "success" }];
  return difference < 0
    ? [{ text: `${formatClock(-difference)} behind`, role: "warning" }]
    : [{ text: `${formatClock(difference)} ahead`, role: "success" }];
}

/** The range's header: its name, its total of its target, a bar or the pace. */
function headerPieces(view: LogView): { left: Piece[]; right: Piece[] } {
  const { range } = view;
  const total = totalOf(view.rows);
  const target = targetOf(view, datesBetween(range.from, range.to));
  const right = totalPieces(total, target);
  if (range.from === range.to) {
    const relative = relativeDay(range.from, view.today);
    const dayBar = target > 0 ? bar(total, target, DAY_BAR_CELLS) : [];
    return {
      left: [
        { text: longDay(range.from), role: "accent" },
        ...(relative
          ? [{ text: ` · ${relative}`, role: "muted" as const }]
          : []),
      ],
      right: dayBar.length ? [...right, { text: "  " }, ...dayBar] : right,
    };
  }
  const span = spanOf(range.from, range.to);
  if (!range.week) return { left: [{ text: span, role: "accent" }], right };
  const pace = pacePieces(view, total);
  return {
    left: [
      { text: `Week ${range.week.week}`, role: "accent" },
      { text: ` · ${span}`, role: "muted" },
    ],
    right: pace.length ? [...right, { text: "  " }, ...pace] : right,
  };
}

/** The header and the rule under it, as wide as the widest line below. */
function headerLines(
  view: LogView,
  bodyWidth: number,
  options: LogPrintOptions,
): { lines: string; width: number } {
  const { left, right } = headerPieces(view);
  const width = Math.min(
    Math.max(bodyWidth, piecesWidth(left) + 2 + piecesWidth(right)),
    maxWidth(options),
  );
  return {
    width,
    lines:
      `${spread(left, right, width, options.paint)}\n` +
      `${options.paint.muted("─".repeat(width))}\n`,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "10 entries · 1 running · 6 committed · 3 to commit". */
function footer(rows: readonly LogRow[]): string {
  const running = rows.filter((row) => row.running).length;
  const committed = rows.filter((row) => row.committed).length;
  const toCommit = rows.filter(
    (row) => !row.running && !row.committed && row.mark !== "local",
  ).length;
  return [
    plural(rows.length, "entry", "entries"),
    running ? `${running} running` : "",
    committed ? `${committed} committed` : "",
    toCommit ? `${toCommit} to commit` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// The views

/**
 * The table: a header, then one row per entry. Several days group their
 * rows under each day's header, with its total of its target; a day
 * without time is one line.
 */
export function formatLogTable(
  view: LogView,
  options: LogPrintOptions,
): string {
  const { paint } = options;
  const rowLines = formatRows(view.rows, {
    paint,
    today: view.today,
    columns: options.columns,
    dayColumn: false,
  })
    .split("\n")
    .slice(0, view.rows.length);
  const rowsWidth = Math.max(0, ...rowLines.map(displayWidth));
  const counts = truncate(footer(view.rows), maxWidth(options));
  const footerLine = view.rows.length ? `\n${paint.muted(counts)}\n` : "";

  if (view.range.from === view.range.to) {
    const header = headerLines(view, rowsWidth, options);
    const body = view.rows.length
      ? rowLines.map((line) => `${line}\n`).join("")
      : `${paint.muted("No entries.")}\n`;
    return header.lines + body + footerLine;
  }

  const withMonth = spansMonths(view.range);
  const days = shownDays(view).map((date) => {
    const rows = view.rows
      .map((row, index) => ({ row, line: rowLines[index]! }))
      .filter(({ row }) => row.date === date);
    const total = totalOf(rows.map(({ row }) => row));
    const target = view.targets.get(date) ?? 0;
    const relative = relativeDay(date, view.today);
    const left: Piece[] = [
      { text: shortDay(date, withMonth), role: "accent" },
      ...(relative ? [{ text: ` · ${relative}`, role: "muted" as const }] : []),
    ];
    const right: Piece[] = rows.length
      ? totalPieces(total, target)
      : [
          { text: "—", role: "muted" },
          ...(target > 0
            ? [{ text: ` of ${formatClock(target)}`, role: "muted" as const }]
            : []),
        ];
    return { left, right, lines: rows.map(({ line }) => line) };
  });
  const dayWidth = Math.max(
    0,
    ...days.map(
      ({ left, right }) => piecesWidth(left) + 2 + piecesWidth(right),
    ),
  );
  const header = headerLines(view, Math.max(rowsWidth, dayWidth), options);

  let body = "";
  let previousHadRows = false;
  days.forEach((day, index) => {
    const hasRows = day.lines.length > 0;
    // A day with entries stands apart; days without time stack.
    if (index > 0 && hasRows && !previousHadRows) body += "\n";
    body += `${spread(day.left, day.right, header.width, paint)}\n`;
    for (const line of day.lines) body += `${line}\n`;
    if (hasRows && index < days.length - 1) body += "\n";
    previousHadRows = hasRows;
  });
  return header.lines + body + footerLine;
}

/** One line per day: its total and a bar against its target. */
export function formatLogSummary(
  view: LogView,
  options: LogPrintOptions,
): string {
  const { paint } = options;
  const withMonth = spansMonths(view.range);
  const width = maxWidth(options);
  const days = shownDays(view).map((date) => {
    const rows = view.rows.filter((row) => row.date === date);
    return {
      date,
      label: shortDay(date, withMonth),
      total: rows.length ? formatClock(totalOf(rows)) : "—",
      minutes: totalOf(rows),
      target: view.targets.get(date) ?? 0,
      running: rows.some((row) => row.running),
    };
  });
  const labelWidth = Math.max(0, ...days.map((day) => displayWidth(day.label)));
  const totalWidth = Math.max(5, ...days.map((day) => day.total.length));
  const lines = days.map((day) => {
    // One cell per hour of target, or of time logged past it.
    const cells = Math.min(
      24,
      Math.max(Math.round(day.target / 60), Math.round(day.minutes / 60)),
    );
    const pieces: Piece[] = [
      { text: padEnd(day.label, labelWidth), role: "accent" },
      { text: `  ${padStart(day.total, totalWidth)}` },
      ...(cells > 0
        ? [{ text: "  " }, ...bar(day.minutes, day.target, cells)]
        : []),
      ...(day.running
        ? [{ text: "  " }, { text: "● running", role: "success" as const }]
        : []),
    ];
    return {
      plain: pieces.map((piece) => piece.text).join(""),
      line: paintPieces(pieces, paint),
    };
  });
  const bodyWidth = Math.max(
    0,
    ...lines.map(({ plain }) => displayWidth(plain)),
  );
  const header = headerLines(view, bodyWidth, options);
  return (
    header.lines +
    lines.map(({ line, plain }) => `${fit(line, plain, width)}\n`).join("")
  );
}

const TASK_BAR_CELLS = 12;

/**
 * One line per task over the range, most time first, with a bar against
 * the task with the most, marking the running and the Not known yet.
 */
export function formatLogByTask(
  view: LogView,
  options: LogPrintOptions,
): string {
  const { paint } = options;
  const width = maxWidth(options);
  const tasks = new Map<
    string,
    {
      project: string;
      task: string;
      minutes: number;
      running?: number;
      mark?: CommitMark;
    }
  >();
  for (const row of view.rows) {
    const task = tasks.get(row.taskKey) ?? {
      project: row.project ?? "—",
      task: row.task ?? "—",
      minutes: 0,
      ...(row.mark ? { mark: row.mark } : {}),
    };
    task.minutes += row.minutes;
    if (row.running) task.running = row.minutes;
    tasks.set(row.taskKey, task);
  }
  const sorted = [...tasks.values()].sort(
    (left, right) =>
      right.minutes - left.minutes ||
      left.project.localeCompare(right.project) ||
      left.task.localeCompare(right.task),
  );
  const most = Math.max(0, ...sorted.map((task) => task.minutes));
  const projectWidth = Math.max(
    0,
    ...sorted.map((task) => displayWidth(task.project)),
  );
  const taskWidth = Math.max(
    0,
    ...sorted.map((task) => displayWidth(task.task)),
  );
  const lines = sorted.map((task) => {
    const cells =
      most > 0 && task.minutes > 0
        ? Math.max(1, Math.round((task.minutes / most) * TASK_BAR_CELLS))
        : 0;
    const tags: Piece[] = [
      ...(task.running !== undefined
        ? [
            {
              text: `● ${formatClock(task.running)} running`,
              role: "success" as const,
            },
          ]
        : []),
      ...(task.mark
        ? [{ text: MARK_TAGS[task.mark].tag, role: MARK_TAGS[task.mark].role }]
        : []),
    ];
    const pieces: Piece[] = [
      { text: `  ${padStart(formatClock(task.minutes), 5)}  ` },
      { text: padEnd(task.project, projectWidth) },
      { text: "  " },
      { text: padEnd(task.task, taskWidth) },
      { text: "  " },
      { text: "▮".repeat(cells), role: "accent" },
      ...tags.flatMap((tag, index) => [
        { text: index === 0 ? " ".repeat(TASK_BAR_CELLS - cells + 2) : "  " },
        tag,
      ]),
    ];
    const plain = pieces
      .map((piece) => piece.text)
      .join("")
      .trimEnd();
    return { plain, line: paintPieces(pieces, paint).trimEnd() };
  });
  const bodyWidth = Math.max(
    0,
    ...lines.map(({ plain }) => displayWidth(plain)),
  );
  const header = headerLines(view, bodyWidth, options);
  const body = lines.length
    ? lines.map(({ line, plain }) => `${fit(line, plain, width)}\n`).join("")
    : `${paint.muted("No entries.")}\n`;
  return header.lines + body;
}

// For tools

export type DelimitedFormat = "tsv" | "csv";

const COLUMNS = ["date", "state", "hours", "project", "task", "note", "id"];

/**
 * One line per entry with a header row: date, state, hours, project, task,
 * note, id. ISO dates, hours as dot decimals, no color.
 */
export function formatDelimited(
  view: LogView,
  format: DelimitedFormat,
): string {
  const ids = displayIds(view.rows.map((row) => row.id));
  const lines = [
    COLUMNS,
    ...view.rows.map((row, index) => [
      row.date,
      row.running ? "running" : row.committed ? "committed" : "saved",
      (row.minutes / 60).toFixed(2),
      row.project ?? "",
      row.task ?? "",
      row.note ?? "",
      ids[index]!,
    ]),
  ];
  const cell = format === "tsv" ? tsvCell : csvCell;
  return lines
    .map((line) => `${line.map(cell).join(format === "tsv" ? "\t" : ",")}\n`)
    .join("");
}

/** A tab or line break would split the line, so it becomes a space. */
function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ");
}

/** Quoted when it holds a comma, a quote or a line break (RFC 4180). */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
