import { z } from "zod";
import type {
  DeckFile,
  DeckHunk,
  DeckPullRequestDiff,
} from "@ajour/shared/deck";
import { sameReviewRef, type DeckReviewRef } from "./draft-review";

/*
 * Viewed marks (#785): the hunks a reviewer marked viewed on a pull
 * request, kept in the renderer's local state across restarts, so they pick
 * up where they stopped. A mark names its hunk by file and by its changed
 * lines, not by its `path#index` id, which shifts when a push adds a hunk
 * above it: after a refresh to a new head, a hunk whose added and removed
 * lines are the same, byte for byte, stays viewed wherever it moved, and a
 * changed one is cleared, as changes since your review compares them
 * (#787, #931).
 *
 * A file is viewed once all its hunks are. Marking hunks says which files
 * turned viewed or not, so the page can tell the code host where it keeps
 * per-file viewed state (GitHub); a file the code host says the user viewed
 * has all its hunks marked here, once per file and head: a file the user
 * marked or unmarked here is theirs, whatever a later read says. Per-hunk
 * marks never leave this computer.
 */

export interface DeckViewedMarks extends DeckReviewRef {
  /** The head the marks were last refreshed at. */
  headSha: string;
  /**
   * Each file's viewed hunks, by path: a hunk's signature, then `#` and its
   * copy number in the file, so two hunks making the same change differ.
   */
  files: Record<string, string[]>;
  /**
   * The files at this head the code host's word no longer marks: taken in
   * from it once already, or marked or unmarked by the user here.
   */
  taken: string[];
  updatedAt: number;
}

/** A file whose hunks all became viewed, or stopped being. */
export interface ViewedFileChange {
  path: string;
  viewed: boolean;
}

/** The pull request's viewed marks, when it has any. */
export function viewedMarksOf(
  all: readonly DeckViewedMarks[],
  ref: DeckReviewRef,
) {
  return all.find((marks) => sameReviewRef(marks, ref));
}

/** cyrb53: a fast 53-bit string hash, as 14 hex digits. */
function hash(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0");
}

/**
 * A hunk's changed lines with their exact bytes, from its patch: each `+`
 * and `-` line after the `@@` line, `\r` kept, and the "\" marker of a
 * changed line with no final newline. A file shown without hunks, binary,
 * too large to read or too large to compare, shows nothing that tells a
 * change, so it is signed with the head too: a new head clears its mark.
 */
function signatureOf(file: DeckFile, hunk: DeckHunk, headSha: string) {
  if (!hunk.header)
    return hash(
      JSON.stringify([
        "file",
        file.status,
        file.previousPath ?? "",
        file.binary,
        headSha,
      ]),
    );
  const lines: string[] = [];
  let inHunk = false;
  let afterChange = false;
  // Splitting at "\n" alone keeps each "\r".
  for (const line of hunk.patch.split("\n")) {
    if (!inHunk) {
      inHunk = line.startsWith("@@");
      continue;
    }
    const changed = line.startsWith("+") || line.startsWith("-");
    if (changed || (afterChange && line.startsWith("\\"))) lines.push(line);
    afterChange = changed;
  }
  return hash(JSON.stringify(lines));
}

/** Each hunk of a diff with its file and its mark's key. */
interface SignedHunk {
  path: string;
  key: string;
}

const signedDiffs = new WeakMap<
  DeckPullRequestDiff,
  ReadonlyMap<string, SignedHunk>
>();

/** The diff's hunks by id, signed once per diff. */
function signed(diff: DeckPullRequestDiff): ReadonlyMap<string, SignedHunk> {
  const known = signedDiffs.get(diff);
  if (known) return known;
  const byId = new Map<string, SignedHunk>();
  for (const file of diff.files) {
    const copies = new Map<string, number>();
    for (const hunk of file.hunks) {
      const signature = signatureOf(file, hunk, diff.headSha);
      const copy = (copies.get(signature) ?? 0) + 1;
      copies.set(signature, copy);
      byId.set(hunk.id, { path: file.path, key: `${signature}#${copy}` });
    }
  }
  signedDiffs.set(diff, byId);
  return byId;
}

