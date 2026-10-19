import { useCallback } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

/**
 * Opens the Commit page for the week on screen, or for the week of `weekOf`
 * when given. On a Day or Week page it asks the page through
 * `action=commit-week` (with `target=<weekOf>`), so the page saves or keeps an
 * open entry draft first and passes its view along. Elsewhere it opens the
 * Commit page directly. `CommitWeekButton` (the sidebar foot,
 * or the top bar while that foot is off screen) and the narrow bottom row
 * share it.
 */
export function useOpenCommitPage(selectedTimeDate: string) {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return useCallback(
    (weekOf?: string) => {
      const timePageDate = pathname.match(/^\/time\/([^/]+)$/)?.[1];
      if (timePageDate) {
        void navigate({
          to: "/time/$date",
          params: { date: timePageDate },
          search: ((previous: Record<string, unknown>) => ({
            ...previous,
            action: "commit-week",
            target: weekOf,
          })) as never,
        });
        return;
      }
      void navigate({
        to: "/time/$date/commit",
        params: { date: weekOf ?? selectedTimeDate },
      });
    },
    [navigate, pathname, selectedTimeDate],
  );
}
