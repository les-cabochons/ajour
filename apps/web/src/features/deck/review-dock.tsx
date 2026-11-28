import type { ReactNode } from "react";
import {
  RiArrowRightDoubleLine as Collapse,
  RiChat3Line as ChatIcon,
  RiCloseLine as Close,
  RiDiscussLine as ThreadsIcon,
  RiPulseLine as StatusIcon,
  RiPushpinLine as Pin,
} from "@remixicon/react";
import { SidePanel } from "@/components/side-panel";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Value } from "@/components/ui/value";
import type {
  MergeReadiness,
  MergeRequirement,
} from "@/domain/deck/merge-readiness";
import {
  panelTab,
  type DeckView,
  type DeckViewsCommand,
  type DeckViewsState,
} from "@/domain/deck/review-views";
import { cn } from "@/lib/utils";
import { RequirementMark } from "./status-view";

/*
 * The review page's dock and side panel. The dock runs along the bottom of
 * the page: what stands between the pull request and its merge, then the
 * Threads and Chat launchers and Merge. Each of Status, Threads and Chat
 * opens as a peek above its launcher, which Escape, × or a click outside
 * closes. Pin moves a view into the side panel, as a tab; the views not
 * pinned still peek. A tab's × unpins it, and » collapses the panel,
 * keeping its pins: a pinned view's launcher opens the panel again. See
 * `domain/deck/review-views.ts`.
 */

export const viewNames: Record<DeckView, string> = {
  status: "Status",
  threads: "Threads",
  chat: "Chat",
};

const viewIcons: Record<DeckView, typeof Pin> = {
  status: StatusIcon,
  threads: ThreadsIcon,
  chat: ChatIcon,
};

export interface ReviewViewsControl {
  state: DeckViewsState;
  dispatch: (command: DeckViewsCommand) => void;
  /** Draws a view's content, in its peek or its tab. */
  renderView: (view: DeckView) => ReactNode;
  /** The narrow view: views peek, and nothing pins. */
  narrow: boolean;
}

/** A view's peek: its name, Pin and ×, then the view. */
function Peek({
  view,
  control,
  align,
  className,
}: {
  view: DeckView;
  control: ReviewViewsControl;
  align: "start" | "end";
  className?: string;
}) {
  const Icon = viewIcons[view];
  return (
    <PopoverContent
      side="top"
      align={align}
      sideOffset={8}
      className={cn("deck-peek w-96 gap-0 overflow-hidden p-0", className)}
      aria-label={viewNames[view]}
    >
      <div className="deck-peek-head">
        <Icon aria-hidden="true" className="deck-peek-icon" />
        <PopoverTitle className="deck-peek-title">
          {viewNames[view]}
        </PopoverTitle>
        {control.narrow ? null : (
          <Button
            variant="outline"
            size="xs"
            className="deck-peek-pin"
            onClick={() => control.dispatch({ type: "pin", view })}
          >
            <Pin aria-hidden="true" data-icon="inline-start" />
            Pin
          </Button>
        )}
        <TooltipButton
          label={`Close ${viewNames[view]}`}
          className="deck-peek-close"
          onClick={() => control.dispatch({ type: "close-peek" })}
        >
          <Close aria-hidden="true" />
        </TooltipButton>
      </div>
      <div className="deck-peek-body" data-view={view}>
        {control.renderView(view)}
      </div>
    </PopoverContent>
  );
}

/**
 * A launcher: the trigger of its view's peek, or, once the view is pinned,
 * a button that opens the panel on its tab.
 */
function Launcher({
  view,
  control,
  label,
  className,
  align,
  disabled,
  shortcut,
  children,
}: {
  view: DeckView;
  control: ReviewViewsControl;
  /** What the launcher says to assistive technology. */
  label: string;
  className: string;
  align: "start" | "end";
  disabled?: boolean;
  shortcut?: "deck.chat";
  children: ReactNode;
}) {
  const { state, dispatch, narrow } = control;
  const pinned = !narrow && state.pins.includes(view);
  const showing = pinned ? panelTab(state) === view : state.peek === view;
  const common = {
    className: cn(className, pinned && "is-pinned"),
    "aria-label": label,
    "data-showing": showing || undefined,
    disabled,
  };
  const mark = pinned ? (
    <Pin aria-label="Pinned" className="deck-dock-pin" />
  ) : null;
  if (pinned)
    return (
      <button
        type="button"
        {...common}
        aria-pressed={showing}
        onClick={() => dispatch({ type: "toggle", view })}
      >
        {children}
        {mark}
      </button>
    );
  // The chat in the narrow view is a sheet of its own, not a peek.
  if (narrow && view === "chat")
    return (
      <button
        type="button"
        {...common}
        aria-keyshortcuts={shortcut ? "A" : undefined}
        onClick={() => dispatch({ type: "toggle", view })}
      >
        {children}
      </button>
    );
  return (
    <Popover
      open={state.peek === view}
      onOpenChange={(open) =>
        dispatch(open ? { type: "show", view } : { type: "close-peek" })
      }
    >
      <PopoverTrigger
        render={<button type="button" {...common} />}
        aria-keyshortcuts={shortcut ? "A" : undefined}
      >
        {children}
      </PopoverTrigger>
      <Peek view={view} control={control} align={align} />
    </Popover>
  );
}

