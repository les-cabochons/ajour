import { rememberUndo } from "../config.ts";
import { localDate, type Context } from "../context.ts";
import { entryRow } from "../format/rows.ts";
import { formatClock } from "../format/text.ts";
import { printJson, printRows, say } from "../output.ts";

/** Stops and saves the running entry, then says where today stands. */
export async function stop(ctx: Context): Promise<number> {
  const client = await ctx.client();
  const output = await client.call("stop_timer", {});
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  if (output.entry)
    printRows(ctx, [{ ...entryRow(output.entry), tag: "saved" }]);
  const today = localDate(ctx.io.now());
  const { entries, targets } = await client.call("list_time_entries", {
    from: today,
    to: today,
  });
  // An entry a running one continues counts in the running entry instead.
  const minutes = entries
    .filter((entry) => entry.state !== "running")
    .reduce((total, entry) => total + entry.minutes, 0);
  const target = targets?.find((day) => day.date === today)?.hours ?? 0;
  say(
    ctx,
    `Today ${formatClock(minutes)}${target > 0 ? ` of ${formatClock(target * 60)}` : ""}`,
  );
  return 0;
}
