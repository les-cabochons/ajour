import {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { MessagePanel } from "@/components/app-surface";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  noGuideNote,
  reviewSections,
  sectionToReach,
  toggleViewed,
  virtualized,
  type ReviewOrder,
  type ReviewSection,
} from "@/domain/deck/guide";
import type { ReviewNote } from "@/domain/deck/review-notes";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { useShortcut } from "@/lib/shortcut-handlers";
import { useResolvedTheme } from "@/lib/use-theme";
import { DeckAskProvider } from "./deck-ask";
import { GuideTree } from "./guide-tree";
import {
  SECTION_MARGIN,
  atEnd,
  scrollerOf,
  type SectionNavigator,
} from "./review-scroll";
import { ReviewNotesContext } from "./review-notes";
import {
  ReviewSectionView,
  SECTION_ATTRIBUTE,
  type AddComment,
} from "./review-sections";
import { ThreadGutter } from "./thread-gutter";
import type { PullRequestReadState } from "./use-pull-request-read";
import { VirtualReviewSections } from "./virtual-review-sections";

/** Every section mounted, for a pull request that isn't huge. */
function MountedReviewSections({
  sections,
  viewed,
  theme,
  onToggleViewed,
  navigator,
  listRef,
  bySection,
  floating,
  hovered,
  hoveredSection,
  onAnchor,
  onAddComment,
}: {
  sections: readonly ReviewSection[];
  viewed: ReadonlySet<string>;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  navigator: Ref<SectionNavigator>;
  /** The sections' column, which the gutter beside it follows. */
  listRef: RefObject<HTMLDivElement | null>;
  /** Each section's threads, draft comments and composer, by its key. */
  bySection: ReadonlyMap<string, readonly ReviewNote[]>;
  floating: boolean;
  hovered: string | undefined;
  /** The key of the section holding the hovered note. */
  hoveredSection: string | undefined;
  onAnchor: (element: HTMLElement | null) => void;
  onAddComment: AddComment | undefined;
}) {
  const all = () => [
    ...(listRef.current?.querySelectorAll<HTMLElement>(
      `[${SECTION_ATTRIBUTE}]`,
    ) ?? []),
  ];
  useImperativeHandle(navigator, () => ({
    tops: () => all().map((section) => section.getBoundingClientRect().top),
    reach(index) {
      const section = all()[index];
      if (!section) return;
      // Instant, so a second J reads where the first one landed.
      section.scrollIntoView({ block: "start", behavior: "instant" });
      section.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
    },
  }));
  return (
    <div ref={listRef} className="deck-review-sections">
      {sections.map((section) => (
        <ReviewSectionView
          key={section.key}
          section={section}
          viewed={viewed}
          theme={theme}
          onToggleViewed={onToggleViewed}
          notes={bySection.get(section.key)}
          floating={floating}
          hovered={hoveredSection === section.key ? hovered : undefined}
          onAnchor={onAnchor}
          onAddComment={onAddComment}
        />
      ))}
    </div>
  );
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
 * beside its line in the gutter or after it. J and K move between its
 * sections and F opens the tree's titles, while the page is mounted
 * (`deck` shortcuts).
 */
function ReviewChanges({
  pullRequest,
  notes: { notes, floating, hovered, onAddComment },
}: {
  pullRequest: DeckOpenedPullRequest;
  notes: ReviewNotesView;
}) {
  const onHover = useContext(ReviewNotesContext)?.onHover;
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
  const review = useRef<HTMLDivElement>(null);
  const navigator = useRef<SectionNavigator>(null);
  // A huge pull request mounts only the rows near the screen (#790).
  const huge = useMemo(() => virtualized(sections), [sections]);

  /** The section J, K or a tick went to last. */
  const reached = useRef<number | undefined>(undefined);
  const reach = useCallback((index: number) => {
    if (index < 0 || !navigator.current) return;
    reached.current = index;
    navigator.current.reach(index);
  }, []);
  const step = (direction: 1 | -1) => {
    const element = review.current;
    if (!element || !navigator.current) return;
    // One read pass on each key press; nothing listens to the scroll.
    const tops = navigator.current.tops();
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

  const list = useRef<HTMLDivElement>(null);
  const scheduleRef = useRef<(() => void) | undefined>(undefined);
  const onAnchor = useCallback((element: HTMLElement | null) => {
    if (element) scheduleRef.current?.();
  }, []);
  // A huge pull request's hunks mount and unmount as the page scrolls, and
  // the gutter holds the cards of the mounted ones only: thousands of hidden
  // cards would cost every style and layout pass.
  const [mountedNoteHunks, setMountedNoteHunks] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onNoteRowsChange = useCallback(
    (hunkIds: ReadonlySet<string>) => setMountedNoteHunks(hunkIds),
    [],
  );
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
  const gutterNotes = useMemo(
    () =>
      huge
        ? notes.filter((entry) => mountedNoteHunks.has(entry.hunkId))
        : notes,
    [huge, notes, mountedNoteHunks],
  );
  // A hovered card whose hunk scrolled away is no longer under the pointer.
  useEffect(() => {
    if (
      hovered !== undefined &&
      gutter &&
      !gutterNotes.some((entry) => entry.key === hovered)
    )
      onHover?.(undefined);
  }, [gutter, gutterNotes, hovered, onHover]);
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
          <span className="deck-guide-source">{noGuideNote(pullRequest)}</span>
        ) : null}
      </div>
      {sections.length ? (
        <div ref={review} className="deck-review">
          <div className="deck-review-grid" data-gutter={gutter || undefined}>
            {huge ? (
              <VirtualReviewSections
                sections={sections}
                viewed={viewed}
                theme={theme}
                onToggleViewed={onToggleViewed}
                navigator={navigator}
                listRef={list}
                notes={notes}
                floating={gutter}
                hovered={hovered}
                onAnchor={onAnchor}
                onAddComment={onAddComment}
                onNoteRowsChange={onNoteRowsChange}
              />
            ) : (
              <MountedReviewSections
                sections={sections}
                viewed={viewed}
                theme={theme}
                onToggleViewed={onToggleViewed}
                navigator={navigator}
                listRef={list}
                bySection={bySection}
                floating={gutter}
                hovered={hovered}
                hoveredSection={hoveredSection}
                onAnchor={onAnchor}
                onAddComment={onAddComment}
              />
            )}
            {gutter ? (
              <ThreadGutter
                notes={gutterNotes}
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
