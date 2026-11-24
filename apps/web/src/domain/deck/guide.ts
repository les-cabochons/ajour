import type {
  DeckFile,
  DeckHunk,
  DeckOpenedPullRequest,
} from "@ajour/shared/deck";

/*
 * The order Deck's review page reads a pull request in (#782): the guide,
 * its concerns numbered in reading order as the local API built them, or
 * Files A–Z. J and K move between the sections either order gives, and each
 * section counts the hunks marked viewed. Viewed marks are local to the
 * page for now; per-hunk marks that last come with #785.
 */

export type ReviewOrder = "guide" | "files";

export interface ReviewHunk {
  file: DeckFile;
  hunk: DeckHunk;
}

/** A concern of the guide, or a file in Files A–Z. */
export interface ReviewSection {
  /** The concern's id, or the file's path. */
  key: string;
  /** The concern's place in reading order, from 1. Absent for a file. */
  number?: number;
  /** The concern's title, or the file's path. */
  title: string;
  /** The concern's one-line rationale. */
  rationale?: string;
  /** The file of a Files A–Z section. */
  file?: DeckFile;
  hunks: ReviewHunk[];
}

/**
 * Why the page shows the files A–Z with no Guide toggle: the guide wasn't
 * built for a pull request with too many hunks (#790), or it couldn't be
 * built. Undefined while there is a guide.
 */
export function noGuideNote(
  pullRequest: Pick<DeckOpenedPullRequest, "guide" | "guideSkipped">,
): string | undefined {
  if (pullRequest.guide) return undefined;
  const skipped = pullRequest.guideSkipped;
  return skipped
    ? `This pull request has more than ${skipped.hunkLimit.toLocaleString("en-US")} hunks, too many to build a guide, so the files show A–Z.`
    : "The guide couldn't be built, so the files show A–Z.";
}

/** Paths compare by UTF-16 code units, as the local API sorts them. */
const byPath = (a: DeckFile, b: DeckFile) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

function filesAToZ(files: readonly DeckFile[]): ReviewSection[] {
  return [...files].sort(byPath).map((file) => ({
    key: file.path,
    title: file.path,
    file,
    hunks: file.hunks.map((hunk) => ({ file, hunk })),
  }));
}

/**
 * The page's sections in `order`. Without a guide, the files show A–Z. A
 * hunk the guide names twice shows once, an id the diff lacks is dropped,
 * and a hunk the guide leaves out shows in a last section, "Not in the
 * guide", so nothing of the diff is hidden.
 */
export function reviewSections(
  pullRequest: DeckOpenedPullRequest,
  order: ReviewOrder,
): ReviewSection[] {
  const { guide } = pullRequest;
  if (order === "files" || !guide) return filesAToZ(pullRequest.files);
  const hunks = new Map<string, ReviewHunk>();
  for (const file of [...pullRequest.files].sort(byPath)) {
    for (const hunk of file.hunks) hunks.set(hunk.id, { file, hunk });
  }
  const placed = new Set<string>();
  const sections: ReviewSection[] = [];
  for (const concern of guide.concerns) {
    const entries = concern.hunkIds.flatMap((id) => {
      const entry = hunks.get(id);
      if (!entry || placed.has(id)) return [];
      placed.add(id);
      return [entry];
    });
    if (!entries.length) continue;
    sections.push({
      key: concern.id,
      number: sections.length + 1,
      title: concern.title,
      rationale: concern.rationale,
      hunks: entries,
    });
  }
  const left = [...hunks.values()].filter(
    (entry) => !placed.has(entry.hunk.id),
  );
  if (left.length) {
    sections.push({
      key: "not-in-guide",
      number: sections.length + 1,
      title: "Not in the guide",
      hunks: left,
    });
  }
  return sections;
}

