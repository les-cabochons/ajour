import { localDate, type Context } from "./context.ts";
import { formatRows, type Row } from "./format/rows.ts";
import { painter, shouldColor, type Paint } from "./format/style.ts";

/**
 * How a write answers: its rows on stdout, its sentences on stderr, or the
 * tool's output with --json. -q prints none of it.
 */

/** Rows on stdout, cut to the terminal's width, plain in a pipe. */
export function printRows(ctx: Context, rows: readonly Row[]): void {
  if (ctx.quiet) return;
  ctx.io.stdout.write(
    formatRows(rows, {
      paint: ctx.paint,
      today: localDate(ctx.io.now()),
      columns: ctx.io.stdout.isTTY ? ctx.io.stdout.columns : undefined,
    }),
  );
}

/** A sentence for the user on stderr, muted, such as how to undo. */
export function say(
  ctx: Context,
  message: string,
  role: keyof Paint = "muted",
): void {
  if (ctx.quiet) return;
  const paint = painter(
    shouldColor(ctx.color, { isTTY: ctx.io.stderr.isTTY, env: ctx.io.env }),
  );
  ctx.io.stderr.write(`${paint[role](message)}\n`);
}

/** The tool's output as it is, for --json. */
export function printJson(ctx: Context, value: unknown): void {
  if (ctx.quiet) return;
  ctx.io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
