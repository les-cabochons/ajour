import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { RiAlarmWarningLine } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { showActionToast } from "@/components/ui/toast";
import type { LocalWorkItem } from "@/domain/local-state";
import { leaveOpenDraft } from "@/lib/open-draft";
import { subscribeDescriptionConflicts } from "@/lib/sync-conflict-events";
import { cn } from "@/lib/utils";

/** The search params of Sync review: the item whose issues it opens on. */
export interface SyncReviewSearch {
  item?: string;
}

export function parseSyncReviewSearch(
  search: Record<string, unknown>,
): SyncReviewSearch {
  return typeof search.item === "string" && search.item
    ? { item: search.item }
    : {};
}

/**
 * Opens Sync review on an item's issues, once an open backlog draft is
 * saved; a draft that cannot be saved keeps the user where they are.
 */
export function useOpenSyncReview() {
  const navigate = useNavigate();
  return async (itemId?: string) => {
    if (!(await leaveOpenDraft())) return;
    void navigate({
      to: "/settings/sync-review",
      search: (itemId ? { item: itemId } : {}) as never,
    });
  };
}

/**
 * The mark of an item a sync left something to resolve on, in every view
 * that lists the item. It opens Sync review on the item.
 */
export function SyncConflictButton({
  item,
  className,
}: {
  item: Pick<LocalWorkItem, "_id" | "title">;
  className?: string;
}) {
  const openSyncReview = useOpenSyncReview();
  return (
    <TooltipButton
      label="Sync conflict. Click to resolve"
      aria-label={`Resolve the sync conflict on ${item.title}`}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center text-destructive",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        void openSyncReview(item._id);
      }}
    >
      <RiAlarmWarningLine className="size-3.5" aria-hidden="true" />
    </TooltipButton>
  );
}

/** Shows a toast when a sync puts descriptions in conflict. */
export function SyncConflictToasts() {
  const openSyncReview = useRef(useOpenSyncReview());
  useEffect(
    () =>
      subscribeDescriptionConflicts((items) => {
        const only = items.length === 1 ? items[0] : undefined;
        showActionToast({
          title: only
            ? `Description conflict on ${only.title}`
            : `${items.length} description conflicts`,
          actionLabel: "Resolve",
          onAction: () => void openSyncReview.current(only?._id),
        });
      }),
    [],
  );
  return null;
}
