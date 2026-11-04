import { rememberUndo } from "../config.ts";
import type { Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import { entryRow, runningRow } from "../format/rows.ts";
import { findEntry, findTask } from "../lookup.ts";
import { printJson, printRows, say } from "../output.ts";
import { parseDuration, parseEntryRef } from "../refs.ts";
import type { AjourClient } from "../client.ts";
import type { AgentTimeEntry } from "../../../../packages/shared/agent-tools.ts";

export interface EditOptions {
  entry?: string;
  task?: string;
  note?: string;
  duration?: string;
}

const DIFFERS_FROM_WORKDAY =
  "Now differs from what Workday holds. It shows as updated on the Commit page.";

/**
 * Changes an entry's task, note or time, as its form does in Ajour. The
 * running entry keeps running, and `-d` corrects its counted time: it
 * counts on from there. `-m ""` clears the note.
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
  const ref = parseEntryRef(options.entry);
  if (
    options.task === undefined &&
    options.note === undefined &&
    options.duration === undefined
  ) {
    throw new UsageError("Say what to change: a TASK, -m NOTE or -d DURATION.");
  }
  // Zero is for the running entry alone, which may turn out to be the one
  // an id names: a saved entry checks again once it is found.
  const minutes =
    options.duration === undefined
      ? undefined
      : parseDuration(options.duration, { allowZero: true });
  const client = await ctx.client();
  // `running` needs no read: with nothing running, Ajour refuses the edit.
  const found =
    ref.kind === "running"
      ? undefined
      : await findEntry(client, options.entry, ctx.io.now());
  if (found?.kind === "entry") {
    if (minutes === 0 && options.duration !== undefined) {
      parseDuration(options.duration, { allowZero: false });
    }
    return editSaved(ctx, client, found.entry, { ...options, minutes });
  }
  const target =
    options.task === undefined
      ? undefined
      : await findTask(client, options.task);
  const output = await client.call("edit_running_entry", {
    ...(target ? { projectId: target.projectId, taskId: target.taskId } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
    ...(minutes !== undefined ? { countedMinutes: minutes } : {}),
  });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  printRows(ctx, [runningRow(output.running)]);
  return 0;
}

/**
 * A saved entry's edit. A committed entry that no longer matches what
 * Workday holds shows as updated on the Commit page, and the user hears so.
 */
async function editSaved(
  ctx: Context,
  client: AjourClient,
  entry: AgentTimeEntry,
  options: { task?: string; note?: string; minutes?: number },
): Promise<number> {
  const target =
    options.task === undefined
      ? undefined
      : await findTask(client, options.task);
  const output = await client.call("edit_entry", {
    entryId: entry.entryId,
    ...(target ? { projectId: target.projectId, taskId: target.taskId } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
    ...(options.minutes !== undefined ? { minutes: options.minutes } : {}),
  });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
  } else {
    printRows(ctx, [entryRow(output)]);
  }
  if (entry.state === "committed" && output.state !== "committed") {
    say(ctx, DIFFERS_FROM_WORKDAY, "warning");
  }
  return 0;
}
