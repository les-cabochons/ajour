import { useState } from "react";
import { RiPencilLine as DraftIcon } from "@remixicon/react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { personName } from "@/domain/deck/review-status";
import {
  filterThreadList,
  threadListCounts,
  threadListLocation,
  type ThreadListEntry,
  type ThreadListFilter,
} from "@/domain/deck/thread-list";
import { CheckMark } from "./status-view";

/*
 * Deck's Threads view: every review thread and draft comment of the pull
 * request in one list, open first. Choosing one shows it: on its line in
 * Changes, or in the conversation on Overview when the diff can't show it.
 */

const filters: { value: ThreadListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "drafts", label: "Drafts" },
  { value: "resolved", label: "Resolved" },
];

function EntryMark({ entry }: { entry: ThreadListEntry }) {
  if (entry.kind === "draft")
    return <DraftIcon aria-hidden="true" className="deck-check-mark" />;
  return <CheckMark state={entry.kind === "open" ? "pending" : "success"} />;
}

const age = (at: number, now: number) => {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

export function ThreadsView({
  entries,
  now,
  loading,
  onShow,
}: {
  entries: readonly ThreadListEntry[];
  now: number;
  /** The conversation is still being read: only the drafts are known. */
  loading: boolean;
  onShow: (entry: ThreadListEntry) => void;
}) {
  const [filter, setFilter] = useState<ThreadListFilter>("all");
  const counts = threadListCounts(entries);
  const shown = filterThreadList(entries, filter);
  return (
    <div className="deck-view deck-threads-view">
      <ToggleGroup
        aria-label="Show threads"
        variant="outline"
        size="sm"
        className="deck-threads-filter"
        value={[filter]}
        onValueChange={(values) => {
          const next = values[0] as ThreadListFilter | undefined;
          if (next) setFilter(next);
        }}
      >
        {filters.map((entry) => (
          <ToggleGroupItem key={entry.value} value={entry.value}>
            {entry.label}
            <span className="deck-threads-filter-count">
              {counts[entry.value]}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {loading && shown.length === 0 ? (
        <p className="deck-view-note" role="status">
          Loading the threads…
        </p>
      ) : shown.length === 0 ? (
        <p className="deck-view-note">
          {filter === "all"
            ? "No threads on this pull request yet."
            : filter === "open"
              ? "No open threads."
              : filter === "drafts"
                ? "No draft comments."
                : "No resolved threads."}
        </p>
      ) : (
        <ul className="deck-view-list">
          {shown.map((entry) => (
            <li key={entry.key}>
              <button
                type="button"
                className="deck-thread-entry"
                onClick={() => onShow(entry)}
              >
                <EntryMark entry={entry} />
                <span className="deck-thread-entry-text">
                  <span className="deck-thread-entry-head">
                    <span className="deck-thread-entry-location">
                      {threadListLocation(entry)}
                    </span>
                    <span className="deck-thread-entry-age">
                      {entry.kind === "draft"
                        ? "Draft"
                        : entry.outdated
                          ? "Outdated"
                          : age(entry.at, now)}
                    </span>
                  </span>
                  <span className="deck-thread-entry-body">{entry.body}</span>
                  <span className="deck-thread-entry-meta">
                    {entry.author ? personName(entry.author) : "You"}
                    {entry.replies
                      ? ` · ${entry.replies} ${entry.replies === 1 ? "reply" : "replies"}`
                      : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
