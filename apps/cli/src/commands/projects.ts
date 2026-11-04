import type { Context } from "../context.ts";
import { UsageError } from "../errors.ts";
import { delimitedRows } from "../format/log.ts";
import { displayWidth, padEnd, truncate } from "../format/text.ts";

export async function projects(ctx: Context, format?: string): Promise<number> {
  const selected = ctx.json
    ? "json"
    : (format ?? (ctx.io.stdout.isTTY ? "table" : "tsv"));
  if (!["table", "tsv", "csv", "json"].includes(selected))
    throw new UsageError("--format takes table, tsv, csv or json.");
  const data = await (await ctx.client()).call("list_projects", {});
  if (ctx.quiet) return 0;
  if (selected === "json") {
    ctx.io.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return 0;
  }
  const rows = [
    ["project", "task", "key", "commits_as"],
    ...data.projects.flatMap((project) =>
      project.tasks.length === 0
        ? [[project.code || project.name, "", "", ""]]
        : project.tasks.map((task) => [
            project.code || project.name,
            task.name,
            task.pinnedSlot === undefined ? "" : String(task.pinnedSlot % 10),
            task.commitsAs?.kind === "task"
              ? (task.commitsAs.name ?? "")
              : task.commitsAs?.kind === "own" || task.commitsAs === undefined
                ? task.name
                : task.commitsAs.kind,
          ]),
    ),
  ];
  if (selected === "tsv" || selected === "csv")
    ctx.io.stdout.write(delimitedRows(rows, selected));
  else {
    const clean = rows.map((row) =>
      row.map((cell) => cell.replace(/[\x00-\x1f\x7f]/g, " ")),
    );
    const widths = rows[0]!.map((_, i) =>
      Math.max(...clean.map((row) => displayWidth(row[i]!))),
    );
    ctx.io.stdout.write(
      clean
        .map((row) => {
          const line = row
            .map((cell, i) => padEnd(cell, widths[i]!))
            .join("  ")
            .trimEnd();
          return ctx.io.stdout.columns
            ? truncate(line, ctx.io.stdout.columns)
            : line;
        })
        .join("\n") + "\n",
    );
  }
  return 0;
}
