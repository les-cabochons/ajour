import { rememberUndo } from "../config.ts";
import type { Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import { runningRow } from "../format/rows.ts";
import { findTask } from "../lookup.ts";
import { printJson, printRows } from "../output.ts";
import { parseDuration, parseEntryRef } from "../refs.ts";

export interface EditOptions {
  entry?: string;
  task?: string;
  note?: string;
  duration?: string;
}

/**
 * Changes the running entry's task, note or counted time while it keeps
 * running. `-d` corrects the counted time: it counts on from there. Saved
 * entries are edited from the window for now.
 */
export async function edit(
  ctx: Context,
  options: EditOptions,
): Promise<number> {
  if (options.entry === undefined) {
    throw new UsageError(
      "edit takes an ENTRY, such as: ajour edit running TASK",
    );
  }
  if (parseEntryRef(options.entry).kind !== "running") {
    throw new UsageError(
      "Only the running entry can be edited from the terminal yet: ajour edit running",
    );
  }
  if (
    options.task === undefined &&
    options.note === undefined &&
    options.duration === undefined
  ) {
    throw new UsageError("Say what to change: a TASK, -m NOTE or -d DURATION.");
  }
  const countedMinutes =
    options.duration === undefined
      ? undefined
      : parseDuration(options.duration, { allowZero: true });
  const client = await ctx.client();
  const target =
    options.task === undefined
      ? undefined
      : await findTask(client, options.task);
  const output = await client.call("edit_running_entry", {
    ...(target ? { projectId: target.projectId, taskId: target.taskId } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
    ...(countedMinutes !== undefined ? { countedMinutes } : {}),
  });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  printRows(ctx, [runningRow(output.running)]);
  return 0;
}
