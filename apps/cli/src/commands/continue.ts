import { rememberUndo } from "../config.ts";
import { localDate, type Context } from "../context.ts";
import { formatDay } from "../format/rows.ts";
import { daysBefore, findEntry } from "../lookup.ts";
import { printJson, printRows, say } from "../output.ts";
import { switchRows } from "./start.ts";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Counts more time on an entry, as Continue does: today's entry resumes
 * with its saved time, another day's starts a new entry today with its task
 * and note. Without an ENTRY, the entry saved last.
 */
export async function continueEntry(
  ctx: Context,
  options: { entry?: string },
): Promise<number> {
  const client = await ctx.client();
  const now = ctx.io.now();
  const found = await findEntry(client, options.entry ?? "last", now);
  // The running entry has Stop where Continue is: Ajour says so.
  const entryId =
    found.kind === "entry" ? found.entry.entryId : found.running.timerId;
  const output = await client.call("continue_entry", { entryId });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  printRows(ctx, switchRows(output));
  const day = found.kind === "entry" ? found.entry.date : undefined;
  if (day && day !== localDate(now)) {
    say(
      ctx,
      `Started a new entry today with ${dayName(day, now)}'s task and note.`,
    );
  }
  return 0;
}

/** "Monday" within the last week, else "Tue 27 Oct". */
function dayName(date: string, now: number): string {
  if (date >= localDate(daysBefore(now, 6))) {
    const [year, month, day] = date.split("-").map(Number);
    return WEEKDAYS[new Date(year!, month! - 1, day!).getDay()]!;
  }
  return formatDay(date);
}
