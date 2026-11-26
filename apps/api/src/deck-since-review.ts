import {
  parseDiff,
  type FileDiff,
  type Hunk,
} from "../../../packages/review-deck/diff.ts";
import type { DeckSinceReview } from "../../../packages/shared/deck.ts";

/*
 * Changes since your review (#787), the comparison itself: which hunks of
 * the diff on screen are the same as in the version the user reviewed, and
 * the version each other one last changed in. A hunk is the same when its
 * file shows a hunk with the same added and removed lines, byte for byte,
 * in that version's diff, at any position: a rebase that only moves a hunk
 * leaves it unchanged. Its context lines and line numbers don't count; its
 * line endings and a missing final newline do. The signatures come from
 * the patch text itself, since the parser normalizes CRLF and drops the
 * "\ No newline at end of file" markers.
 */

/** The hunks of a diff, by file path, as signatures with how often each appears. */
export type DiffSignatures = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** A file of a patch with each of its hunks signed, in the patch's order. */
interface SignedFile {
  file: FileDiff;
  hunks: { hunk: Hunk; signature: string }[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/;

/**
 * Each file section of `patch`, and each hunk in it as its changed lines
 * with their exact bytes. A changed line the patch marks as the end of a
 * file with no final newline is followed by the marker "\".
 */
function exactChangedLines(patch: string): string[][][] {
  const files: string[][][] = [];
  let hunks: string[][] | undefined;
  let hunk: string[] | undefined;
  // The line before was a changed one, which a marker belongs to.
  let afterChange = false;
  // Splitting at "\n" alone keeps each "\r", and yields the parser's lines.
  for (const line of patch.split("\n")) {
    let changed = false;
    if (line.startsWith("diff --git ")) {
      hunks = [];
      files.push(hunks);
      hunk = undefined;
    } else if (hunks && HUNK_HEADER.test(line)) {
      hunk = [];
      hunks.push(hunk);
    } else if (hunk && (line.startsWith("+") || line.startsWith("-"))) {
      hunk.push(line);
      changed = true;
    } else if (hunk && afterChange && line.startsWith("\\")) {
      hunk.push("\\");
    }
    afterChange = changed;
  }
  return files;
}

/**
 * The files and hunks of a patch, each hunk signed with what it changes:
 * its added and removed lines in order, byte for byte. A file shown
 * without lines, binary or only renamed, is signed with its status, its
 * base path and whether it is binary, and one too large to compare also
 * with its index line, its versions' hashes (`diff-worker.ts`).
 */
export function signedDiff(patch: string): SignedFile[] {
  const exact = exactChangedLines(patch);
  return parseDiff(patch).map((file, fileIndex) => {
    const index = file.headerLines.find((line) => line.startsWith("index "));
    return {
      file,
      hunks: file.hunks.map((hunk, hunkIndex) => {
        const lines = hunk.header ? exact[fileIndex]?.[hunkIndex] : undefined;
        return {
          hunk,
          signature: JSON.stringify(
            lines?.length
              ? lines
              : [
                  "file",
                  file.status,
                  file.oldPath ?? "",
                  file.binary,
                  ...(index ? [index] : []),
                ],
          ),
        };
      }),
    };
  });
}

export function diffSignatures(patch: string): DiffSignatures {
  const byPath = new Map<string, Map<string, number>>();
  for (const { file, hunks } of signedDiff(patch)) {
    const signatures = byPath.get(file.path) ?? new Map<string, number>();
    for (const { signature } of hunks) {
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    }
    byPath.set(file.path, signatures);
  }
  return byPath;
}

/** Whether the diff shows the `nth` copy (from 1) of a hunk in its file. */
const has = (
  signatures: DiffSignatures,
  path: string,
  signature: string,
  nth: number,
) => (signatures.get(path)?.get(signature) ?? 0) >= nth;

/** A version between the reviewed one and the one on screen, its diff read only when needed. */
export interface VersionBetween {
  number: number;
  signatures: () => Promise<DiffSignatures>;
}

/**
 * The hunks of `current` changed since the version reviewed, in the
 * diff's order. A changed hunk last changed in the version after the last
 * one, walking back from the version on screen through `between` (newest
 * first), whose diff shows it the same. A version's diff is read only when
 * a hunk walks back to it.
 */
export async function changedSinceReview(options: {
  /** The patch on screen. */
  current: string;
  /** The version on screen. */
  version: number;
  reviewed: DiffSignatures;
  /** The versions after the reviewed one and before the one on screen, newest first. */
  between: readonly VersionBetween[];
}): Promise<DeckSinceReview["changed"]> {
  const read = new Map<number, Promise<DiffSignatures>>();
  const signaturesOf = (version: VersionBetween) => {
    let found = read.get(version.number);
    if (!found) {
      found = version.signatures();
      read.set(version.number, found);
    }
    return found;
  };
  const changed: DeckSinceReview["changed"] = [];
  for (const { file, hunks } of signedDiff(options.current)) {
    // A file showing the same hunk twice: the second copy is the same only
    // where a version shows it twice too.
    const seen = new Map<string, number>();
    for (const { hunk, signature } of hunks) {
      const nth = (seen.get(signature) ?? 0) + 1;
      seen.set(signature, nth);
      if (has(options.reviewed, file.path, signature, nth)) continue;
      let version = options.version;
      for (const earlier of options.between) {
        if (!has(await signaturesOf(earlier), file.path, signature, nth)) break;
        version = earlier.number;
      }
      changed.push({ hunkId: hunk.id, version });
    }
  }
  return changed;
}
