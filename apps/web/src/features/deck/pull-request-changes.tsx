import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { MessagePanel } from "@/components/app-surface";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  reviewSections,
  sectionToReach,
  toggleViewed,
  type ReviewOrder,
} from "@/domain/deck/guide";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { useShortcut } from "@/lib/shortcut-handlers";
import { useResolvedTheme } from "@/lib/use-theme";
import { DeckAskProvider } from "./deck-ask";
import { GuideTree } from "./guide-tree";
import type { ReviewNote } from "./review-notes";
import {
  ReviewSectionView,
  SECTION_ATTRIBUTE,
  type AddComment,
} from "./review-sections";
import { ThreadGutter } from "./thread-gutter";
import type { PullRequestReadState } from "./use-pull-request-read";

/** Where a section scrolled to lands below the top of the page's scroller, as `scroll-margin-top` in styles/deck.css. */
const SECTION_MARGIN = 16;

/** The element that scrolls `element`, or undefined for the window. */
function scrollerOf(element: HTMLElement) {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return undefined;
}

/** Whether `scroller`, or the window, is scrolled to its end. */
function atEnd(scroller: HTMLElement | undefined) {
  const box = scroller ?? document.scrollingElement;
  return !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
}

/** What the review page shows at its lines, as `PullRequestReview` works it out. */
export interface ReviewNotesView {
  /** The threads, draft comments and composer on lines of the diff, in its order. */
  notes: readonly ReviewNote[];
  /** From 1,100px, the notes float in a gutter beside the sections. */
  floating: boolean;
  /** The key of the note hovered. */
  hovered: string | undefined;
  /** Opens the composer; undefined when the pull request takes no comments. */
  onAddComment: AddComment | undefined;
}

/**
 * The notes of each section, keeping the list a section had while its
 * notes are the same, so a note changing draws only its own section again.
 */
function notesBySection(
  notes: readonly ReviewNote[],
  sectionOfHunk: ReadonlyMap<string, string>,
  before: ReadonlyMap<string, readonly ReviewNote[]>,
) {
  const grouped = new Map<string, ReviewNote[]>();
  for (const note of notes) {
    const key = sectionOfHunk.get(note.hunkId);
    if (key === undefined) continue;
    const list = grouped.get(key) ?? [];
    list.push(note);
    grouped.set(key, list);
  }
  const kept = new Map<string, readonly ReviewNote[]>();
  for (const [key, list] of grouped) {
    const previous = before.get(key);
    kept.set(
      key,
      previous &&
        previous.length === list.length &&
        previous.every((note, index) => note === list[index])
        ? previous
        : list,
    );
  }
  return kept;
}

/**
 * The guide, or the files A–Z, of an opened pull request, with the guide
 * tree beside it, and each review thread, draft comment and the composer
 * beside its line in the gutter or after it. J and K move between its sections and F opens the tree's
 * titles, while the page is mounted (`deck` shortcuts).
 */
