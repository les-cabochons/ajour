import { rememberUndo } from "../config.ts";
import type { Context } from "../context.ts";
import { entryRow, runningRow, type Row } from "../format/rows.ts";
import { findTask } from "../lookup.ts";
import { printJson, printRows, say } from "../output.ts";
import { parseDuration } from "../refs.ts";
import type {
  AgentRunningTimer,
  AgentTimeEntry,
} from "../../../../packages/shared/agent-tools.ts";

export interface StartOptions {
  task?: string;
  note?: string;
  duration?: string;
}

/**
 * Starts an entry today, as Start entry does: on a task, or empty as S
 * starts one. A running entry is saved first, without a prompt: a Switch.
 */
export async function start(
  ctx: Context,
  options: StartOptions,
): Promise<number> {
  // A bad duration is a usage error, before Ajour is asked anything.
  const countedMinutes =
    options.duration === undefined
      ? undefined
      : parseDuration(options.duration, { allowZero: true });
  const client = await ctx.client();
  const target =
    options.task === undefined
      ? undefined
      : await findTask(client, options.task);
  const output = await client.call("start_timer", {
    ...(target ? { projectId: target.projectId, taskId: target.taskId } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
    ...(countedMinutes !== undefined ? { countedMinutes } : {}),
  });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  printRows(ctx, switchRows(output));
  if (!target) say(ctx, "Set its task with: ajour edit running TASK");
  return 0;
}

/** The entry a Switch saved, marked saved, then the one now running. */
export function switchRows(output: {
  running: AgentRunningTimer;
  saved?: AgentTimeEntry;
}): Row[] {
  return [
    ...(output.saved ? [{ ...entryRow(output.saved), tag: "saved" }] : []),
    runningRow(output.running),
  ];
}
