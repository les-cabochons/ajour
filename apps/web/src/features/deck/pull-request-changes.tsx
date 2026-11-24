import { memo, useCallback, useId, useMemo, useRef } from "react";
import type {
  DeckFile,
  DeckHunk,
  DeckPullRequestDiff,
} from "@ajour/shared/deck";
import { MessagePanel } from "@/components/app-surface";
import { DiffHunk, type DiffHunkAnnotation } from "@/components/diff-hunk";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import {
  fileNote,
  fileWithoutLines,
  hunkLabel,
  hunkRowCount,
} from "@/domain/deck/review-diff";
import type {
  PlacedThread,
  ThreadPlacement,
} from "@/domain/deck/review-threads";
import { useResolvedTheme } from "@/lib/use-theme";
import { ReviewThreadCard } from "./review-thread-card";
import { ThreadGutter } from "./thread-gutter";
import type { PullRequestReadState } from "./use-pull-request-read";

/** The lines a hovered thread highlights, kept inside its hunk. */
function highlightOf(hunk: DeckHunk, entry: PlacedThread | undefined) {
  if (!entry) return null;
  const first = entry.side === "additions" ? hunk.newStart : hunk.oldStart;
  const start = Math.max(entry.thread.startLine ?? entry.line, first);
  return { side: entry.side, start, end: entry.line };
}

/** One file of the diff: its path, then its hunks in order, its threads after their lines when inline. */
const ChangedFile = memo(function ChangedFile({
  file,
  theme,
  threads,
  floating,
  hovered,
  onHover,
  onAnchor,
}: {
  file: DeckFile;
  theme: "light" | "dark";
  /** The file's threads on its lines, or none. */
  threads: readonly PlacedThread[] | undefined;
  /** Threads float in the gutter, so a line only marks where its thread is. */
  floating: boolean;
  /** The hovered thread, when it's on this file. */
  hovered: string | undefined;
  onHover: (threadId: string | undefined) => void;
  /** Called with each mark after a thread's line as it's drawn, so the gutter can place its card. */
  onAnchor: (element: HTMLElement | null) => void;
}) {
  const headingId = useId();
  const withoutLines = fileWithoutLines(file);
  const note = fileNote(file);
  const byHunk = useMemo(() => {
    const map = new Map<string, DiffHunkAnnotation[]>();
    for (const entry of threads ?? []) {
      const list = map.get(entry.hunkId) ?? [];
      list.push({ key: entry.thread.id, side: entry.side, line: entry.line });
      map.set(entry.hunkId, list);
    }
    return map;
  }, [threads]);
  const byId = useMemo(
    () => new Map((threads ?? []).map((entry) => [entry.thread.id, entry])),
    [threads],
  );
  // In the gutter a line's mark doesn't change with the hover, so the
  // file's hunks don't draw again as it moves.
  const hot = floating ? undefined : hovered;
  const renderAnnotation = useCallback(
    (key: string) => {
      if (floating)
        return (
          <span
            ref={onAnchor}
            className="deck-thread-anchor"
            data-thread-anchor={key}
          />
        );
      const entry = byId.get(key);
      return entry ? (
        <div className="deck-inline-thread">
          <ReviewThreadCard
            thread={entry.thread}
            hot={hot === key}
            onHover={onHover}
          />
        </div>
      ) : null;
    },
    [byId, floating, hot, onAnchor, onHover],
  );
  const hoveredEntry = hovered ? byId.get(hovered) : undefined;
  return (
    <section className="deck-file" aria-labelledby={headingId}>
      <header className="deck-file-header">
        <h3 id={headingId} className="deck-file-path">
          {file.path}
        </h3>
        {note ? <span className="deck-file-note">{note}</span> : null}
      </header>
      {withoutLines ? (
        <p className="deck-file-empty">{withoutLines}</p>
      ) : (
        file.hunks.map((hunk) => {
          const annotations = byHunk.get(hunk.id);
          return (
            <DiffHunk
              key={hunk.id}
              hunkId={hunk.id}
              patch={hunk.patch}
              rows={hunkRowCount(hunk)}
              label={hunkLabel(file, hunk)}
              theme={theme}
              annotations={annotations}
              renderAnnotation={annotations ? renderAnnotation : undefined}
              highlight={
                annotations
                  ? highlightOf(
                      hunk,
                      hoveredEntry?.hunkId === hunk.id
                        ? hoveredEntry
                        : undefined,
                    )
                  : undefined
              }
            />
          );
        })
      )}
    </section>
  );
});

