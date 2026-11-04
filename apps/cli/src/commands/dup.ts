import { rememberUndo } from "../config.ts";
import { localDate, type Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import { placedRow } from "../format/rows.ts";
import { findEntry, writeId } from "../lookup.ts";
import { printJson, printRows } from "../output.ts";
import { parseDay, parseEntryRef } from "../refs.ts";

/**
 * Copies an entry, as Duplicate does on its own day and Duplicate to… on
 * another, and prints the copy's row with its day. The copy is saved, even
 * of a committed entry.
 */
export async function dup(
  ctx: Context,
  options: { entry?: string; to?: string },
): Promise<number> {
  if (options.entry === undefined) {
    throw new UsageError(
      "dup takes an ENTRY, such as: ajour dup last --to mon",
    );
  }
  parseEntryRef(options.entry);
  const now = ctx.io.now();
  const today = localDate(now);
  const date =
    options.to === undefined ? undefined : parseDay(options.to, today);
  const client = await ctx.client();
  const found = await findEntry(client, options.entry, now);
  const output = await client.call("duplicate_entry", {
    entryId: writeId(found),
    ...(date !== undefined ? { date } : {}),
  });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  printRows(ctx, [placedRow(output, today)]);
  return 0;
}
