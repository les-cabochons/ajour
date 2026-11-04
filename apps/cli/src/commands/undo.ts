import { forgetUndo, readUndo } from "../config.ts";
import type { Context } from "../context.ts";
import { CliError, EXIT, RefusedError } from "../errors.ts";
import { printJson, say } from "../output.ts";

/**
 * Presses the Undo of the last change made from this terminal, as its toast
 * in Ajour would. The kept token is read, never taken: only after Ajour
 * answered, used or refused, is it removed, and only if last-undo still holds
 * it, so a change made meanwhile from another terminal keeps its own. When
 * Ajour is out of reach nothing is touched, and the token waits for a retry.
 */
export async function undo(ctx: Context): Promise<number> {
  const undoToken = await readUndo(ctx.io);
  if (!undoToken) {
    throw new CliError("Nothing to undo from here.", EXIT.refused, "");
  }
  let output;
  try {
    const client = await ctx.client();
    output = await client.call("undo", { undoToken });
  } catch (error) {
    // A token Ajour refused stays refused; one it never heard may still work.
    if (error instanceof RefusedError) await forgetUndo(ctx.io, undoToken);
    throw error;
  }
  await forgetUndo(ctx.io, undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  say(ctx, `Undid: ${output.undone}`);
  return 0;
}
