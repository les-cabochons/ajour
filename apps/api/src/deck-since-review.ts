import type { FileDiff, Hunk } from "../../../packages/review-deck/diff.ts";
import type { DeckSinceReview } from "../../../packages/shared/deck.ts";

/*
 * Changes since your review (#787), the comparison itself: which hunks of
 * the diff on screen are the same as in the version the user reviewed, and
 * the version each other one last changed in. A hunk is the same when its
 * file shows a hunk with the same added and removed lines, byte for byte,
 * in that version's diff, at any position: a rebase that only moves a hunk
 * leaves it unchanged. Its context lines and line numbers don't count.
 */

/** The hunks of a diff, by file path, as signatures with how often each appears. */
export type DiffSignatures = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * What a hunk changes, as one string: its added and removed lines in order.
 * A file shown without lines, binary or only renamed, is its status, its
 * base path and whether it is binary.
 */
export function hunkSignature(file: FileDiff, hunk: Hunk): string {
  const changed = hunk.lines.filter((line) => line.kind !== "ctx");
  if (!hunk.header || !changed.length) {
    return JSON.stringify([
      "file",
      file.status,
      file.oldPath ?? "",
      file.binary,
    ]);
  }
  return JSON.stringify(
    changed.map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`),
  );
}

export function diffSignatures(files: readonly FileDiff[]): DiffSignatures {
  const byPath = new Map<string, Map<string, number>>();
  for (const file of files) {
    const signatures = byPath.get(file.path) ?? new Map<string, number>();
    for (const hunk of file.hunks) {
      const signature = hunkSignature(file, hunk);
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
  current: readonly FileDiff[];
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
  for (const file of options.current) {
    // A file showing the same hunk twice: the second copy is the same only
    // where a version shows it twice too.
    const seen = new Map<string, number>();
    for (const hunk of file.hunks) {
      const signature = hunkSignature(file, hunk);
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
