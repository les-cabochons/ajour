import type {
  CodeHostReviewThread,
  CodeHostTimelineEvent,
} from "@ajour/shared";
import type { DeckHunk, DeckPullRequestDiff } from "@ajour/shared/deck";

/*
 * Where the review page shows a pull request's review threads: each one
 * after the line it is on, and the ones the diff can't show in the
 * conversation at the end. In the gutter, cards stack top-down beside their
 * lines; a connector joins each card to its line.
 */

/** The side of a unified diff a line annotation follows, as `@pierre/diffs` names it. */
export type AnnotationSide = "additions" | "deletions";

/** A review thread on a line the diff shows. */
export interface PlacedThread {
  thread: CodeHostReviewThread;
  hunkId: string;
  /** The thread sits after this side's line: the head's lines are additions, the base's deletions. */
  side: AnnotationSide;
  line: number;
  /** The hunk's row the line is on, from 0, for where the card goes before the hunk draws. */
  row: number;
}

export interface ThreadPlacement {
  /** Every thread on a line of the diff, in file, hunk and row order. */
  placed: PlacedThread[];
  /** The same, by hunk id. */
  byHunk: ReadonlyMap<string, PlacedThread[]>;
  /** Threads with no line on the diff: outdated, on a whole file, or on lines it doesn't show. */
  elsewhere: CodeHostReviewThread[];
}

/**
 * The hunk's row for `line` on `side`, from 0, or undefined when the hunk
 * doesn't show that line. Rows are the patch's lines after its `@@` line.
 */
function rowOf(hunk: DeckHunk, side: AnnotationSide, line: number) {
  const rows = hunk.patch.split("\n");
  const start = rows.indexOf(hunk.header);
  if (!hunk.header || start < 0) return undefined;
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (let index = start + 1; index < rows.length; index += 1) {
    const mark = rows[index]![0];
    const row = index - start - 1;
    if (mark === " ") {
      if ((side === "additions" ? newLine : oldLine) === line) return row;
      oldLine += 1;
      newLine += 1;
    } else if (mark === "-") {
      if (side === "deletions" && oldLine === line) return row;
      oldLine += 1;
    } else if (mark === "+") {
      if (side === "additions" && newLine === line) return row;
      newLine += 1;
    }
  }
  return undefined;
}

/** Each thread on the line of the diff it names, or kept for the conversation. */
export function placeThreads(
  diff: DeckPullRequestDiff,
  threads: readonly CodeHostReviewThread[],
): ThreadPlacement {
  const order = new Map<string, number>();
  const found: (PlacedThread & { order: number })[] = [];
  const elsewhere: CodeHostReviewThread[] = [];
  let hunkOrder = 0;
  for (const file of diff.files)
    for (const hunk of file.hunks) order.set(hunk.id, hunkOrder++);

  for (const thread of threads) {
    const side: AnnotationSide =
      thread.side === "base" ? "deletions" : "additions";
    const line = thread.line;
    const file = diff.files.find(
      (entry) =>
        entry.path === thread.path ||
        (side === "deletions" && entry.previousPath === thread.path),
    );
    let placed: (PlacedThread & { order: number }) | undefined;
    if (file && line !== undefined) {
      for (const hunk of file.hunks) {
        const row = rowOf(hunk, side, line);
        if (row === undefined) continue;
        placed = {
          thread,
          hunkId: hunk.id,
          side,
          line,
          row,
          order: order.get(hunk.id)!,
        };
        break;
      }
    }
    if (placed) found.push(placed);
    else elsewhere.push(thread);
  }

  found.sort((a, b) => a.order - b.order || a.row - b.row);
  const placed = found.map(({ order: _order, ...entry }) => entry);
  const byHunk = new Map<string, PlacedThread[]>();
  for (const entry of placed) {
    const list = byHunk.get(entry.hunkId);
    if (list) list.push(entry);
    else byHunk.set(entry.hunkId, [entry]);
  }
  return { placed, byHunk, elsewhere };
}

/** A card to place in the gutter: the height of its line's middle, and its own height. */
export interface CardAnchor {
  key: string;
  y: number;
  height: number;
}

/**
 * Cards top-down in their lines' order: each as level with its line as the
 * card above allows, `gap` below it, its top `lift` above the line so the
 * connector meets the card's header.
 */
export function stackCards(
  anchors: readonly CardAnchor[],
  { gap, lift }: { gap: number; lift: number },
) {
  let floor = 0;
  return [...anchors]
    .sort((a, b) => a.y - b.y)
    .map((anchor) => {
      const top = Math.max(Math.round(anchor.y - lift), floor);
      floor = top + anchor.height + gap;
      return { key: anchor.key, top };
    });
}

/**
 * A connector from a line's right end out to an elbow, down or up to its
 * card's header, then across to the gutter. Cards pushed below their line
 * show it as a step.
 */
export function connectorPath({
  fromX,
  lineY,
  elbowX,
  cardY,
  toX,
}: {
  fromX: number;
  lineY: number;
  elbowX: number;
  cardY: number;
  toX: number;
}) {
  return `M${fromX} ${lineY} H${elbowX} V${cardY} H${toX}`;
}

/** One entry of the conversation at the end of the page. */
export type ConversationEntry =
  | { key: string; at: number; kind: "event"; event: CodeHostTimelineEvent }
  | { key: string; at: number; kind: "thread"; thread: CodeHostReviewThread };

function eventKey(event: CodeHostTimelineEvent) {
  return event.kind === "commit"
    ? `commit:${event.sha}`
    : `${event.kind}:${event.id}`;
}

/** The timeline and the threads the diff can't show, in time order. */
export function conversationEntries(
  timeline: readonly CodeHostTimelineEvent[],
  elsewhere: readonly CodeHostReviewThread[],
): ConversationEntry[] {
  return [
    ...timeline.map((event): ConversationEntry => ({
      key: eventKey(event),
      at: event.createdAt,
      kind: "event",
      event,
    })),
    ...elsewhere.map((thread): ConversationEntry => ({
      key: `thread:${thread.id}`,
      at: thread.comments[0]!.createdAt,
      kind: "thread",
      thread,
    })),
  ].sort((a, b) => a.at - b.at);
}
