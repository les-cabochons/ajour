import { rememberUndo } from "../config.ts";
import type { Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import { findEntry, writeId } from "../lookup.ts";
import { printJson, say } from "../output.ts";
import { parseEntryRef } from "../refs.ts";

/**
 * Deletes entries, as Delete does on a selection: every ENTRY is found
 * first, so one that finds nothing deletes none, then one call deletes
 * them all with one Undo.
 */
export async function rm(
  ctx: Context,
  options: { entries: readonly string[] },
): Promise<number> {
  if (options.entries.length === 0) {
    throw new UsageError(
      "rm takes one or more ENTRY, such as: ajour rm b7e1d04",
    );
  }
  for (const entry of options.entries) parseEntryRef(entry);
  const client = await ctx.client();
  const now = ctx.io.now();
  const entryIds: string[] = [];
  for (const entry of options.entries) {
    const id = writeId(await findEntry(client, entry, now));
    if (!entryIds.includes(id)) entryIds.push(id);
  }
  const output = await client.call("delete_entries", { entryIds });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  const noun = output.deleted === 1 ? "entry" : "entries";
  const undo = output.undoToken ? " Undo with: ajour undo" : "";
  say(ctx, `Deleted ${output.deleted} ${noun}.${undo}`);
  return 0;
}
