import type { ReactNode } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";

/**
 * A shelf at the end of the Backlog page: the Settled shelf or the Done
 * shelf, which hold the items off the user's plate so the groups show only
 * the work on it. Closed by default. Open and empty, it says so. Its header counts the items and can end
 * with an action, such as View archive. "Shelves" under "Backlog" in
 * docs/agents/ux-spec.md.
 */
export function BacklogShelf({
  label,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  /** The shelf's title, also the name of its region. */
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** A control at the header's right, such as View archive. */
  action?: ReactNode;
  /** The shelf's rows, rendered only while it is open. */
  children: ReactNode;
}) {
  return (
    <section className="backlog-shelf" aria-label={label}>
      <div className="backlog-group-header">
        <h2>
          <button
            type="button"
            className="backlog-shelf-toggle"
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
        {action}
      </div>
      {open &&
        (count > 0 ? (
          <div role="list">{children}</div>
        ) : (
          <p className="backlog-shelf-empty">No items</p>
        ))}
    </section>
  );
}
