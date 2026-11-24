import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodeHostVersion, CodeHostVersionsResult } from "@ajour/shared";
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
import type {
  PlacedThread,
  ThreadPlacement,
} from "@/domain/deck/review-threads";
import { sinceReviewSections, versionNames } from "@/domain/deck/versions";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { useShortcut } from "@/lib/shortcut-handlers";
import { useResolvedTheme } from "@/lib/use-theme";
import { DeckAskProvider } from "./deck-ask";
import { GuideTree } from "./guide-tree";
import { ReviewSectionView, SECTION_ATTRIBUTE } from "./review-sections";
import { ThreadGutter } from "./thread-gutter";
import type {
  PullRequestReadState,
  SinceReviewState,
} from "./use-pull-request-read";
import { NewPushesBanner, VersionsBar } from "./versions-bar";

/**
 * Where a section scrolled to lands below the sticky versions bar, as
 * `scroll-margin-top` in styles/deck.css.
 */
const SECTION_MARGIN = 16;
/** The versions bar the sections land below, within the changes. */
const VERSIONS_BAR = ".deck-versions";

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

/** Where the review page shows the review threads, as `PullRequestReview` works it out. */
export interface ReviewThreadsView {
  placement: ThreadPlacement | undefined;
  /** From 1,100px, the threads float in a gutter beside the sections. */
  floating: boolean;
  hovered: string | undefined;
  onHover: (threadId: string | undefined) => void;
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
 * tree beside it, and each review thread beside its line in the gutter or
 * after it. J and K move between its sections and F opens the tree's
 * titles, while the page is mounted (`deck` shortcuts).
 */
function ReviewChanges({
  pullRequest,
  threads: { placement, floating, hovered, onHover },
  versions,
}: {
  pullRequest: DeckOpenedPullRequest;
  threads: ReviewThreadsView;
  versions: ReviewVersionsView;
}) {
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
      (scroller?.getBoundingClientRect().top ?? 0) +
        (element
          .closest(".deck-changes")
          ?.querySelector<HTMLElement>(VERSIONS_BAR)?.offsetHeight ?? 0) +
        SECTION_MARGIN,
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
  const { bySection, sectionOfHunk } = useMemo(() => {
    const sectionOfHunk = new Map<string, string>();
    for (const section of sections)
      for (const entry of section.hunks)
        sectionOfHunk.set(entry.hunk.id, section.key);
    const bySection = new Map<string, PlacedThread[]>();
    for (const entry of placement?.placed ?? []) {
      const key = sectionOfHunk.get(entry.hunkId);
      if (key === undefined) continue;
      const list = bySection.get(key) ?? [];
      list.push(entry);
      bySection.set(key, list);
    }
    return { bySection, sectionOfHunk };
  }, [sections, placement]);
  // Only the hovered thread's section draws again as the hover moves.
  const hoveredHunk = placement?.placed.find(
    (entry) => entry.thread.id === hovered,
  )?.hunkId;
  const hoveredSection = hoveredHunk
    ? sectionOfHunk.get(hoveredHunk)
    : undefined;
  // Under the filter, only the threads on the hunks it shows.
  const placed = useMemo(
    () =>
      (placement?.placed ?? []).filter((entry) =>
        sectionOfHunk.has(entry.hunkId),
      ),
    [placement, sectionOfHunk],
  );
  const gutter = floating && placed.length > 0;
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
                  placed={bySection.get(section.key)}
                  changed={changed}
                  floating={gutter}
                  hovered={hoveredSection === section.key ? hovered : undefined}
                  onHover={onHover}
                  onAnchor={onAnchor}
                />
              ))}
            </div>
            {gutter ? (
              <ThreadGutter
                placed={placed}
                columnRef={list}
                hovered={hovered}
                onHover={onHover}
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
      {since?.folded.length ? (
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
 * API built them, with each review thread beside its line when `floating`,
 * or after it.
 */
export function PullRequestChanges({
  pullRequest,
  state,
  retry,
  threads,
  versions,
}: {
  pullRequest: LocalPullRequest;
  state: PullRequestReadState<DeckOpenedPullRequest>;
  retry: () => void;
  threads: ReviewThreadsView;
  versions: ReviewVersionsView;
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
          {/* A new diff, or another head, starts with no hunk viewed and the latest version shown. */}
          <ReviewChanges
            key={`${state.value.baseSha}..${state.value.headSha}`}
            pullRequest={state.value}
            threads={threads}
            versions={versions}
          />
        </DeckAskProvider>
      )}
    </section>
  );
}
