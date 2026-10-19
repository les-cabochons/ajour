import { useCallback } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

/**
 * Opens the Commit page for the week on screen. On a Day or Week page it asks
 * the page through `action=commit-week`, so the page saves or keeps an open
 * entry draft first and passes its view along. Elsewhere it opens the Commit
 * page of `selectedTimeDate`'s week. The sidebar foot and the narrow bottom
 * row share it.
 */
export function useOpenCommitPage(selectedTimeDate: string) {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return useCallback(() => {
    const timePageDate = pathname.match(/^\/time\/([^/]+)$/)?.[1];
    if (timePageDate) {
      void navigate({
        to: "/time/$date",
        params: { date: timePageDate },
        search: ((previous: Record<string, unknown>) => ({
          ...previous,
          action: "commit-week",
        })) as never,
      });
      return;
    }
    void navigate({
      to: "/time/$date/commit",
      params: { date: selectedTimeDate },
    });
  }, [navigate, pathname, selectedTimeDate]);
}
