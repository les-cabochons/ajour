import { rememberUndo } from "../config.ts";
import { localDate, type Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import { entryRow } from "../format/rows.ts";
import { findTask } from "../lookup.ts";
import { printJson, printRows } from "../output.ts";
import { parseDay, parseDuration } from "../refs.ts";

export interface AddOptions {
  task?: string;
  note?: string;
  duration?: string;
  /** The DAY to save it on, today by default. */
  on?: string;
}

/**
 * Saves an entry without running it, as Save in the entry editor does: a
 * forgotten hour on the day it belongs to.
 */
export async function add(ctx: Context, options: AddOptions): Promise<number> {
  if (options.task === undefined) {
    throw new UsageError(
      "add takes a TASK, such as: ajour add ajr/review -d 45m",
    );
  }
  if (options.duration === undefined) {
    throw new UsageError(
      "add takes -d DURATION, such as: ajour add ajr/review -d 45m",
    );
  }
  // Bad values are usage errors, before Ajour is asked anything.
  const minutes = parseDuration(options.duration, { allowZero: false });
  const date = parseDay(options.on ?? "today", localDate(ctx.io.now()));
  const client = await ctx.client();
  const target = await findTask(client, options.task);
  const output = await client.call("create_entry", {
    date,
    projectId: target.projectId,
    taskId: target.taskId,
    ...(options.note !== undefined ? { note: options.note } : {}),
    minutes,
  });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  printRows(ctx, [entryRow(output)]);
  return 0;
}
