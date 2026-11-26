import { Fragment, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  RiArrowDownSLine as Fold,
  RiArrowLeftSLine as Below,
  RiArrowRightSLine as Above,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { reviewDeckUrl, type DeckStackPosition } from "@/domain/deck/stacks";
import { rollupSummary } from "@/domain/deck/review-status";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { NARROW_VIEW_QUERY } from "@/lib/breakpoints";
import { useShortcut } from "@/lib/shortcut-handlers";
import { openSourceUrl } from "@/lib/source-navigation";
import { useMediaQuery } from "@/lib/use-media-query";

const layerLink = (layer: LocalPullRequest) => ({
  to: "/deck/$itemId" as const,
  params: { itemId: layer._id },
});

/** A layer's state for the full stack: Draft, and its checks. */
function layerStatus(layer: LocalPullRequest) {
  const checks = rollupSummary(layer.facts.checks).text;
  return layer.facts.draft ? `Draft · ${checks}` : checks;
}

/**
 * The full stack, bottom first, which is the merge order: each layer with
 * its number, title and state, a link but for this one.
 */
function FullStack({
  pullRequest,
  stack,
  onOpen,
}: {
  pullRequest: LocalPullRequest;
  stack: DeckStackPosition;
  onOpen: () => void;
}) {
  return (
    <>
      <p className="deck-stack-merge-order">
        Merges into {stack.base}, bottom first.
      </p>
      <ol className="deck-stack-list">
        {stack.layers.map((layer, at) => {
          const self = layer._id === pullRequest._id;
          const content = (
            <>
              <span className="deck-stack-number">#{layer.facts.number}</span>
              <span className="min-w-0 flex-1 truncate">
                {layer.facts.title}
              </span>
              <span className="deck-stack-layer-status">
                {self ? "This layer" : layerStatus(layer)}
              </span>
            </>
          );
          return (
            <li key={layer._id}>
              {self ? (
                <span className="deck-stack-layer" aria-current="page">
                  {content}
                </span>
              ) : (
                <Link
                  {...layerLink(layer)}
                  className="deck-stack-layer"
                  onClick={onOpen}
                >
                  {content}
                </Link>
              )}
              {stack.stale[at] ? (
                <span className="deck-stack-layer-stale">
                  #{stack.layers[at - 1]?.facts.number} changed since it was
                  based on it
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * The stack strip under the status line (#788): `Stack 2 of 3 · main ←
 * #479 ← #482 this ← #485`, with ‹ › for the layers below and above, a
 * quiet line when the layer below moved since this one was based on it,
 * and on Azure DevOps a link to restack in Review Deck. **Stack 2 of 3**
 * and L open the full stack, a popover; in the narrow view the strip folds
 * to `Stack 2/3 ▾`, which opens it in a sheet.
 */
export function StackStrip({
  pullRequest,
  stack,
}: {
  pullRequest: LocalPullRequest;
  stack: DeckStackPosition;
}) {
  const narrow = useMediaQuery(NARROW_VIEW_QUERY);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  useShortcut("deck.stack", () => setOpen((shown) => !shown));
  const place = stack.index + 1;
  const size = stack.layers.length;
  const { below, above } = stack;
  const restack =
    pullRequest.pluginId === "azure_devops"
      ? reviewDeckUrl(pullRequest.facts.url)
      : undefined;
  const close = () => setOpen(false);
  const go = (layer: LocalPullRequest | undefined) => {
    if (layer) void navigate(layerLink(layer));
  };

  return (
    <nav className="deck-stack" aria-label="Stack">
      {narrow ? (
        <>
          <button
            type="button"
            className="deck-stack-name"
            aria-label={`Stack ${place}/${size}`}
            onClick={() => setOpen(true)}
          >
            Stack {place}/{size}
            <Fold aria-hidden="true" className="size-3.5" />
          </button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent
              side="bottom"
              className="flex max-h-[85dvh] flex-col gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
            >
              <SheetHeader className="p-0">
                <SheetTitle>Stack</SheetTitle>
              </SheetHeader>
              <FullStack
                pullRequest={pullRequest}
                stack={stack}
                onOpen={close}
              />
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <p className="deck-stack-strip">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={
              below ? `Layer below, #${below.facts.number}` : "Layer below"
            }
            disabled={!below}
            onClick={() => go(below)}
          >
            <Below aria-hidden="true" />
          </Button>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={<button type="button" className="deck-stack-name" />}
            >
              Stack {place} of {size}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96 max-w-[90vw] gap-2">
              <PopoverTitle className="text-sm">Stack</PopoverTitle>
              <FullStack
                pullRequest={pullRequest}
                stack={stack}
                onOpen={close}
              />
            </PopoverContent>
          </Popover>
          <span aria-hidden="true"> · </span>
          <span className="deck-stack-base">{stack.base}</span>
          {stack.layers.map((layer) => (
            <Fragment key={layer._id}>
              <span aria-hidden="true"> ← </span>
              {layer._id === pullRequest._id ? (
                <span className="deck-stack-this" aria-current="page">
                  #{layer.facts.number} this
                </span>
              ) : (
                <Link
                  {...layerLink(layer)}
                  className="deck-stack-link"
                  title={layer.facts.title}
                >
                  #{layer.facts.number}
                </Link>
              )}
            </Fragment>
          ))}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={
              above ? `Layer above, #${above.facts.number}` : "Layer above"
            }
            disabled={!above}
            onClick={() => go(above)}
          >
            <Above aria-hidden="true" />
          </Button>
        </p>
      )}
      {stack.staleBase && below ? (
        <p className="deck-stack-stale">
          #{below.facts.number} changed since this layer was based on it.
        </p>
      ) : null}
      {restack ? (
        <a
          className="deck-stack-restack"
          href={restack}
          onClick={(event) => {
            event.preventDefault();
            openSourceUrl(restack);
          }}
        >
          Restack in Review Deck
        </a>
      ) : null}
    </nav>
  );
}
