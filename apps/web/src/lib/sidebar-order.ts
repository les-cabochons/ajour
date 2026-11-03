import { selectSidebarBacklogItems } from "@/domain/backlog/backlog-item-lifecycle";
import { createSidebarMatcher } from "@/domain/backlog/sidebar-filter";
import type { LocalAppState } from "@/domain/local-state";
import { getSidebarLayout } from "@/lib/sidebar-layout";
import { getSidebarSearch } from "@/lib/sidebar-search";

/**
 * The ids of the sidebar's work list as it shows now: pinned rows first, in
 * the list's ordering, narrowed by the search and the project filter, as
 * `AppNavigationSidebar` builds it. The item page reads it to open the next
 * row after a settle or a snooze (#488).
 */
export function getSidebarBacklogItemIds(state: LocalAppState, now: number) {
  const matcher = createSidebarMatcher(
    {
      query: getSidebarSearch().query,
      projectId: getSidebarLayout().projectId,
    },
    state.projects,
  );
  return selectSidebarBacklogItems(state, now)
    .filter(matcher.workItem)
    .map((workItem) => workItem._id);
}
