// Builds a pull request's diff from both versions of each changed file, as Review Deck does before grouping.
// Ajour copies only this part of upstream extension/src/review/analysis.ts (VENDORED.md).
import { structuredPatch } from "diff";

/** How a file changed (upstream extension/src/data/model.ts). */
export type ChangeType = "add" | "edit" | "delete" | "rename";

/** One changed file of a pull request (upstream extension/src/data/model.ts, without Azure DevOps' ids). */
export interface FileChange {
  /** Repo path without the leading slash. */
  path: string;
  originalPath?: string;
  changeType: ChangeType;
}

/** Old/new text for every changed file, keyed by repo path. `null` = absent on that side. */
export interface FileContents {
  old: string | null;
  new: string | null;
  binary: boolean;
  tooLarge: boolean;
}

export function buildDiff(changes: FileChange[], contents: Map<string, FileContents>): string {
  return changes.map((c) => fileDiff(c, contents.get(c.path)!)).join("");
}

/** One file's section of a `git diff -M` style patch, so the shared diff parser can consume it. */
function fileDiff(change: FileChange, content: FileContents): string {
  const oldPath = change.originalPath ?? change.path;
  const head = [`diff --git a/${oldPath} b/${change.path}`];
  if (change.changeType === "add") head.push("new file mode 100644");
  if (change.changeType === "delete") head.push("deleted file mode 100644");
  if (change.changeType === "rename") {
    head.push(`similarity index ${content.old === content.new ? 100 : 90}%`, `rename from ${oldPath}`, `rename to ${change.path}`);
  }
  if (content.binary || content.tooLarge) {
    return `${[...head, `Binary files a/${oldPath} and b/${change.path} differ`].join("\n")}\n`;
  }
  if (content.old === content.new) return `${head.join("\n")}\n`;

  const patch = structuredPatch(oldPath, change.path, content.old ?? "", content.new ?? "", "", "", { context: 3 });
  const lines = [
    ...head,
    `--- ${change.changeType === "add" ? "/dev/null" : `a/${oldPath}`}`,
    `+++ ${change.changeType === "delete" ? "/dev/null" : `b/${change.path}`}`,
  ];
  for (const h of patch.hunks) {
    lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    lines.push(...h.lines);
  }
  return `${lines.join("\n")}\n`;
}