function DockRequirement({ requirement }: { requirement: MergeRequirement }) {
  return (
    <span className="deck-dock-item">
      <RequirementMark state={requirement.state} />
      {requirement.text}
    </span>
  );
}

export function ReviewDock({
  control,
  readiness,
  threads,
  chatReady,
  merge,
}: {
  control: ReviewViewsControl;
  readiness: MergeReadiness;
  /** The open threads and the draft comments. */
  threads: number;
  /** The chat waits until the diff shows. */
  chatReady: boolean;
  /** Merge…, for the author of an open pull request. */
  merge?: ReactNode;
}) {
  const open = readiness.state !== "merged" && readiness.state !== "closed";
  const shown = open
    ? readiness.requirements.filter(
        (requirement) => requirement.key !== "stack",
      )
    : [];
  return (
    <div className="deck-dock" role="toolbar" aria-label="Pull request">
      <Launcher
        view="status"
        control={control}
        align="start"
        className="deck-dock-status"
        label={`Status: ${[readiness.label, ...shown.map((entry) => entry.text)].join(", ")}`}
      >
        <span className="deck-dock-item deck-dock-readiness">
          {open ? (
            <RequirementMark
              state={
                readiness.state === "blocked"
                  ? "failed"
                  : readiness.state === "waiting"
                    ? "pending"
                    : "met"
              }
            />
          ) : null}
          {readiness.label}
        </span>
        {shown.map((requirement) => (
          <DockRequirement key={requirement.key} requirement={requirement} />
        ))}
      </Launcher>
      <span className="deck-dock-space" />
      <Launcher
        view="threads"
        control={control}
        align="end"
        className="deck-dock-launcher"
        label={`Threads, ${threads} to look at`}
      >
        <ThreadsIcon aria-hidden="true" />
        <span className="deck-dock-launcher-name">Threads</span>
        {threads ? <Value tone="muted">{threads}</Value> : null}
      </Launcher>
      <Launcher
        view="chat"
        control={control}
        align="end"
        className="deck-dock-launcher"
        label="Chat"
        disabled={!chatReady}
        shortcut="deck.chat"
      >
        <ChatIcon aria-hidden="true" />
        <span className="deck-dock-launcher-name">Chat</span>
      </Launcher>
      {merge}
    </div>
  );
}

/** The side panel of the pinned views: a tab for each, × to unpin, » to collapse. */
export function ReviewSidePanel({ control }: { control: ReviewViewsControl }) {
  const { state, dispatch, renderView } = control;
  const tab = panelTab(state);
  if (!tab) return null;
  return (
    <SidePanel
      contentKey="deck-panel"
      widthKey="deck"
      aria-label={`${viewNames[tab]} panel`}
      className="deck-side-panel"
      contentClassName="deck-side-panel-scroll"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented)
          dispatch({ type: "collapse" });
      }}
    >
      <div className="deck-panel-head">
        <div className="deck-panel-tabs" role="group" aria-label="Pinned views">
          {state.pins.map((view) => {
            const Icon = viewIcons[view];
            return (
              <span
                key={view}
                className="deck-panel-tab"
                data-active={view === tab || undefined}
              >
                <button
                  type="button"
                  className="deck-panel-tab-name"
                  aria-pressed={view === tab}
                  onClick={() => dispatch({ type: "tab", view })}
                >
                  <Icon aria-hidden="true" />
                  {viewNames[view]}
                </button>
                <TooltipButton
                  label={`Unpin ${viewNames[view]}`}
                  className="deck-panel-tab-close"
                  onClick={() => dispatch({ type: "unpin", view })}
                >
                  <Close aria-hidden="true" />
                </TooltipButton>
              </span>
            );
          })}
        </div>
        <TooltipButton
          label="Collapse the panel"
          side="left"
          className="deck-panel-collapse"
          onClick={() => dispatch({ type: "collapse" })}
        >
          <Collapse aria-hidden="true" />
        </TooltipButton>
      </div>
      <div className="deck-panel-body" data-view={tab}>
        {renderView(tab)}
      </div>
    </SidePanel>
  );
}
