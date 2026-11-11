import { showActionToast, UNDO_TOAST_TIMEOUT_MS } from "@/components/ui/toast";
import { getFilterFieldsHiding } from "@/domain/backlog/backlog-view";
import { createWorkItemSearch } from "@/domain/backlog/work-item-search";
import { readBacklogSearch, updateBacklogSearch } from "@/lib/backlog-search";
import {
  readBacklogView,
  updateBacklogView,
} from "@/lib/backlog-view-settings";
import { localStore } from "@/lib/local-store";

/**
 * After the Backlog page creates an item, says so when the page's filters or
 * search hide it, as the toast "“Fix login” is hidden by the filters" with
 * Show. Show removes only the filters that hide it, and the search when it
 * does, so the item comes into view. A new item takes the filters' values
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
    view,
    view.filters,
    context,
    workItemId,
  );
  const searchHides = !createWorkItemSearch(
    readBacklogSearch().query,
    state.projects,
  ).matches(workItem);
  if (fields.length === 0 && !searchHides) return;

  showActionToast({
    title: `“${workItem.title}” is hidden by the ${fields.length ? "filters" : "search"}`,
    actionLabel: "Show",
    timeout: UNDO_TOAST_TIMEOUT_MS,
    onAction: () => {
      if (fields.length) {
        updateBacklogView({
          filters: readBacklogView().filters.filter(
            (filter) => !fields.includes(filter.field),
          ),
        });
      }
      if (searchHides) updateBacklogSearch({ open: false, query: "" });
    },
  });
}
