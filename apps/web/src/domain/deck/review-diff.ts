import type { DeckFile, DeckHunk } from "@ajour/shared/deck";

/*
 * How Deck's review page reads a pull request's diff, as the local API built
 * it with Review Deck's `buildDiff`. Each hunk carries its own patch, so it
 * mounts on its own when it nears the screen.
 */

/** The quiet note after a file's path: how it changed, unless it was only modified. */
export function fileNote(file: DeckFile): string | undefined {
  if (file.status === "renamed" && file.previousPath)
    return `Renamed from ${file.previousPath}`;
  if (file.status === "added") return "Added";
  if (file.status === "deleted") return "Deleted";
  return undefined;
}

/** "1 line", "4,200 lines". */
const linesOf = (count: number) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? "line" : "lines"}`;

/**
 * Why a file shows no lines: comparing its versions would take too long,
 * Ajour couldn't read it as text, it was renamed without changes, or it is
 * empty. Undefined when it has lines.
 */
export function fileWithoutLines(file: DeckFile): string | undefined {
  if (file.hunks.some((hunk) => hunk.header)) return undefined;
  if (file.tooLarge) {
    const { oldLines, newLines } = file.tooLarge;
    const counts =
      file.status === "added"
        ? linesOf(newLines)
        : file.status === "deleted"
          ? linesOf(oldLines)
          : `${linesOf(oldLines)} before and ${newLines.toLocaleString("en-US")} after`;
    return `Not shown: too large to compare here, ${counts}.`;
  }
  if (file.binary) return "Not shown: a binary file, or one too large to read.";
  if (file.status === "renamed") return "Renamed without changes.";
  if (file.status === "added" || file.status === "deleted")
    return "Empty file.";
  return "No changes to show.";
}

/** GitHub's anchor of a file in a pull request's files: "diff-" and the SHA-256 of its path, in hex. */
async function githubFileAnchor(path: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(path),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `diff-${hex}`;
}

/**
 * Where the code host shows what changed in a file of the pull request at
 * `url`, by its path (a renamed file's new one): on GitHub and on Azure
 * DevOps, the file in the pull request's files. On a code host whose pull
 * request addresses it doesn't know, the pull request itself.
 */
export async function fileOnCodeHost(
  url: string,
  file: Pick<DeckFile, "path">,
): Promise<string> {
  const github = /^(https?:\/\/[^?#]+\/pull\/\d+)\/?$/.exec(url);
  if (github) return `${github[1]}/files#${await githubFileAnchor(file.path)}`;
  if (/^https?:\/\/[^?#]+\/_git\/[^/?#]+\/pullrequest\/\d+\/?$/i.test(url)) {
    return `${url.replace(/\/$/, "")}?_a=files&path=${encodeURIComponent(`/${file.path}`)}`;
  }
  return url;
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

/** A hunk's rows, the lines after its `@@` line, for the height it holds before it mounts. */
export function hunkRowCount(hunk: DeckHunk): number {
  const rows = hunk.patch.split("\n");
  // The patch ends with a newline, so its last element is empty.
  return rows.length - rows.indexOf(hunk.header) - 2;
}