function ReviewChanges({
  pullRequest,
  notes: { notes, floating, hovered, onAddComment },
}: {
  pullRequest: DeckOpenedPullRequest;
  notes: ReviewNotesView;
}) {
  const theme = useResolvedTheme();
  const [chosen, setChosen] = useState<ReviewOrder>("guide");
  const order: ReviewOrder = pullRequest.guide ? chosen : "files";
  const sections = useMemo(
    () => reviewSections(pullRequest, order),
    [pullRequest, order],
  );
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set());
  const onToggleViewed = useCallback(
    (hunkId: string) => setViewed((marks) => toggleViewed(marks, hunkId)),
    [],
  );
  const [treeOpen, setTreeOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  /** The section J, K or a tick went to last. */
  const reached = useRef<number | undefined>(undefined);
  const reach = useCallback((index: number) => {
    const section = list.current?.querySelectorAll<HTMLElement>(
      `[${SECTION_ATTRIBUTE}]`,
    )[index];
    if (!section) return;
    reached.current = index;
    // Instant, so a second J reads where the first one landed.
    section.scrollIntoView({ block: "start", behavior: "instant" });
    section.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
  }, []);
  const step = (direction: 1 | -1) => {
    const element = list.current;
    if (!element) return;
    // One read pass on each key press; nothing listens to the scroll.
    const tops = [
      ...element.querySelectorAll<HTMLElement>(`[${SECTION_ATTRIBUTE}]`),
    ].map((section) => section.getBoundingClientRect().top);
    const scroller = scrollerOf(element);
    const target = sectionToReach(
      tops,
      (scroller?.getBoundingClientRect().top ?? 0) + SECTION_MARGIN,
      direction,
      atEnd(scroller) ? reached.current : undefined,
    );
    if (target !== undefined) reach(target);
  };
  useShortcut("deck.next-concern", () => step(1));
  useShortcut("deck.previous-concern", () => step(-1));
  useShortcut("deck.guide-tree", () => setTreeOpen((open) => !open));

  const scheduleRef = useRef<(() => void) | undefined>(undefined);
  const onAnchor = useCallback((element: HTMLElement | null) => {
    if (element) scheduleRef.current?.();
  }, []);
  const sectionOfHunk = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections)
      for (const entry of section.hunks) map.set(entry.hunk.id, section.key);
    return map;
  }, [sections]);
  const grouped = useRef<ReadonlyMap<string, readonly ReviewNote[]>>(new Map());
  const bySection = useMemo(
    () => notesBySection(notes, sectionOfHunk, grouped.current),
    [notes, sectionOfHunk],
  );
  useEffect(() => {
    grouped.current = bySection;
  }, [bySection]);
  // Only the hovered note's section draws again as the hover moves.
  const hoveredHunk = notes.find((entry) => entry.key === hovered)?.hunkId;
  const hoveredSection = hoveredHunk
    ? sectionOfHunk.get(hoveredHunk)
    : undefined;
  const gutter = floating && notes.length > 0;
  // Folding a hunk or changing the order moves the lines, even where the
  // column keeps its height. The gutter places its cards itself as it mounts.
  const laidOut = useRef({ sections, viewed });
  useEffect(() => {
    if (
      laidOut.current.sections === sections &&
      laidOut.current.viewed === viewed
    )
      return;
    laidOut.current = { sections, viewed };
    scheduleRef.current?.();
  }, [sections, viewed]);

  const count = order === "guide" ? sections.length : pullRequest.files.length;
  return (
    <>
      <div className="deck-guide-header">
        <SectionHeading trailing={count} className="deck-guide-heading">
          {order === "guide" ? "Guide" : "Files"}
        </SectionHeading>
        {order === "guide" ? (
          <span className="deck-guide-source">Built from the code</span>
        ) : null}
        {pullRequest.guide ? (
          <ToggleGroup
            aria-label="Order"
            variant="outline"
            size="sm"
            className="deck-guide-order"
            value={[order]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "guide" || next === "files") setChosen(next);
            }}
          >
            <ToggleGroupItem value="guide">Guide</ToggleGroupItem>
            <ToggleGroupItem value="files">Files A–Z</ToggleGroupItem>
          </ToggleGroup>
        ) : pullRequest.files.length ? (
          <span className="deck-guide-source">
            The guide couldn't be built, so the files show A–Z.
          </span>
        ) : null}
      </div>
      {sections.length ? (
        <div className="deck-review">
          <div className="deck-review-grid" data-gutter={gutter || undefined}>
            <div ref={list} className="deck-review-sections">
              {sections.map((section) => (
                <ReviewSectionView
                  key={section.key}
                  section={section}
                  viewed={viewed}
                  theme={theme}
                  onToggleViewed={onToggleViewed}
                  notes={bySection.get(section.key)}
                  floating={gutter}
                  hovered={hoveredSection === section.key ? hovered : undefined}
                  onAnchor={onAnchor}
                  onAddComment={onAddComment}
                />
              ))}
            </div>
            {gutter ? (
              <ThreadGutter
                notes={notes}
                columnRef={list}
                hovered={hovered}
                scheduleRef={scheduleRef}
              />
            ) : null}
          </div>
          <GuideTree
            sections={sections}
            viewed={viewed}
            open={treeOpen}
            heading={order === "guide" ? "Guide" : "Files"}
            onToggle={() => setTreeOpen((open) => !open)}
            onReach={reach}
          />
        </div>
      ) : (
        <p className="deck-file-empty">This pull request changes no files.</p>
      )}
    </>
  );
}

/**
 * The pull request's changes: its guide, or its files A–Z, once the local
 * API built them, with each note beside its line when `floating`, or
 * after it.
 */
export function PullRequestChanges({
  pullRequest,
  state,
  retry,
  notes,
}: {
  pullRequest: LocalPullRequest;
  state: PullRequestReadState<DeckOpenedPullRequest>;
  retry: () => void;
  notes: ReviewNotesView;
}) {
  return (
    // Named outright: the heading's count would join its name.
    <section className="deck-changes" aria-label="Changes">
      {state.status === "ready" ? null : (
        <SectionHeading>Changes</SectionHeading>
      )}
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
        <DeckAskProvider
          pluginId={pullRequest.pluginId}
          connectionId={pullRequest.connectionId}
          repository={pullRequest.facts.repository}
          number={pullRequest.facts.number}
          head={state.value.headSha}
        >
          {/* A new diff, or another head, starts with no hunk marked viewed. */}
          <ReviewChanges
            key={`${state.value.baseSha}..${state.value.headSha}`}
            pullRequest={state.value}
            notes={notes}
          />
        </DeckAskProvider>
      )}
    </section>
  );
}
