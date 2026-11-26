import {
  deckHunkRows,
  type DeckHunk,
  type DeckLinePoint,
  type DeckLinesAnchor,
  type DeckPullRequestDiff,
} from "@ajour/shared/deck";
import { findLine, type AnnotationSide } from "./review-threads";

/*
 * Lines selected in one hunk of Deck's review page (#793). A drag over the
 * line numbers, Shift and a click, Shift and the arrows on the hunk's
 * keyboard button, or two taps on line numbers pick them. Explain and Ask
 * send them as the ask's anchor, Comment opens the composer on one side's
 * lines, and an answer's `path:line` citations lead back to the diff.
 */

/** A line of a hunk as the diff library names it: a removed line by the base's number, any other by the head's. */
export interface LinePoint {
  side: AnnotationSide;
  line: number;
}

/** Lines selected in one hunk, from `start` to `end` in its row order. */
export interface LineSelection {
  hunkId: string;
  path: string;
  start: LinePoint;
  end: LinePoint;
}

/** Lines from one side to another, as the diff library reports and highlights them. */
export interface LibraryRange {
  side: AnnotationSide;
  start: number;
  end: number;
  endSide?: AnnotationSide;
}

const fromPoint = ({ side, line }: DeckLinePoint): LinePoint => ({
  side: side === "base" ? "deletions" : "additions",
  line,
});

/** Each row of a hunk with the point it is on, as the diff library names it. */
const hunkRows = (hunk: DeckHunk) =>
  deckHunkRows(hunk).map((row) => ({ ...row, point: fromPoint(row.point) }));

/** The row `point` is on: a context line is found from either side, a removed one first. */
function rowOf(rows: ReturnType<typeof hunkRows>, point: LinePoint) {
  if (point.side === "additions")
    return rows.findIndex((row) => row.head === point.line);
  const removed = rows.findIndex(
    (row) => row.base === point.line && row.head === undefined,
  );
  return removed >= 0
    ? removed
    : rows.findIndex((row) => row.base === point.line);
}

function hunkOf(diff: DeckPullRequestDiff, hunkId: string) {
  for (const file of diff.files) {
    const hunk = file.hunks.find((entry) => entry.id === hunkId);
    if (hunk) return { file, hunk };
  }
  return undefined;
}

/**
 * The selection the library reports in hunk `hunkId`, its ends in row
 * order, or undefined when the hunk doesn't show them.
 */
export function selectLines(
  diff: DeckPullRequestDiff,
  hunkId: string,
  range: LibraryRange,
): LineSelection | undefined {
  const found = hunkOf(diff, hunkId);
  if (!found) return undefined;
  const rows = hunkRows(found.hunk);
  const a = rowOf(rows, { side: range.side, line: range.start });
  const b = rowOf(rows, {
    side: range.endSide ?? range.side,
    line: range.end,
  });
  if (a < 0 || b < 0) return undefined;
  return {
    hunkId,
    path: found.file.path,
    start: rows[Math.min(a, b)]!.point,
    end: rows[Math.max(a, b)]!.point,
  };
}

const samePoint = (a: LinePoint, b: LinePoint) =>
  a.side === b.side && a.line === b.line;

const oneLine = (selection: LineSelection) =>
  samePoint(selection.start, selection.end);

/**
 * A tap on a line number after another, as the narrow view picks lines:
 * one line tapped, then another of the same hunk, selects both and the
 * lines between. Any other tap starts again from its own line.
 */
export function extendByTap(
  diff: DeckPullRequestDiff,
  before: LineSelection | undefined,
  tapped: LineSelection,
): LineSelection {
  if (
    !before ||
    before.hunkId !== tapped.hunkId ||
    !oneLine(before) ||
    !oneLine(tapped) ||
    samePoint(before.start, tapped.start)
  )
    return tapped;
  return (
    selectLines(diff, tapped.hunkId, {
      start: before.start.line,
      side: before.start.side,
      end: tapped.start.line,
      endSide: tapped.start.side,
    }) ?? tapped
  );
}

