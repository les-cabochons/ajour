import {
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import type { CodeHostVersion, CodeHostVersionsResult } from "@ajour/shared";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { MessagePanel } from "@/components/app-surface";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  noGuideNote,
  reviewSections,
  sectionToReach,
  virtualized,
  type ReviewOrder,
  type ReviewSection,
} from "@/domain/deck/guide";
import type { ReviewNote } from "@/domain/deck/review-notes";
import { sinceReviewSections, versionNames } from "@/domain/deck/versions";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { useShortcut } from "@/lib/shortcut-handlers";
import { useResolvedTheme } from "@/lib/use-theme";
import { DeckAskProvider } from "./deck-ask";
import { GuideTree } from "./guide-tree";
import type { ReachHunk } from "./pull-request-summary";
import {
  atEnd,
  hunkBoxOf,
  readingOffset,
  revealDistance,
  scrollByDistance,
  scrollerOf,
  scrollToReadingLine,
  type SectionNavigator,
} from "./review-scroll";
import { useReviewLinesValue } from "./review-lines";
import { ReviewLinesContext } from "./review-lines-context";
import { ReviewNotesContext } from "./review-notes";
import { fileIsViewed } from "@/domain/deck/viewed-marks";
import {
  HUNK_ATTRIBUTE,
  ReviewSectionView,
  SECTION_ATTRIBUTE,
  type AddComment,
  type ToggleFileViewed,
} from "./review-sections";
import { ThreadGutter } from "./thread-gutter";
import type {
  PullRequestReadState,
  SinceReviewState,
} from "./use-pull-request-read";
import { NewPushesBanner, VersionsBar } from "./versions-bar";
import { VirtualReviewSections } from "./virtual-review-sections";

