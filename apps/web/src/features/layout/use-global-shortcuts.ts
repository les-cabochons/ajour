import { useNavigate } from "@tanstack/react-router";
import { getBacklogItemActions } from "@/domain/actions/object-actions";
import { findPinnedTask } from "@/domain/projects/project-transitions";
import { selectMostRecentTimesheetEntry } from "@/domain/time/timesheet-entry";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import { resolveFocusedObject } from "@/lib/focused-object";
import { localStore } from "@/lib/local-store";
import { useShortcut } from "@/lib/shortcut-handlers";
import { isNarrowView } from "@/lib/use-narrow-view";
import { todayIsoDate } from "@/lib/utils";

/**
 * Day rows and Week cards carry the entry id in this attribute, so C can
 * continue the entry whose row or card has focus. The running entry's row
 * carries an id that never matches a saved entry, so C does nothing there.
 */
const ENTRY_ID_ATTRIBUTE = "data-entry-id";

/**
 * The app-wide handlers for the global shortcuts in `lib/shortcuts.ts`. The Time
 * page registers its own N, T and pinned task digits, which win while it is
 * mounted; these run everywhere else. N and the plain digits elsewhere open the
 * titlebar's new entry popover, so the titlebar registers them. `selectedTimeDate` is the day the titlebar shows, which
 * "G then T" opens, like the sidebar's Time link.
 */
export function useGlobalShortcuts(selectedTimeDate: string) {
  const navigate = useNavigate();

  useShortcut(
    "entry.stop-or-start",
    () => {
      const state = localStore.snapshot();
      const runningTimer = state.timers[0];
      // Like C on a focused entry, S on a focused backlog item starts an entry
      // on it, switching from any running one. On the item already running, S
      // stops it as usual.
      const focused = resolveFocusedObject(document.activeElement);
      const workItem =
        focused?.kind === "backlog-item"
          ? state.workItems.find((item) => item._id === focused.workItemId)
          : undefined;
      if (workItem && runningTimer?.workItemId !== workItem._id) {
        const start = getBacklogItemActions(workItem, {
          subitemCount: 0,
          isSubitem: false,
          isRunning: false,
        }).find((action) => action.id === "start-entry");
        if (!start?.disabledReason) {
          runBacklogItemAction(workItem, "start-entry", () => undefined);
        }
        return;
      }

      if (runningTimer) {
        localStore.saveTimer(runningTimer._id);
      } else {
        // startTimer puts it on today. See "Running entries" in the UX spec.
        localStore.startTimer({});
      }
    },
    "app",
  );

  useShortcut(
    "entry.continue",
    () => {
      const state = localStore.snapshot();
      const runningEntryId = state.timers[0]?.entryId;
      const focusedEntry = document.activeElement?.closest(
        `[${ENTRY_ID_ATTRIBUTE}]`,
      );
      const entryId = focusedEntry
        ? focusedEntry.getAttribute(ENTRY_ID_ATTRIBUTE)
        : selectMostRecentTimesheetEntry(
            state.timesheetEntries,
            todayIsoDate(),
            runningEntryId,
          )?._id;

      // The running entry's slot reads Stop, so C does not apply to it.
      if (
        entryId &&
        entryId !== runningEntryId &&
        state.timesheetEntries.some((entry) => entry._id === entryId)
      ) {
        localStore.continueTimesheetEntry(entryId);
      }
    },
    "app",
  );

  useShortcut(
    "pinned.start",
    ({ digit }) => {
      const pinned =
        digit && findPinnedTask(localStore.snapshot().projects, digit);
      if (pinned) {
        // Like Start entry on the task: today, saving any running entry first.
        localStore.startTimer({
          projectId: pinned.project._id,
          taskId: pinned.task._id,
          accumulatedDurationMs: 0,
        });
      }
    },
    "app",
  );

  useShortcut(
    "time.today",
    () =>
      void navigate({
        to: "/time/$date",
        params: { date: todayIsoDate() },
      }),
    "app",
  );

  useShortcut(
    "go.time",
    () =>
      void navigate({
        to: "/time/$date",
        params: { date: selectedTimeDate },
      }),
    "app",
  );
  useShortcut("go.backlog", () => void navigate({ to: "/backlog" }), "app");
  useShortcut("go.projects", () => void navigate({ to: "/projects" }), "app");
  // /settings is the pages list in the narrow view. Wide windows open General
  // directly rather than through the /settings redirect, which could land
  // after a quick Back to app and return to Settings.
  const openSettings = () =>
    void navigate({ to: isNarrowView() ? "/settings" : "/settings/general" });
  useShortcut("go.settings", openSettings, "app");
  useShortcut("app.settings", openSettings, "app");
}