/** The hunks of `diff` its marks name. */
export function viewedHunks(
  marks: DeckViewedMarks | undefined,
  diff: DeckPullRequestDiff,
): Set<string> {
  const viewed = new Set<string>();
  if (!marks) return viewed;
  for (const [id, { path, key }] of signed(diff)) {
    if (keysOf(marks.files, path)?.includes(key)) viewed.add(id);
  }
  return viewed;
}

/** Whether every hunk of the file is viewed: then the file is. */
export const fileIsViewed = (file: DeckFile, viewed: ReadonlySet<string>) =>
  file.hunks.every((hunk) => viewed.has(hunk.id));

/** The files of `diff` whose hunks are all viewed. */
function viewedFiles(diff: DeckPullRequestDiff, viewed: ReadonlySet<string>) {
  return new Set(
    diff.files
      .filter((file) => fileIsViewed(file, viewed))
      .map((file) => file.path),
  );
}

/** The marks with the pull request's replaced, or dropped once it has nothing to keep. */
function withMarks(
  all: readonly DeckViewedMarks[],
  ref: DeckReviewRef,
  next: DeckViewedMarks,
) {
  const others = all.filter((marks) => !sameReviewRef(marks, ref));
  return Object.keys(next.files).length || next.taken.length
    ? [...others, next]
    : others;
}

/** Marks naming exactly `viewed`, the hunks of `diff` at its head. */
function marksFor(
  ref: DeckReviewRef,
  diff: DeckPullRequestDiff,
  viewed: ReadonlySet<string>,
  taken: ReadonlySet<string>,
  now: number,
): DeckViewedMarks {
  const files = record<string[]>();
  for (const [id, { path, key }] of signed(diff)) {
    if (viewed.has(id)) (files[path] ??= []).push(key);
  }
  const { pluginId, connectionId, repository, number } = ref;
  return {
    pluginId,
    connectionId,
    repository,
    number,
    headSha: diff.headSha,
    files,
    taken: [...taken],
    updatedAt: now,
  };
}

/**
 * After the review page read the pull request at a new head: the marks of
 * hunks it shows unchanged stay, whatever their position, the rest are
 * cleared, and the code host's word counts again. Returns how many were
 * cleared; the same head changes nothing.
 */
export function refreshViewedMarks(
  all: readonly DeckViewedMarks[],
  ref: DeckReviewRef,
  diff: DeckPullRequestDiff,
  now: number,
): { marks: readonly DeckViewedMarks[]; cleared: number } {
  const marks = viewedMarksOf(all, ref);
  if (!marks || marks.headSha === diff.headSha)
    return { marks: all, cleared: 0 };
  const kept = viewedHunks(marks, diff);
  const before = Object.values(marks.files).reduce(
    (count, keys) => count + keys.length,
    0,
  );
  return {
    marks: withMarks(all, ref, marksFor(ref, diff, kept, new Set(), now)),
    cleared: before - kept.size,
  };
}

/**
 * Marks hunks of `diff` viewed, or not, refreshing marks made at another
 * head first. `files` lists the files whose hunks all became viewed, or
 * stopped being, for the code host. The files it changes are the user's
 * from then on: a later read of the code host doesn't mark them again.
 */
