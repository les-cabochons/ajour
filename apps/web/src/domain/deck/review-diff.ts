import type { DeckFile, DeckHunk } from "@ajour/shared/deck";

/*
 * How Deck's review page reads a pull request's diff, as the local API built
 * it with Review Deck's `buildDiff`. A hunk is rendered on its own, so each
 * one mounts when it nears the screen.
 */

/** One hunk as a unified diff of its file, which the diff renderer reads. */
export function hunkPatch(file: DeckFile, hunk: DeckHunk): string {
  const oldPath =
    file.status === "added"
      ? "/dev/null"
      : `a/${file.previousPath ?? file.path}`;
  const newPath = file.status === "deleted" ? "/dev/null" : `b/${file.path}`;
  return [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    hunk.header,
    ...hunk.lines,
    "",
  ].join("\n");
}

/**
 * Why a file shows no lines: a binary or too large file, one renamed
 * without changes, or an empty one. Undefined when it has lines.
 */
export function fileWithoutLines(file: DeckFile): string | undefined {
  if (file.hunks.some((hunk) => hunk.header)) return undefined;
  if (file.binary) return "Binary file not shown.";
  if (file.status === "renamed") return "Renamed without changes.";
  if (file.status === "added" || file.status === "deleted")
    return "Empty file.";
  return "No changes to show.";
}

/** Names a hunk for assistive technology: its file and its lines in the head. */
export function hunkLabel(file: DeckFile, hunk: DeckHunk): string {
  const removedOnly = hunk.newLines === 0;
  const start = removedOnly ? hunk.oldStart : hunk.newStart;
  const count = removedOnly ? hunk.oldLines : hunk.newLines;
  const lines =
    count === 1 ? `line ${start}` : `lines ${start} to ${start + count - 1}`;
  return `${file.path}, ${removedOnly ? "removed " : ""}${lines}`;
}
