import { showActionToast, UNDO_TOAST_TIMEOUT_MS } from "@/components/ui/toast";
import {
  getDisplaySettingsHiding,
  getFilterFieldsHiding,
} from "@/domain/backlog/backlog-view";
import { createWorkItemSearch } from "@/domain/backlog/work-item-search";
import { readBacklogSearch, updateBacklogSearch } from "@/lib/backlog-search";
import {
  readBacklogView,
  type BacklogViewPreferences,
  updateBacklogView,
} from "@/lib/backlog-view-settings";
import { localStore } from "@/lib/local-store";

/**
 * After the Backlog page creates an item, says so when the page's filters,
 * Display settings or search hide it, as the toast "“Fix login” is hidden by
 * the filters" with Show. Show undoes only what hides it: the filters it
 * fails, the Display setting that excludes it (Show subitems) and the search
 * when it misses the item. Filters that match it stay. A new item takes the filters' values
 * where it can (`getNewItemFilterPreset`), so this is for the rest, such as
 * two priorities filtered at once.
 */
export function offerToShowHiddenNewItem(workItemId: string) {
  const state = localStore.snapshot();
  const workItem = state.workItems.find((item) => item._id === workItemId);
  if (!workItem) return;
  const view = readBacklogView();
  const context = {
    now: Date.now(),
    runningWorkItemId: state.timers[0]?.workItemId,
  };
  const fields = getFilterFieldsHiding(
    state,
    view.filters,
    context,
    workItemId,
  );
  const settings = getDisplaySettingsHiding(view, workItem);
  const searchHides = !createWorkItemSearch(
    readBacklogSearch().query,
    state.projects,
  ).matches(workItem);
  if (fields.length === 0 && settings.length === 0 && !searchHides) return;

  const by = fields.length
    ? "filters"
    : settings.length
      ? "display settings"
      : "search";
  showActionToast({
    title: `“${workItem.title}” is hidden by the ${by}`,
    actionLabel: "Show",
    timeout: UNDO_TOAST_TIMEOUT_MS,
    onAction: () => {
      const patch: Partial<BacklogViewPreferences> = {};
      if (fields.length) {
        patch.filters = readBacklogView().filters.filter(
          (filter) => !fields.includes(filter.field),
        );
      }
      for (const setting of settings) patch[setting] = true;
      if (fields.length || settings.length) updateBacklogView(patch);
      if (searchHides) updateBacklogSearch({ open: false, query: "" });
    },
  });
}
