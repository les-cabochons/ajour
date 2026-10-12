import type { BacklogItemActionId } from "@/domain/actions/object-actions";
import { getDirectChildWorkItems } from "@/domain/backlog/work-item-hierarchy";
import type { LocalWorkItem } from "@/domain/local-state";
import { settleBacklogItem } from "@/features/backlog/settle-dialog";
import { requestSnooze } from "@/features/backlog/snooze-picker";
import { getWorkItemEntryValues } from "@/features/backlog/work-item-timer-comment";
import { offerUndo } from "@/features/feedback/undo-toast";
import { openNewEntryEditor } from "@/features/time/new-entry-request";
import { localStore } from "@/lib/local-store";
import { openSourceUrl } from "@/lib/source-navigation";

/** The actions only a host with an editor can run. */
export type HostedBacklogItemActionId = Extract<
  BacklogItemActionId,
  "edit" | "add-subitem"
>;

/**
 * Runs a backlog item action the same way on every surface: the sidebar, the
 * Backlog page, the backlog item page and the command palette. Edit and Add
 * subitem need an editor, so `onHosted` runs them. Callers check that the
 * action is enabled first. `askToSettle`, from Shift+E or Shift-click, opens
 * the settle dialog even when a settle rule applies a fixed change.
 */
export function runBacklogItemAction(
  workItem: LocalWorkItem,
  actionId: BacklogItemActionId,
  onHosted: (actionId: HostedBacklogItemActionId) => void,
  { askToSettle = false }: { askToSettle?: boolean } = {},
) {
  switch (actionId) {
    case "start-entry":
      // Today, saving any running entry first.
      localStore.startTimer({
        ...getWorkItemEntryValues(workItem),
        accumulatedDurationMs: 0,
      });
      return;
    case "new-entry":
      openNewEntryEditor(
        { kind: "backlog-item", workItemId: workItem._id },
        getWorkItemEntryValues(workItem),
      );
      return;
    case "edit":
    case "add-subitem":
      onHosted(actionId);
      return;
    case "snooze":
      requestSnooze(workItem._id);
      return;
    case "unsnooze":
      localStore.unsnoozeWorkItem(workItem._id);
      return;
    case "settle":
      settleBacklogItem(workItem, { ask: askToSettle });
      return;
    case "unsettle":
      localStore.unsettleWorkItem(workItem._id);
      return;
    case "restore":
      localStore.restoreWorkItem(workItem._id);
      return;
    case "open-in-source":
      if (workItem.sourceUrl) {
        openSourceUrl(workItem.sourceUrl);
      }
      return;
    case "archive":
      offerUndo(localStore.archiveWorkItem(workItem._id), {
        title: "Backlog item archived",
        subject: "backlog item",
      });
      return;
    case "delete": {
      const subitemCount = getDirectChildWorkItems(
        workItem,
        localStore.snapshot().workItems,
      ).length;
      offerUndo(localStore.deleteWorkItem(workItem._id), {
        title:
          subitemCount > 0
            ? `Backlog item and ${subitemCount} ${subitemCount === 1 ? "subitem" : "subitems"} deleted`
            : "Backlog item deleted",
        subject: "backlog item",
      });
      return;
    }
  }
}
