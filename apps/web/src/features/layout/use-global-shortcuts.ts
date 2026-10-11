import { useNavigate } from "@tanstack/react-router";
import { selectMostRecentTimesheetEntry } from "@/domain/time/timesheet-entry";
import { localStore } from "@/lib/local-store";
import { useShortcut } from "@/lib/shortcut-handlers";
import { todayIsoDate } from "@/lib/utils";

/**
 * Day rows and Week cards carry the entry id in this attribute, so C can
 * continue the entry whose row or card has focus. The running entry's row
 * carries an id that never matches a saved entry, so C does nothing there.
 */
const ENTRY_ID_ATTRIBUTE = "data-entry-id";

/**
 * The app-wide handlers for the global shortcuts in `lib/shortcuts.ts`. The Time
 * page registers its own N and T, which win while it is mounted; these run
 * everywhere else. N elsewhere opens the titlebar's new entry popover, so the
 * titlebar registers it. `selectedTimeDate` is the day the titlebar shows, which
 * "G then T" opens, like the sidebar's Time link.
 */
export function useGlobalShortcuts(selectedTimeDate: string) {
  const navigate = useNavigate();

  useShortcut(
    "entry.stop-or-start",
    () => {
      const runningTimer = localStore.snapshot().timers[0];
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
  useShortcut("go.settings", () => void navigate({ to: "/settings" }), "app");
  useShortcut("app.settings", () => void navigate({ to: "/settings" }), "app");
}
