import { claimUndo, forgetClaimedUndo, restoreClaimedUndo } from "../config.ts";
import type { Context } from "../context.ts";
import { CliError, EXIT, RefusedError } from "../errors.ts";
import { printJson, say } from "../output.ts";

/**
 * Presses the Undo of the last change made from this terminal, as its toast
 * in Ajour would. The token is claimed first, so another terminal's write
 * meanwhile keeps its own. Used or refused, the claimed token is forgotten;
 * one Ajour never heard goes back, unless a newer one took its place.
 */
export async function undo(ctx: Context): Promise<number> {
  const claim = await claimUndo(ctx.io);
  if (!claim) {
    throw new CliError("Nothing to undo from here.", EXIT.refused, "");
  }
  let output;
  try {
    const client = await ctx.client();
    output = await client.call("undo", { undoToken: claim.undoToken });
  } catch (error) {
    // A token Ajour refused stays refused; one it never heard may still work.
    if (error instanceof RefusedError) await forgetClaimedUndo(claim);
    else await restoreClaimedUndo(ctx.io, claim);
    throw error;
  }
  await forgetClaimedUndo(claim);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  say(ctx, `Undid: ${output.undone}`);
  return 0;
}
