import { useCallback, useMemo, useRef, useState } from "react";
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
import { DeckAskProvider, type DeckAskTarget } from "./deck-ask";
import { GuideTree } from "./guide-tree";
import { ReviewSectionView, SECTION_ATTRIBUTE } from "./review-sections";
import { usePullRequestDiff } from "./use-pull-request-diff";

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

/**
 * The guide, or the files A–Z, of an opened pull request, with the guide
 * tree beside it. J and K move between its sections and F opens the tree's
 * titles, while the page is mounted (`deck` shortcuts).
 */
function ReviewChanges({
  pullRequest,
}: {
  pullRequest: DeckOpenedPullRequest;
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
          <div ref={list} className="deck-review-sections">
            {sections.map((section) => (
              <ReviewSectionView
                key={section.key}
                section={section}
                viewed={viewed}
                theme={theme}
                onToggleViewed={onToggleViewed}
              />
            ))}
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

/** The pull request's changes: its guide, or its files A–Z, once the local API built them. */
export function PullRequestChanges({
  pullRequest,
}: {
  pullRequest: LocalPullRequest;
}) {
  const { state, retry } = usePullRequestDiff(pullRequest);
  const head = state.status === "ready" ? state.diff.headSha : undefined;
  const { pluginId, connectionId } = pullRequest;
  const { repository, number } = pullRequest.facts;
  // What the page's asks are about: the pull request at the head it shows.
  const askTarget = useMemo<DeckAskTarget | undefined>(
    () =>
      head ? { pluginId, connectionId, repository, number, head } : undefined,
    [pluginId, connectionId, repository, number, head],
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
        <DeckAskProvider target={askTarget!}>
          {/* A new diff, or another head, starts with no hunk marked viewed. */}
          <ReviewChanges
            key={`${state.diff.baseSha}..${state.diff.headSha}`}
            pullRequest={state.diff}
          />
        </DeckAskProvider>
      )}
    </section>
  );
}
