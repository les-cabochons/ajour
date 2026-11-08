import type { ReactNode } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import type { BacklogDoneWindow } from "@/domain/backlog/backlog-view";

/**
 * The Done shelf at the end of the Backlog page: the archived items that the
 * done window keeps, out of their groups so the groups show only open work.
 * Closed by default. Its header counts the items and links to the archive,
 * which holds every archived item. "Done shelf" under "Backlog" in
 * docs/agents/ux-spec.md.
 */
export function BacklogDoneShelf({
  count,
  doneWindow,
  open,
  onToggle,
  onOpenArchive,
  children,
}: {
  count: number;
  doneWindow: BacklogDoneWindow;
  open: boolean;
  onToggle: () => void;
  onOpenArchive: () => void;
  /** The shelf's rows, rendered only while it is open. */
  children: ReactNode;
}) {
  const label = doneWindow === "week" ? "Done in the past week" : "Done";
  return (
    <section className="backlog-done-shelf" aria-label={label}>
      <div className="backlog-group-header">
        <h2>
          <button
            type="button"
            className="backlog-done-shelf-toggle"
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? (
              <RiArrowDownSLine aria-hidden className="size-4" />
            ) : (
              <RiArrowRightSLine aria-hidden className="size-4" />
            )}
            {label}
            <span className="backlog-group-count">{count}</span>
          </button>
        </h2>
        <Button variant="ghost" size="sm" onClick={onOpenArchive}>
          View archive
        </Button>
      </div>
      {open && <div role="list">{children}</div>}
    </section>
  );
}