/**
 * The section J (`step` 1) or K (`step` -1) scrolls to, from the sections'
 * tops relative to the page, in reading order, and `line`, where a section
 * scrolled to lands. The section being read is the last one whose top
 * reached the line. At the end of the page the last sections can't scroll
 * up to it, so `reached`, the section J or K went to last, counts as read
 * there too. J goes to the one after the section being read; K goes back
 * to its top, or to the one before when its top is at the line already.
 * Undefined at either end.
 */
export function sectionToReach(
  tops: readonly number[],
  line: number,
  step: 1 | -1,
  reached?: number,
): number | undefined {
  // Within a pixel counts as at the line, for rounding after a scroll.
  let reading = -1;
  tops.forEach((top, index) => {
    if (top <= line + 1) reading = index;
  });
  const fromReached = reached !== undefined && reached > reading;
  if (fromReached) reading = reached;
  const target =
    step === 1
      ? reading + 1
      : reading >= 0 && !fromReached && tops[reading]! < line - 1
        ? reading
        : reading - 1;
  return target >= 0 && target < tops.length ? target : undefined;
}

/** The marks with `hunkId`'s turned on or off. */
export function toggleViewed(
  viewed: ReadonlySet<string>,
  hunkId: string,
): Set<string> {
  const next = new Set(viewed);
  if (next.has(hunkId)) next.delete(hunkId);
  else next.add(hunkId);
  return next;
}

/** How many of the section's hunks are marked viewed. */
export function viewedCount(
  section: ReviewSection,
  viewed: ReadonlySet<string>,
): number {
  return section.hunks.filter((entry) => viewed.has(entry.hunk.id)).length;
}

/** A guide tree tick's length in pixels: longer for more hunks, from 6 to 40. */
export function tickLength(hunkCount: number): number {
  return Math.min(40, Math.round(6 + Math.max(1, hunkCount) * 2.4) - 2);
}

/*
 * Huge pull requests (#790). Above a hunk count the page mounts only the
 * rows near the screen, and above a section count the guide tree mounts
 * only the ticks or titles in its view. The limits come from the timing
 * run on Review Deck's 3,090-hunk mock: without it, scrolling stays clean
 * up to about 1,000 hunks and has long tasks from 1,500, and the mount
 * grows with every hunk.
 */

/** The most hunks the page mounts at once. */
export const VIRTUAL_HUNK_THRESHOLD = 500;
/** The most sections the guide tree mounts at once. */
export const VIRTUAL_TREE_THRESHOLD = 200;

/** Whether the page mounts only the rows near the screen. */
export function virtualized(sections: readonly ReviewSection[]): boolean {
  let hunks = 0;
  for (const section of sections) hunks += section.hunks.length;
  return hunks > VIRTUAL_HUNK_THRESHOLD;
}

/** Whether the guide tree mounts only the ticks or titles in its view. */
export function treeVirtualized(sections: readonly ReviewSection[]): boolean {
  return sections.length > VIRTUAL_TREE_THRESHOLD;
}

/** One row of the page while it mounts only what is near the screen: a section's header, or one of its hunks. */
export type ReviewRow =
  | { kind: "section"; key: string; section: number }
  | {
      kind: "hunk";
      key: string;
      section: number;
      entry: ReviewHunk;
      /** The last hunk of a section another section follows, which holds the space between them. */
      beforeSection: boolean;
    };

/** The sections as rows in reading order, and the row of each section's header. */
export function reviewRows(sections: readonly ReviewSection[]): {
  rows: ReviewRow[];
  sectionRows: number[];
} {
  const rows: ReviewRow[] = [];
  const sectionRows: number[] = [];
  sections.forEach((section, index) => {
    sectionRows.push(rows.length);
    rows.push({
      kind: "section",
      key: `section:${section.key}`,
      section: index,
    });
    section.hunks.forEach((entry, position) => {
      rows.push({
        kind: "hunk",
        key: entry.hunk.id,
        section: index,
        entry,
        beforeSection:
          position === section.hunks.length - 1 && index < sections.length - 1,
      });
    });
  });
  return { rows, sectionRows };
}
