import type {
  AgentRunningTimer,
  AgentTimeEntry,
} from "../../../../packages/shared/agent-tools.ts";
import type { Paint } from "./style.ts";
import {
  displayWidth,
  formatClock,
  padEnd,
  padStart,
  truncate,
} from "./text.ts";

/**
 * The one row shape every write answers with and every print uses: the
 * state mark, the duration, project, task, note, a ✓ when committed, the
 * short id, and the day when it isn't today. Columns line up across the rows
 * printed together.
 */
export interface Row {
  running: boolean;
  committed: boolean;
  minutes: number;
  /** The project's code, else its name. */
  project?: string;
  task?: string;
  note?: string;
  /** The entry's short id, or its whole id when it has none. */
  id: string;
  date: string;
  /** A muted word after the row, such as "saved". */
  tag?: string;
}

export interface RowOptions {
  paint: Paint;
  today: string;
  /** The terminal's width. Without one, as in a pipe, nothing is cut. */
  columns?: number;
}

export function entryRow(entry: AgentTimeEntry): Row {
  return {
    running: entry.state === "running",
    committed: entry.state === "committed",
    minutes: entry.minutes,
    project: projectLabel(entry),
    task: entry.taskName,
    note: entry.note,
    id: entry.shortId ?? entry.entryId,
    date: entry.date,
  };
}

export function runningRow(running: AgentRunningTimer): Row {
  return {
    running: true,
    committed: false,
    minutes: running.countedMinutes,
    project: projectLabel(running),
    task: running.taskName,
    note: running.note,
    id: running.shortId ?? running.timerId,
    date: running.date,
  };
}

function projectLabel(value: {
  projectCode?: string;
  projectName?: string;
}): string | undefined {
  return value.projectCode?.trim() || value.projectName?.trim() || undefined;
}

const SHORT_ID = /^[0-9a-f]{8,}$/;
const SHORT_ID_LENGTH = 7;

/**
 * Ids as a print shows them: 7 characters, more when two different ids in
 * the same print share them. An id that isn't hex, from an older Ajour,
 * stays whole.
 */
export function displayIds(ids: readonly string[]): string[] {
  const hex = [...new Set(ids.filter((id) => SHORT_ID.test(id)))];
  let length = SHORT_ID_LENGTH;
  const longest = Math.max(0, ...hex.map((id) => id.length));
  while (
    length < longest &&
    new Set(hex.map((id) => id.slice(0, length))).size < hex.length
  ) {
    length += 1;
  }
  return ids.map((id) => (SHORT_ID.test(id) ? id.slice(0, length) : id));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Tue 3 Nov", for a YYYY-MM-DD date. */
export function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month! - 1]}`;
}

type Role = keyof Paint | "plain";
interface Cell {
  text: string;
  role: Role;
  align?: "end";
}

const GAP = "  ";
const UNTITLED = "Untitled entry";
/** The narrowest a note gets before the line itself is cut. */
const MIN_NOTE = 1;

/** Notes may hold line breaks; a row never does. */
function oneLine(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** The rows, one line each, ending with a line break. */
export function formatRows(rows: readonly Row[], options: RowOptions): string {
  if (rows.length === 0) return "";
  const ids = displayIds(rows.map((row) => row.id));
  const cells = rows.map((row, index): Cell[] => {
    const note = oneLine(row.note);
    const untitled = !row.project && !row.task && !note;
    const empty = untitled ? "muted" : "plain";
    return [
      { text: row.running ? "●" : "", role: "success" },
      { text: formatClock(row.minutes), role: "plain", align: "end" },
      { text: row.project ?? "—", role: row.project ? "plain" : empty },
      { text: row.task ?? "—", role: row.task ? "plain" : empty },
      { text: untitled ? UNTITLED : note, role: untitled ? "muted" : "plain" },
      { text: row.committed ? "✓" : "", role: "success" },
      { text: ids[index]!, role: "muted" },
      {
        text: row.date === options.today ? "" : formatDay(row.date),
        role: "muted",
      },
      { text: row.tag ?? "", role: "muted" },
    ];
  });

  const NOTE = 4;
  const columnCount = cells[0]!.length;
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(...cells.map((line) => displayWidth(line[column]!.text))),
  );
  // The mark always takes its cell, and the duration at least "0:00" plus one.
  widths[0] = 1;
  widths[1] = Math.max(5, widths[1]!);
  // A column no row fills is left out, except the mark.
  const shown = widths.map((width, column) => column === 0 || width > 0);

  const width =
    options.columns === undefined
      ? undefined
      : Math.max(options.columns - 1, 1);
  if (width !== undefined && shown[NOTE]) {
    const total = lineWidth(widths, shown);
    if (total > width) {
      widths[NOTE] = Math.max(MIN_NOTE, widths[NOTE]! - (total - width));
    }
  }

  return cells
    .map((line) => {
      const fitted = line.map((cell, column) =>
        column === NOTE
          ? { ...cell, text: truncate(cell.text, widths[NOTE]!) }
          : cell,
      );
      const parts = fitted
        .map((cell, column) => ({ cell, column }))
        .filter(({ column }) => shown[column]);
      // Nothing pads past the last cell that holds text.
      let last = parts.length - 1;
      while (last > 0 && parts[last]!.cell.text === "") last -= 1;
      const kept = parts.slice(0, last + 1);
      const pad = (cell: Cell, column: number, isLast: boolean) => {
        if (cell.align === "end") return padStart(cell.text, widths[column]!);
        return isLast ? cell.text : padEnd(cell.text, widths[column]!);
      };
      // One space after the mark, two between the other columns.
      const separator = (index: number) =>
        index === 0 ? "" : index === 1 ? " " : GAP;
      const plainText = kept
        .map(
          ({ cell, column }, index) =>
            separator(index) + pad(cell, column, index === kept.length - 1),
        )
        .join("");
      // Still too wide with the note at its narrowest: cut the line, plain.
      if (width !== undefined && displayWidth(plainText) > width) {
        return `${truncate(plainText, width)}\n`;
      }
      return (
        kept
          .map(({ cell, column }, index) => {
            const text = pad(cell, column, index === kept.length - 1);
            const painted =
              cell.role === "plain" || !cell.text
                ? text
                : text.replace(cell.text, options.paint[cell.role](cell.text));
            return separator(index) + painted;
          })
          .join("") + "\n"
      );
    })
    .join("");
}

/** The widest line the columns make: one space after the mark, two elsewhere. */
function lineWidth(widths: readonly number[], shown: readonly boolean[]) {
  const columns = widths.filter((_, column) => shown[column]);
  return (
    columns.reduce((total, width) => total + width, 0) +
    1 +
    GAP.length * Math.max(0, columns.length - 2)
  );
}
