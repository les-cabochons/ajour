import type { DataToolOutput } from "../../../../packages/shared/agent-tools.ts";
import type { DateRange } from "../refs.ts";
import { weekdayIndex, isoWeekOf } from "../dates.ts";
import type { Paint } from "./style.ts";
import { displayWidth, padEnd, formatClock } from "./text.ts";

type Week = DataToolOutput<"get_week_lines">;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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
function day(date: string, month = true, year = false): string {
  return `${DAYS[weekdayIndex(date)]} ${Number(date.slice(8))}${month ? ` ${MONTHS[Number(date.slice(5, 7)) - 1]}` : ""}${year ? ` ${date.slice(0, 4)}` : ""}`;
}
/** Keep each value in one spreadsheet cell. */
function cell(value: string | undefined): string {
  return (value ?? "").replace(/[\t\r\n\x1b]+/g, " ");
}

/** Print the Commit page's values without recomputing grouping or rounding. */
export function formatWorkday(
  week: Week,
  range: DateRange,
  tty: boolean,
  paint: Paint,
): string {
  const rows = week.sections.flatMap((section) => section.lines);
  const projectWidth = Math.max(
    0,
    ...rows.map((line) => displayWidth(cell(line.projectName))),
  );
  const taskWidth = Math.max(
    0,
    ...rows.map((line) => displayWidth(cell(line.taskName))),
  );
  const lines: string[] = [];
  if (tty) {
    const sameMonth = range.from.slice(0, 7) === range.to.slice(0, 7);
    const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
    const span =
      range.from === range.to
        ? day(range.from, true, true)
        : `${day(range.from, !sameMonth, !sameYear)} – ${day(range.to, true, true)}`;
    const by = week.groupBy === "day-task" ? "day and task" : week.groupBy;
    lines.push(
      paint.accent(`Week ${isoWeekOf(week.weekOf).week} for Workday`) +
        paint.muted(` · ${span} · by ${by} · hours use a comma`),
      paint.muted("─".repeat(70)),
    );
  }
  for (const section of week.sections) {
    if (tty && section.localDate)
      lines.push(paint.bold(day(section.localDate)));
    for (const line of section.lines) {
      const project = cell(line.projectName);
      const task = cell(line.taskName);
      lines.push(
        [
          tty ? `  ${padEnd(project, projectWidth)}` : project,
          tty ? padEnd(task, taskWidth) : task,
          line.hours.toFixed(2).replace(".", ","),
          cell(line.comments),
        ].join("\t"),
      );
    }
  }
  if (tty) {
    const notes: string[] = [];
    for (const item of week.notSent.items)
      notes.push(
        paint.muted(
          `Not sent     ${formatClock(Math.round(item.hours * 60))} on ${cell(item.projectName)}${item.taskName ? ` / ${cell(item.taskName)}` : ""} is local only.`,
        ),
      );
    for (const task of week.waiting.tasks)
      notes.push(
        paint.warning(
          `Waiting      ${formatClock(Math.round(task.hours * 60))} on ${cell(task.taskName)} has no Workday task yet.`,
        ),
      );
    if (week.running)
      notes.push(
        paint.success(
          `Running      ${formatClock(week.running.unsavedMinutes)} on ${cell(week.running.taskName) || "an empty entry"} is not listed. Stop it first.`,
        ),
      );
    if (notes.length) lines.push("", ...notes);
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
