import { rememberUndo } from "../config.ts";
import { localDate, type Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import { placedRow } from "../format/rows.ts";
import { findEntry, writeId } from "../lookup.ts";
import { printJson, printRows } from "../output.ts";
import { parseDay, parseEntryRef } from "../refs.ts";

/**
 * Moves an entry to another day, as Move to… does, and prints its row with
 * the day it landed on.
 */
export async function move(
  ctx: Context,
  options: { entry?: string; to?: string },
): Promise<number> {
  if (options.entry === undefined) {
    throw new UsageError(
      "move takes an ENTRY, such as: ajour move last --to mon",
    );
  }
  if (options.to === undefined) {
    throw new UsageError(
      `move takes --to DAY, such as: ajour move ${options.entry} --to mon`,
    );
  }
  parseEntryRef(options.entry);
  const now = ctx.io.now();
  const today = localDate(now);
  const date = parseDay(options.to, today);
  const client = await ctx.client();
  const found = await findEntry(client, options.entry, now);
  const output = await client.call("move_entry", {
    entryId: writeId(found),
    date,
  });
  await rememberUndo(ctx.io, output.undoToken);
  if (ctx.json) {
    printJson(ctx, output);
    return 0;
  }
  printRows(ctx, [placedRow(output, today)]);
  return 0;
}