/** Every section mounted, for a pull request that isn't huge. */
function MountedReviewSections({
  sections,
  viewed,
  theme,
  onToggleViewed,
  onToggleFileViewed,
  navigator,
  listRef,
  bySection,
  floating,
  hovered,
  hoveredSection,
  onAnchor,
  onAddComment,
  changed,
}: {
  sections: readonly ReviewSection[];
  viewed: ReadonlySet<string>;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  onToggleFileViewed: ToggleFileViewed;
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
  /** The hunks changed since the review, with the version each last changed in. */
  changed: ReadonlyMap<string, number> | undefined;
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
    reveal(hunkId, row, point) {
      const box = hunkBoxOf(listRef.current, hunkId);
      if (box)
        scrollByDistance(scrollerOf(box), revealDistance(box, row, point));
    },
    reachHunk(hunkId) {
      const element = listRef.current;
      const hunk = [
        ...(element?.querySelectorAll<HTMLElement>(`[${HUNK_ATTRIBUTE}]`) ??
          []),
      ].find((candidate) => candidate.getAttribute(HUNK_ATTRIBUTE) === hunkId);
      if (!element || !hunk) return false;
      // Below the sticky versions bar, as a section lands.
      scrollToReadingLine(hunk, readingOffset(element));
      hunk.focus({ preventScroll: true });
      return true;
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
          onToggleFileViewed={onToggleFileViewed}
          notes={bySection.get(section.key)}
          floating={floating}
          hovered={hoveredSection === section.key ? hovered : undefined}
          onAnchor={onAnchor}
          onAddComment={onAddComment}
          changed={changed}
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

/** The hunks marked viewed, as `PullRequestReview` keeps them. */
export interface ReviewViewedView {
  /** The ids of the hunks on screen marked viewed. */
  viewed: ReadonlySet<string>;
  /** Marks hunks viewed, or not. */
  setViewed: (hunkIds: readonly string[], viewed: boolean) => void;
}

/** The versions bar's reads and the since-review marks, as `PullRequestReview` works them out. */
export interface ReviewVersionsView {
  state: PullRequestReadState<CodeHostVersionsResult>;
  retry: () => void;
  /** The version the user last reviewed. */
  reviewed: CodeHostVersion | undefined;
  since: SinceReviewState;
  retrySince: () => void;
  /**
   * The hunks changed since the version reviewed, with the version each
   * last changed in; empty when the version reviewed is the one on screen.
   * Undefined until known.
   */
  changed: ReadonlyMap<string, number> | undefined;
  /** The pushes after the head on screen. */
  pushes: number;
  refresh: () => void;
  baseRef: string | undefined;
}

/**
 * The guide, or the files A–Z, of an opened pull request, with the guide
 * tree beside it, and each review thread, draft comment and the composer
 * beside its line in the gutter or after it. J and K move between its
 * sections and F opens the tree's titles, while the page is mounted
 * (`deck` shortcuts). Lines selected in a hunk show the toolbar above
 * them, whose keys work only then (#793).
 */
function ReviewChanges({
  pullRequest,
  notes: { notes: allNotes, floating, hovered, onAddComment },
  reachHunkRef,
  versions,
  viewing: { viewed, setViewed },
}: {
  pullRequest: DeckOpenedPullRequest;
  notes: ReviewNotesView;
  reachHunkRef: RefObject<ReachHunk | undefined>;
  versions: ReviewVersionsView;
  viewing: ReviewViewedView;
}) {
  const onHover = useContext(ReviewNotesContext)?.onHover;
  const theme = useResolvedTheme();
  const [chosen, setChosen] = useState<ReviewOrder>("guide");
  const order: ReviewOrder = pullRequest.guide ? chosen : "files";
  const all = useMemo(
    () => reviewSections(pullRequest, order),
    [pullRequest, order],
  );
  // The latest version shows by default; the filter keeps what changed since the review.
  const [filtering, setFiltering] = useState(false);
  const { changed } = versions;
  const since = useMemo(
    () =>
      filtering && changed ? sinceReviewSections(all, changed) : undefined,
    [all, changed, filtering],
  );
  const sections = since ? since.sections : all;
  const hunkCount = useMemo(
    () =>
      pullRequest.files.reduce((count, file) => count + file.hunks.length, 0),
    [pullRequest.files],
  );
  const shownCount = sections.reduce(
    (count, section) => count + section.hunks.length,
    0,
  );
  const shownVersion =
    versions.state.status === "ready"
      ? versions.state.value.versions.find(
          (version) => version.headSha === pullRequest.headSha,
        )
      : undefined;
  // Read by the toggles, so a mark changing doesn't draw every hunk again.
  const marks = useRef({ viewed, setViewed });
  useLayoutEffect(() => {
    marks.current = { viewed, setViewed };
  }, [viewed, setViewed]);
  const onToggleViewed = useCallback((hunkId: string) => {
    const { viewed: now, setViewed: set } = marks.current;
    set([hunkId], !now.has(hunkId));
  }, []);
  const onToggleFileViewed = useCallback<ToggleFileViewed>((file) => {
    const { viewed: now, setViewed: set } = marks.current;
    set(
      file.hunks.map((hunk) => hunk.id),
      !fileIsViewed(file, now),
    );
  }, []);
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
      (scroller?.getBoundingClientRect().top ?? 0) + readingOffset(element),
      direction,
      atEnd(scroller) ? reached.current : undefined,
    );
    if (target !== undefined) reach(target);
  };
  // A summary line scrolls its hunk to the reading line, below the versions
  // bar, in either order and either list, and focuses it. A hunk the
  // since-review filter hides shows all the changes first.
  const shown = useRef({ sections, all, filtering });
  useLayoutEffect(() => {
    shown.current = { sections, all, filtering };
  }, [sections, all, filtering]);
  useEffect(() => {
    let frame = 0;
    const holds = (list: readonly ReviewSection[], hunkId: string) =>
      list.some((section) =>
        section.hunks.some((entry) => entry.hunk.id === hunkId),
      );
    reachHunkRef.current = (hunkId) => {
      cancelAnimationFrame(frame);
      const now = shown.current;
      if (!holds(now.sections, hunkId)) {
        if (!now.filtering || !holds(now.all, hunkId)) return;
        setFiltering(false);
      }
      // A few frames while the list shows it: after the filter's change,
      // or while a huge list finds its scroller.
      let tries = 0;
      const attempt = () => {
        if (navigator.current?.reachHunk(hunkId) || (tries += 1) > 10) return;
        frame = requestAnimationFrame(attempt);
      };
      attempt();
    };
    return () => {
      cancelAnimationFrame(frame);
      reachHunkRef.current = undefined;
    };
  }, [reachHunkRef]);
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
  // The hunk of the gutter's card holding the focus, such as the composer
  // being typed in: its row stays mounted however far it scrolls away, as
  // the row holding the focus does.
  const [focusedCardHunk, setFocusedCardHunk] = useState<string>();
  const sectionOfHunk = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections)
      for (const entry of section.hunks) map.set(entry.hunk.id, section.key);
    return map;
  }, [sections]);
  // Under the filter, only the notes on the hunks it shows.
  const notes = useMemo(
    () => allNotes.filter((entry) => sectionOfHunk.has(entry.hunkId)),
    [allNotes, sectionOfHunk],
  );
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

  const lines = useReviewLinesValue({
    diff: pullRequest,
    onAddComment,
    navigator,
    viewed,
    onToggleViewed,
  });

  const count = order === "guide" ? all.length : pullRequest.files.length;
  return (
    <>
      <VersionsBar
        versions={versions.state}
        retryVersions={versions.retry}
        shownHead={pullRequest.headSha}
        reviewed={versions.reviewed}
        since={versions.since}
        retrySince={versions.retrySince}
        changed={changed}
        filtering={filtering}
        onFilter={setFiltering}
        hunkCount={hunkCount}
        shownCount={shownCount}
        baseRef={versions.baseRef}
      />
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
        <ReviewLinesContext.Provider value={lines}>
          <div ref={review} className="deck-review">
            <div
              className="deck-review-grid"
              data-gutter={gutter || undefined}
              onFocus={(event) => {
                const key = (event.target as Element).closest<HTMLElement>(
                  "[data-card]",
                )?.dataset.card;
                const hunkId = notes.find((entry) => entry.key === key)?.hunkId;
                setFocusedCardHunk(hunkId);
              }}
              onBlur={(event) => {
                const next = event.relatedTarget as Element | null;
                if (!next?.closest("[data-card]"))
                  setFocusedCardHunk(undefined);
              }}
            >
              {huge ? (
                <VirtualReviewSections
                  sections={sections}
                  viewed={viewed}
                  theme={theme}
                  onToggleViewed={onToggleViewed}
                  onToggleFileViewed={onToggleFileViewed}
                  navigator={navigator}
                  listRef={list}
                  notes={notes}
                  floating={gutter}
                  hovered={hovered}
                  onAnchor={onAnchor}
                  onAddComment={onAddComment}
                  onNoteRowsChange={onNoteRowsChange}
                  focusedHunk={focusedCardHunk}
                  changed={changed}
                />
              ) : (
                <MountedReviewSections
                  sections={sections}
                  viewed={viewed}
                  theme={theme}
                  onToggleViewed={onToggleViewed}
                  onToggleFileViewed={onToggleFileViewed}
                  navigator={navigator}
                  listRef={list}
                  bySection={bySection}
                  floating={gutter}
                  hovered={hovered}
                  hoveredSection={hoveredSection}
                  onAnchor={onAnchor}
                  onAddComment={onAddComment}
                  changed={changed}
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
        </ReviewLinesContext.Provider>
      ) : since ? (
        <p className="deck-file-empty">
          {`Nothing changed since your review of v${versions.reviewed?.number ?? ""}.`}{" "}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFiltering(false)}
          >
            {shownVersion ? `Show all of v${shownVersion.number}` : "Show all"}
          </Button>
        </p>
      ) : (
        <p className="deck-file-empty">This pull request changes no files.</p>
      )}
      {sections.length && since?.folded.length ? (
        <p className="deck-unchanged">
          <span>Unchanged since your review:</span>
          {since.folded.map((section) => (
            <span key={section.key} className="deck-unchanged-item">
              {section.number ? (
                <span className="deck-unchanged-number">{section.number}</span>
              ) : null}
              {section.title}
            </span>
          ))}
        </p>
      ) : null}
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
  reachHunkRef,
  versions,
  viewing,
}: {
  pullRequest: LocalPullRequest;
  state: PullRequestReadState<DeckOpenedPullRequest>;
  retry: () => void;
  notes: ReviewNotesView;
  /** Set while the changes show, to the way a summary line reaches its hunk. */
  reachHunkRef: RefObject<ReachHunk | undefined>;
  versions: ReviewVersionsView;
  viewing: ReviewViewedView;
}) {
  const { repositoryIdentity, headRef } = pullRequest.facts;
  // Where the repository is cloned from, so an ask can read the user's clone.
  const cloneSource = useMemo(
    () =>
      repositoryIdentity
        ? { repositoryIdentity, ...(headRef ? { headRef } : {}) }
        : undefined,
    [repositoryIdentity, headRef],
  );
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
          clone={cloneSource}
        >
          {versions.pushes ? (
            <NewPushesBanner
              count={versions.pushes}
              names={versionNames(
                versions.state.status === "ready"
                  ? versions.state.value.versionName
                  : undefined,
              )}
              onRefresh={versions.refresh}
            />
          ) : null}
          {/* A new diff, or another head, starts with the latest version shown; its viewed marks are the page's. */}
          <ReviewChanges
            key={`${state.value.baseSha}..${state.value.headSha}`}
            pullRequest={state.value}
            notes={notes}
            reachHunkRef={reachHunkRef}
            versions={versions}
            viewing={viewing}
          />
        </DeckAskProvider>
      )}
    </section>
  );
}
