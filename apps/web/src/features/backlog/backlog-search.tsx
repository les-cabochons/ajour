import { ExpandingSearch } from "@/components/expanding-search";
import { updateBacklogSearch, useBacklogSearch } from "@/lib/backlog-search";

/**
 * The Backlog page's Search (#652): the sidebar's expanding box, in the top
 * bar before Filter, or in the narrow view's toolbar row. The page narrows
 * its rows with the query through `createWorkItemSearch`.
 */
export function BacklogSearch() {
  const state = useBacklogSearch();
  return (
    <ExpandingSearch
      state={state}
      onChange={updateBacklogSearch}
      label="Search the backlog"
      className="w-44"
    />
  );
}
