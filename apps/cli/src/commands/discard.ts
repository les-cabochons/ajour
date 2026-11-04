import { rememberUndo } from "../config.ts";
import type { Context } from "../context.ts";
import { formatClock } from "../format/text.ts";
import { printJson, say } from "../output.ts";

/**
 * Throws away the running entry's time since it last started, as Discard
 * does. A continued entry keeps its saved time.
 */
export async function discard(ctx: Context): Promise<number> {
  const client = await ctx.client();
  // Read first only to name it; with nothing running, Ajour refuses below.
  const { running } = await client.call("get_running_timer", {});
  const output = await client.call("discard_timer", {});
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  const name = running?.taskName || running?.projectName;
  const undo = output.undoToken ? " Undo with: ajour undo" : "";
  say(
    ctx,
    `Discarded ${formatClock(output.discardedMinutes)}${name ? ` on ${name}` : ""}.${undo}`,
  );
  return 0;
}
