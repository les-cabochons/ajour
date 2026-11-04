import { forgetUndo, readUndo } from "../config.ts";
import type { Context } from "../context.ts";
import { CliError, EXIT, RefusedError } from "../errors.ts";
import { printJson, say } from "../output.ts";

/**
 * Presses the Undo of the last change made from this terminal, as its toast
 * in Ajour would. The token is used once: done or refused, it is forgotten.
 */
export async function undo(ctx: Context): Promise<number> {
  const undoToken = await readUndo(ctx.io);
  if (!undoToken) {
    throw new CliError("Nothing to undo from here.", EXIT.refused, "");
  }
  const client = await ctx.client();
  let output;
  try {
    output = await client.call("undo", { undoToken });
  } catch (error) {
    // A token Ajour refused stays refused; one it never heard may still work.
    if (error instanceof RefusedError) await forgetUndo(ctx.io);
    throw error;
  }
  await forgetUndo(ctx.io);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  say(ctx, `Undid: ${output.undone}`);
  return 0;
}
