import {
  selectSidebarPullRequests,
  selectVisiblePullRequests,
} from "@/domain/pull-requests/pull-request-lifecycle";
import { SidebarSectionHeader } from "@/features/layout/sidebar-backlog-list";
import { PullRequestRow } from "@/features/pull-requests/pull-request-row";
import { useCodeHostConnections } from "@/lib/code-host-connections";
import { useLocalState } from "@/lib/local-hooks";
import { updateSidebarLayout, useSidebarLayout } from "@/lib/sidebar-layout";
import { useNow } from "@/lib/use-now";

/** The pull requests that need the user, as their own sidebar list. */
export function useSidebarPullRequests() {
  const state = useLocalState();
  const { overview, groups } = useCodeHostConnections();
  const now = useNow();
  return {
    enabled: groups.length > 0,
    items: groups.length
      ? selectSidebarPullRequests(
          selectVisiblePullRequests(state.pullRequests ?? [], overview, now),
          now,
        )
      : [],
    connectionCount: groups.reduce(
      (count, group) => count + group.connections.length,
      0,
    ),
    now,
  };
}

/**
 * The collapsible Pull requests section of the sidebar work list, shown while
 * pull requests need the user. The view switcher lists the Pull requests page
 * as soon as a code host plugin is enabled.
 */
export function SidebarPullRequests({ pathname }: { pathname: string }) {
  const layout = useSidebarLayout();
  const { enabled, items, connectionCount, now } = useSidebarPullRequests();
  // Like the backlog sections, an empty section is not shown.
  if (!enabled || items.length === 0) return null;

  return (
    <section
      aria-label="Pull requests on your plate"
      className="flex shrink-0 flex-col"
    >
      <SidebarSectionHeader
        label="Pull requests"
        count={items.length}
        open={layout.pullRequestsOpen}
        onToggle={() =>
          updateSidebarLayout({ pullRequestsOpen: !layout.pullRequestsOpen })
        }
      />
      {layout.pullRequestsOpen
        ? items.map((item) => (
            <PullRequestRow
              key={item._id}
              item={item}
              now={now}
              compact
              selected={pathname === `/pull-requests/${item._id}`}
              showConnection={connectionCount > 1}
            />
          ))
        : null}
    </section>
  );
}