const toPoint = ({ side, line }: LinePoint): DeckLinePoint => ({
  side: side === "deletions" ? "base" : "head",
  line,
});

/** The selection as an ask's anchor, on the base's and the head's lines. */
export function linesAnchor(selection: LineSelection): DeckLinesAnchor {
  return {
    kind: "lines",
    path: selection.path,
    start: toPoint(selection.start),
    end: toPoint(selection.end),
  };
}

/** The lines an ask's anchor names, back in hunk `hunkId`. */
export function anchorSelection(
  hunkId: string,
  anchor: DeckLinesAnchor,
): LineSelection {
  return {
    hunkId,
    path: anchor.path,
    start: fromPoint(anchor.start),
    end: fromPoint(anchor.end),
  };
}

/**
 * The lines Comment opens the composer on: a comment is on one side, so
 * the side of the selection's last line, from the first selected row that
 * side numbers to that line.
 */
export function commentLines(
  diff: DeckPullRequestDiff,
  selection: LineSelection,
): { side: AnnotationSide; start: number; end: number } {
  const { side, line: end } = selection.end;
  const found = hunkOf(diff, selection.hunkId);
  if (!found) return { side, start: end, end };
  const rows = hunkRows(found.hunk);
  const first = rowOf(rows, selection.start);
  const last = rowOf(rows, selection.end);
  const numbered = rows
    .slice(Math.max(first, 0), last + 1)
    .map((row) => (side === "additions" ? row.head : row.base))
    .find((line) => line !== undefined);
  return { side, start: numbered ?? end, end };
}

/** Where a link to a line of the diff points: `citation:` and `path:line` or `path:first-last`. */
const CITATION = "citation:";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Each diff's citation pattern, built once: a pull request can change 3,000 files. */
const patterns = new WeakMap<DeckPullRequestDiff, RegExp | null>();

function citationPattern(diff: DeckPullRequestDiff) {
  if (patterns.has(diff)) return patterns.get(diff)!;
  const alternatives = diff.files
    .map((file) => file.path)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  const pattern = alternatives
    ? new RegExp(
        `(?<![\\w./\\-\\[])(\`?)(${alternatives}):(\\d+)(?:[-–](\\d+))?\\1(?![\\w(\\]])`,
        "g",
      )
    : null;
  patterns.set(diff, pattern);
  return pattern;
}

/**
 * The answer's Markdown with each `path:line` (or `path:first-last`) of a
 * file the diff changes made a citation link, in inline code or in the
 * text, so it reads as written and scrolls to its line. Code blocks, other
 * paths, and lines no hunk shows stay as they are.
 */
export function linkCitations(text: string, diff: DeckPullRequestDiff): string {
  const pattern = citationPattern(diff);
  if (!pattern) return text;
  const shown = (path: string, line: number) =>
    findLine(diff, { path, side: "head", line }) !== undefined ||
    findLine(diff, { path, side: "base", line }) !== undefined;
  let fenced = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(
        pattern,
        (whole, _tick: string, path: string, first: string, last?: string) =>
          shown(path, Number(first))
            ? `[${whole}](${CITATION}${encodeURI(path)}:${first}${last ? `-${last}` : ""})`
            : whole,
      );
    })
    .join("\n");
}

/** Whether a link is a citation of `linkCitations`. */
export function isCitation(href: string | undefined): href is string {
  return href?.startsWith(CITATION) ?? false;
}

/**
 * The line of the diff a citation link names, its first line, read on the
 * head's side first and then the base's, or undefined when no hunk shows it.
 */
export function citationAt(diff: DeckPullRequestDiff, href: string) {
  if (!isCitation(href)) return undefined;
  const match = /^(.*):(\d+)(?:-\d+)?$/.exec(href.slice(CITATION.length));
  if (!match) return undefined;
  let path: string;
  try {
    path = decodeURI(match[1]!);
  } catch {
    return undefined;
  }
  const line = Number(match[2]);
  const at =
    findLine(diff, { path, side: "head", line }) ??
    findLine(diff, { path, side: "base", line });
  return at
    ? { hunkId: at.hunkId, side: at.side, line: at.line, row: at.row }
    : undefined;
}
