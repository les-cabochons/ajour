import type { CodeHostDiffSide, CodeHostReviewThread } from "@ajour/shared";
import type { DeckDraftComment } from "@/domain/deck/draft-review";

/*
 * Deck's Threads view: every review thread of the pull request and the
 * user's draft comments, in one list. Open threads come first, then the
 * drafts, then the resolved ones, each in file and line order. A filter
 * keeps one kind; the dock's Threads launcher counts what still needs the
 * user, the open threads and the drafts.
 */

export type ThreadListFilter = "all" | "open" | "drafts" | "resolved";

export interface ThreadListEntry {
  key: string;
  kind: "open" | "draft" | "resolved";
  path: string;
  side: CodeHostDiffSide;
  /** Absent for a thread no longer on a line of the latest diff. */
  line?: number;
  startLine?: number;
  /** A thread whose line a push changed, or a draft comment that is. */
  outdated: boolean;
  /** The first comment's author, absent for a draft, which is the user's. */
  author?: { login: string; displayName?: string };
  body: string;
  replies: number;
  /** When it was written. */
  at: number;
  thread?: CodeHostReviewThread;
  draft?: DeckDraftComment;
}

const rank = { open: 0, draft: 1, resolved: 2 } as const;

export function threadListEntries(
  threads: readonly CodeHostReviewThread[],
  drafts: readonly DeckDraftComment[],
): ThreadListEntry[] {
  const entries: ThreadListEntry[] = [
    ...threads.map((thread): ThreadListEntry => {
      const first = thread.comments[0]!;
      return {
        key: `thread:${thread.id}`,
        kind: thread.resolved ? "resolved" : "open",
        path: thread.path,
        side: thread.side,
        ...(thread.line !== undefined ? { line: thread.line } : {}),
        ...(thread.startLine !== undefined
          ? { startLine: thread.startLine }
          : {}),
        outdated: thread.outdated,
        author: first.author,
        body: first.body,
        replies: thread.comments.length - 1,
        at: first.createdAt,
        thread,
      };
    }),
    ...drafts.map((draft): ThreadListEntry => ({
      key: `draft:${draft.id}`,
      kind: "draft",
      path: draft.path,
      side: draft.side,
      line: draft.line,
      ...(draft.startLine !== undefined ? { startLine: draft.startLine } : {}),
      outdated: !!draft.outdated,
      body: draft.body,
      replies: 0,
      at: draft.createdAt,
      draft,
    })),
  ];
  return entries.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] ||
      a.path.localeCompare(b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.at - b.at,
  );
}

export function threadListCounts(entries: readonly ThreadListEntry[]) {
  const count = (kind: ThreadListEntry["kind"]) =>
    entries.filter((entry) => entry.kind === kind).length;
  return {
    all: entries.length,
    open: count("open"),
    drafts: count("draft"),
    resolved: count("resolved"),
  };
}

export function filterThreadList(
  entries: readonly ThreadListEntry[],
  filter: ThreadListFilter,
) {
  if (filter === "all") return entries;
  const kind = filter === "drafts" ? "draft" : filter;
  return entries.filter((entry) => entry.kind === kind);
}

/** "src/api.ts:12" or "src/api.ts:12–14", or the path alone for a whole file. */
export function threadListLocation(entry: {
  path: string;
  line?: number;
  startLine?: number;
}) {
  if (entry.line === undefined) return entry.path;
  return entry.startLine !== undefined && entry.startLine < entry.line
    ? `${entry.path}:${entry.startLine}–${entry.line}`
    : `${entry.path}:${entry.line}`;
}
