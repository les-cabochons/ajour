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

const lineCount = (count: number) =>
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
        ? lineCount(newLines)
        : file.status === "deleted"
          ? lineCount(oldLines)
          : `${lineCount(oldLines)} before and ${newLines.toLocaleString("en-US")} after`;
    return `Not shown: too large to compare here, ${counts}.`;
  }
  if (file.binary) return "Not shown: a binary file, or one too large to read.";
  if (file.status === "renamed") return "Renamed without changes.";
  if (file.status === "added" || file.status === "deleted")
    return "Empty file.";
  return "No changes to show.";
}

/** A path's segments, each encoded for a URL, its slashes kept. */
const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

/**
 * Where the code host shows a file of the pull request at `url`: on GitHub,
 * the file at the head, or at the base once deleted; on Azure DevOps, the
 * file in the pull request's files. On a code host whose pull request
 * addresses it doesn't know, the pull request itself.
 */
export function fileOnCodeHost(
  url: string,
  file: Pick<DeckFile, "path" | "status">,
  versions: { headSha: string; baseSha: string },
): string {
  const github = /^(https?:\/\/[^?#]+)\/pull\/\d+\/?$/.exec(url);
  if (github) {
    const sha = file.status === "deleted" ? versions.baseSha : versions.headSha;
    return `${github[1]}/blob/${sha}/${encodePath(file.path)}`;
  }
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