export function setHunksViewed(
  all: readonly DeckViewedMarks[],
  ref: DeckReviewRef,
  diff: DeckPullRequestDiff,
  hunkIds: readonly string[],
  viewed: boolean,
  now: number,
): { marks: readonly DeckViewedMarks[]; files: ViewedFileChange[] } {
  const current = refreshViewedMarks(all, ref, diff, now).marks;
  const marks = viewedMarksOf(current, ref);
  const before = viewedHunks(marks, diff);
  const known = signed(diff);
  const after = new Set(before);
  const taken = new Set(marks?.taken);
  for (const id of hunkIds) {
    const hunk = known.get(id);
    if (!hunk || before.has(id) === viewed) continue;
    if (viewed) after.add(id);
    else after.delete(id);
    taken.add(hunk.path);
  }
  if (after.size === before.size && [...after].every((id) => before.has(id)))
    return { marks: current, files: [] };
  const wasViewed = viewedFiles(diff, before);
  const isViewed = viewedFiles(diff, after);
  const files = diff.files.flatMap((file): ViewedFileChange[] =>
    wasViewed.has(file.path) === isViewed.has(file.path)
      ? []
      : [{ path: file.path, viewed: isViewed.has(file.path) }],
  );
  return {
    marks: withMarks(current, ref, marksFor(ref, diff, after, taken, now)),
    files,
  };
}

/**
 * Marks every hunk of the files the code host says the user viewed, each
 * file once per head: one taken in before, or marked or unmarked by the
 * user since, is left as it is. Paths the diff doesn't have are left out;
 * nothing new returns `all` as it was.
 */
export function adoptViewedFiles(
  all: readonly DeckViewedMarks[],
  ref: DeckReviewRef,
  diff: DeckPullRequestDiff,
  paths: readonly string[],
  now: number,
): readonly DeckViewedMarks[] {
  const current = refreshViewedMarks(all, ref, diff, now).marks;
  const marks = viewedMarksOf(current, ref);
  const taken = new Set(marks?.taken);
  const wanted = new Set(paths.filter((path) => !taken.has(path)));
  const files = diff.files.filter((file) => wanted.has(file.path));
  if (!files.length) return all;
  const viewed = viewedHunks(marks, diff);
  for (const file of files) {
    taken.add(file.path);
    for (const hunk of file.hunks) viewed.add(hunk.id);
  }
  return withMarks(current, ref, marksFor(ref, diff, viewed, taken, now));
}

/** The marks of the pull requests in `refs`; all kept returns `all`. */
export function forgetViewedMarks(
  all: readonly DeckViewedMarks[],
  refs: readonly DeckReviewRef[],
): readonly DeckViewedMarks[] {
  const kept = all.filter((marks) =>
    refs.some((ref) => sameReviewRef(marks, ref)),
  );
  return kept.length === all.length ? all : kept;
}

const storedMarksSchema = z.object({
  pluginId: z.string().min(1),
  connectionId: z.string().min(1),
  repository: z.string().min(1),
  number: z.number().int().positive(),
  headSha: z.string().min(1),
  files: z.record(z.string(), z.array(z.string().min(1))),
  taken: z.array(z.string()).default([]),
  updatedAt: z.number().int().nonnegative(),
});

/**
 * A record keyed by file paths. It has no prototype, so a file named
 * `constructor` or `__proto__` is a key like any other.
 */
function record<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** The keys marked in `path`, read as an own property. */
function keysOf(
  files: Record<string, string[]>,
  path: string,
): string[] | undefined {
  return Object.hasOwn(files, path) ? files[path] : undefined;
}

/** The stored viewed marks it can read. */
export function normalizeViewedMarks(value: unknown): DeckViewedMarks[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): DeckViewedMarks[] => {
    const parsed = storedMarksSchema.safeParse(raw);
    if (!parsed.success) return [];
    // The schema copies `files` into a plain object, which drops a
    // `__proto__` key: rebuild it from the stored entries.
    const stored = (raw as { files: Record<string, unknown> }).files;
    const files = record<string[]>();
    for (const [path, keys] of Object.entries(stored)) {
      const read = z.array(z.string().min(1)).safeParse(keys);
      if (!read.success) return [];
      files[path] = read.data;
    }
    return [{ ...parsed.data, files }];
  });
}
