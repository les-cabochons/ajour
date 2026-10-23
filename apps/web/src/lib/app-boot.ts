import { localStateLoad, localStore } from "@/lib/local-store";
import { wideEvents } from "@/lib/wide-events";

/**
 * Starts the renderer's `app.boot` event: it loads the local state, records
 * how that went, and ends when the app has first rendered, or failed to. The
 * boot is a lifecycle unit, so the load's writes, such as a desktop
 * recovery, count on it. A load that throws ends it with the error.
 */
export function startAppBoot() {
  const unit = wideEvents.start("app.boot", {
    kind: "lifecycle",
    trigger: "boot",
  });
  try {
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
  } catch (error) {
    unit.fail(error);
    unit.end();
    throw error;
  }
  const renderStartedAt = performance.now();
  const renderTook = () => ({
    boot: { first_render_ms: Math.round(performance.now() - renderStartedAt) },
  });
  return {
    /** The app committed its first render. Only the first end counts. */
    rendered() {
      unit.set(renderTook());
      unit.end();
    },
    /** The first render failed with `error`. Only the first end counts. */
    failed(error: unknown) {
      unit.set(renderTook());
      unit.fail(error);
      unit.end();
    },
  };
}
