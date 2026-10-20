/**
 * A three-way merge of two edits of one text, line by line, as Ajour merges
 * a synced description the user saves with what changed in the source since
 * the last sync. Changes to different lines, even neighbouring ones, merge;
 * the same change on both sides counts once; different changes to the same
 * lines, or different lines added at the same place, are a conflict.
 */

export type TextMerge = { merged: string } | { conflict: true };

/** One change from the base: base lines [start, end) became `lines`. */
interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

/** Past this many line pairs, a line diff costs too much; only a one-sided change merges. */
const MAX_DIFF_CELLS = 4_000_000;

function splitLines(text: string) {
  return text === "" ? [] : text.split("\n");
}

/** The changes from `base` to `edited`, in order, from a longest common subsequence of lines. */
function diff(base: string[], edited: string[]): Hunk[] | undefined {
  const n = base.length;
  const m = edited.length;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return undefined;
  // lcs[i][j]: the longest common subsequence of base[i..] and edited[j..].
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        base[i] === edited[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }
  const hunks: Hunk[] = [];
  let open: Hunk | undefined;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === edited[j]) {
      if (open) hunks.push(open);
      open = undefined;
      i += 1;
      j += 1;
    } else if (
      j < m &&
      (i === n || lcs[i * width + j + 1]! >= lcs[(i + 1) * width + j]!)
    ) {
      open ??= { start: i, end: i, lines: [] };
      open.lines.push(edited[j]!);
      j += 1;
    } else {
      open ??= { start: i, end: i, lines: [] };
      i += 1;
      open.end = i;
    }
  }
  if (open) hunks.push(open);
  return hunks;
}

function sameHunk(a: Hunk, b: Hunk) {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.lines.length === b.lines.length &&
    a.lines.every((line, index) => line === b.lines[index])
  );
}

/**
 * Whether two changes touch the same base lines, or add lines at the same
 * place. Changes to neighbouring lines do not overlap.
 */
function overlap(a: Hunk, b: Hunk) {
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return b.start < a.start && a.start < b.end;
  if (b.start === b.end) return a.start < b.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

export function mergeTexts(
  base: string,
  local: string,
  remote: string,
): TextMerge {
  if (local === remote || remote === base) return { merged: local };
  if (local === base) return { merged: remote };
  const baseLines = splitLines(base);
  const ours = diff(baseLines, splitLines(local));
  const theirs = diff(baseLines, splitLines(remote));
  if (!ours || !theirs) return { conflict: true };

  const merged: string[] = [];
  let at = 0;
  let o = 0;
  let t = 0;
  while (o < ours.length || t < theirs.length) {
    const mine = ours[o];
    const other = theirs[t];
    let next: Hunk;
    if (mine && other && overlap(mine, other)) {
      if (!sameHunk(mine, other)) return { conflict: true };
      next = mine;
      o += 1;
      t += 1;
    } else if (
      mine &&
      (!other ||
        mine.start < other.start ||
        (mine.start === other.start && mine.end <= other.start))
    ) {
      next = mine;
      o += 1;
    } else {
      next = other!;
      t += 1;
    }
    merged.push(...baseLines.slice(at, next.start), ...next.lines);
    at = next.end;
  }
  merged.push(...baseLines.slice(at));
  return { merged: merged.join("\n") };
}
