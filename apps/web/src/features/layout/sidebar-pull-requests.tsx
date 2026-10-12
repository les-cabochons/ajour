import {
  selectSidebarPullRequests,
  selectVisiblePullRequests,
} from "@/domain/pull-requests/pull-request-lifecycle";
import { PullRequestRow } from "@/features/pull-requests/pull-request-row";
import { useCodeHostConnections } from "@/lib/code-host-connections";
import { useLocalState } from "@/lib/local-hooks";
import { useNow } from "@/lib/use-now";

export function SidebarPullRequests({ pathname }: { pathname: string }) {
  const state = useLocalState();
  const { overview, groups } = useCodeHostConnections();
  const now = useNow();
  if (!groups.length) return null;
  const items = selectSidebarPullRequests(
    selectVisiblePullRequests(state.pullRequests ?? [], overview, now),
    now,
  );
  return (
    <section
      data-focus-scope
      aria-label="Pull requests on your plate"
      className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
    >
      <h2 className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
        Pull requests ({items.length})
      </h2>
      {items.length ? (
        items.map((item) => (
          <PullRequestRow
            key={item._id}
            item={item}
            now={now}
            compact
            selected={pathname === `/pull-requests/${item._id}`}
            showConnection={
              groups.reduce(
                (count, group) => count + group.connections.length,
                0,
              ) > 1
            }
          />
        ))
      ) : (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No pull requests need you.
        </p>
      )}
    </section>
  );
}