function ChangedFiles({
  diff,
  placement,
  floating,
  hovered,
  onHover,
}: {
  diff: DeckPullRequestDiff;
  placement: ThreadPlacement | undefined;
  floating: boolean;
  hovered: string | undefined;
  onHover: (threadId: string | undefined) => void;
}) {
  const theme = useResolvedTheme();
  const columnRef = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<(() => void) | undefined>(undefined);
  const onAnchor = useCallback((element: HTMLElement | null) => {
    if (element) scheduleRef.current?.();
  }, []);
  const { byFile, hunkFiles } = useMemo(() => {
    const byFile = new Map<string, PlacedThread[]>();
    const hunkFiles = new Map<string, string>();
    for (const file of diff.files)
      for (const hunk of file.hunks) hunkFiles.set(hunk.id, file.path);
    for (const entry of placement?.placed ?? []) {
      const path = hunkFiles.get(entry.hunkId)!;
      const list = byFile.get(path) ?? [];
      list.push(entry);
      byFile.set(path, list);
    }
    return { byFile, hunkFiles };
  }, [diff, placement]);
  // Only the hovered thread's file draws again as the hover moves.
  const hoveredHunk = placement?.placed.find(
    (entry) => entry.thread.id === hovered,
  )?.hunkId;
  const hoveredPath = hoveredHunk ? hunkFiles.get(hoveredHunk) : undefined;
  const placed = placement?.placed ?? [];
  const gutter = floating && placed.length > 0;
  if (!diff.files.length)
    return (
      <p className="deck-file-empty">This pull request changes no files.</p>
    );
  return (
    <div className="deck-review-grid" data-gutter={gutter || undefined}>
      <div ref={columnRef} className="deck-review-column">
        {diff.files.map((file) => (
          <ChangedFile
            key={file.path}
            file={file}
            theme={theme}
            threads={byFile.get(file.path)}
            floating={gutter}
            hovered={hoveredPath === file.path ? hovered : undefined}
            onHover={onHover}
            onAnchor={onAnchor}
          />
        ))}
      </div>
      {gutter ? (
        <ThreadGutter
          placed={placed}
          columnRef={columnRef}
          hovered={hovered}
          onHover={onHover}
          scheduleRef={scheduleRef}
        />
      ) : null}
    </div>
  );
}

/**
 * The pull request's changes: every file's hunks, in file order, with each
 * review thread beside its line when `floating`, or after it.
 */
export function PullRequestChanges({
  state,
  retry,
  placement,
  floating,
  hovered,
  onHover,
}: {
  state: PullRequestReadState<DeckPullRequestDiff>;
  retry: () => void;
  placement: ThreadPlacement | undefined;
  floating: boolean;
  hovered: string | undefined;
  onHover: (threadId: string | undefined) => void;
}) {
  return (
    // Named outright: the heading's file count would join its name.
    <section className="deck-changes" aria-label="Changes">
      <SectionHeading
        trailing={
          state.status === "ready" ? state.value.files.length : undefined
        }
      >
        Changes
      </SectionHeading>
      {state.status === "loading" ? (
        <p role="status" className="deck-file-empty">
          Loading the changes…
        </p>
      ) : state.status === "unavailable" ? (
        <p className="deck-file-empty">{state.message}</p>
      ) : state.status === "error" ? (
        <MessagePanel role="alert" className="flex items-center gap-3">
          <span className="flex-1">{state.message}</span>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </MessagePanel>
      ) : (
        <ChangedFiles
          diff={state.value}
          placement={placement}
          floating={floating}
          hovered={hovered}
          onHover={onHover}
        />
      )}
    </section>
  );
}
