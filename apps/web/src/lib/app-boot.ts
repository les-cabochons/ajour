import { localStateLoad, localStore } from "@/lib/local-store";
import { wideEvents } from "@/lib/wide-events";

/**
 * Starts the renderer's `app.boot` event: it loads the local state, records
 * how that went, and ends when the app has first rendered. The boot is a
 * lifecycle unit, so the load's writes, such as a desktop recovery, count on
 * it.
 */
export function startAppBoot() {
  const unit = wideEvents.start("app.boot", {
    kind: "lifecycle",
    trigger: "boot",
  });
  const state = unit.enter(() => localStore.snapshot());
  const { boot, recovery } = localStateLoad();
  unit.set({
    boot,
    recovery,
    records: {
      project_count: state.projects.length,
      time_entry_count: state.timesheetEntries.length,
      running_entry_count: state.timers.length,
      backlog_item_count: state.workItems.length,
      pull_request_count: state.pullRequests?.length ?? 0,
      submitted_week_count: state.lockedWeeks.length,
      workflow_state_count: state.workflowStates.length,
    },
  });
  const renderStartedAt = performance.now();
  return {
    /** The app committed its first render. Later calls change nothing. */
    rendered() {
      unit.set({
        boot: {
          first_render_ms: Math.round(performance.now() - renderStartedAt),
        },
      });
      unit.end();
    },
  };
}
