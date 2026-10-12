import { getOpenSubitems } from "@/domain/backlog/backlog-item-lifecycle";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  requestCloseSubitemsChoice,
  type CloseSubitemsVerb,
} from "@/features/backlog/close-subitems-dialog";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";

/**
 * Whether closing or settling this item takes its open subitems along, from
 * the user's setting or, when it says Ask, the dialog. Null means the user
 * cancelled.
 */
export async function resolveIncludeSubitems(
  workItem: LocalWorkItem,
  verb: CloseSubitemsVerb,
): Promise<boolean | null> {
  const state = localStore.snapshot();
  const subitems = getOpenSubitems(state, workItem._id, verb);
  if (subitems.length === 0) return false;

  switch (state.userPreferences.closeParentSubitems) {
    case "include":
      return true;
    case "leave":
      return false;
    default:
      return requestCloseSubitemsChoice(workItem, subitems, verb);
  }
}

/**
 * Moves a backlog item to a workflow state from any surface, with Undo in a
 * toast. A done state closes the item, asking about its open subitems first,
 * and leaving one reopens it.
 */
export async function moveBacklogItemWithUndo(
  workItem: LocalWorkItem,
  workflowStateId: string | undefined,
) {
  const state = localStore.snapshot();
  workItem =
    state.workItems.find((item) => item._id === workItem._id) ?? workItem;
  const destination = state.workflowStates.find(
    (state) => state._id === workflowStateId,
  );
  if (workflowStateId !== undefined && !destination) return false;
  if (workItem.workflowStateId === workflowStateId) return true;

  const closes = destination?.done === true && workItem.status !== "archived";
  const includeSubitems = closes
    ? await resolveIncludeSubitems(workItem, "close")
    : false;
  if (includeSubitems === null) return false;

  const reopens = !destination?.done && workItem.status === "archived";
  const name = destination?.name ?? "No state";
  offerUndo(
    localStore.moveWorkItemToState(workItem._id, workflowStateId, {
      includeSubitems,
    }),
    {
      title: closes
        ? `Closed in ${name}`
        : reopens
          ? `Reopened in ${name}`
          : `Moved to ${name}`,
      subject: "backlog item",
    },
  );
  return true;
}
