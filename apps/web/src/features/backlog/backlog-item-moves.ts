import { getOpenSubitems } from "@/domain/backlog/backlog-item-lifecycle";
import {
  getSourceStatesMappedTo,
  planWorkflowStateWrite,
} from "@/domain/backlog/workflow-states";
import type { LocalWorkItem } from "@/domain/local-state";
import type { WorkItemPatch } from "@/domain/backlog/work-item-transitions";
import {
  canWriteToSource,
  sendPendingSourceWrites,
} from "@/features/backlog/backlog-source-writes";
import {
  requestCloseSubitemsChoice,
  type CloseSubitemsVerb,
} from "@/features/backlog/close-subitems-dialog";
import { requestSourceStateChoice } from "@/features/backlog/source-state-dialog";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";

/**
 * Whether closing or settling this item takes its open subitems along, from
 * the user's setting or, when it says Ask, the dialog. Null means the user
 * cancelled or the displayed subitem set changed while they answered.
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
    default: {
      const answer = await requestCloseSubitemsChoice(workItem, subitems, verb);
      if (answer === null) return null;
      const currentSubitems = getOpenSubitems(
        localStore.snapshot(),
        workItem._id,
        verb,
      );
      return currentSubitems.length === subitems.length &&
        subitems.every((item) =>
          currentSubitems.some((current) => current._id === item._id),
        )
        ? answer
        : null;
    }
  }
}

/**
 * The source state a move writes for one item, from its source project's
 * write rule. Ask opens the source state dialog when `ask` is set, and takes
 * the first source state otherwise. "" writes nothing; null cancels the move.
 */
async function resolveSourceWrite(
  workItem: LocalWorkItem,
  workflowStateId: string,
  workflowStateName: string,
  ask: boolean,
): Promise<string | null> {
  if (!canWriteToSource(workItem)) return "";
  const plan = planWorkflowStateWrite(
    localStore.snapshot(),
    workItem,
    workflowStateId,
  );
  switch (plan.kind) {
    case "none":
      return "";
    case "write":
      return plan.sourceStatusLabel;
    case "ask":
      return ask
        ? requestSourceStateChoice({
            workItem,
            title: `Which source state for ${workflowStateName}?`,
            description: `${workflowStateName} stands for more than one state in the source. It is written when the Undo toast closes.`,
            sourceStatusLabels: plan.sourceStatusLabels,
            allowNoWrite: true,
          })
        : (plan.sourceStatusLabels[0] ?? "");
  }
}

/**
 * Moves a backlog item to a workflow state from any surface, with Undo in a
 * toast. A done state closes the item, asking about its open subitems first,
 * and leaving one reopens it. Synced items write their new source state when
 * the toast closes, as their source project's write rule says.
 */
export async function moveBacklogItemWithUndo(
  workItem: LocalWorkItem,
  workflowStateId: string | undefined,
  { patch }: { patch?: Omit<WorkItemPatch, "workflowStateId"> } = {},
) {
  const state = localStore.snapshot();
  workItem =
    state.workItems.find((item) => item._id === workItem._id) ?? workItem;
  const destination = state.workflowStates.find(
    (state) => state._id === workflowStateId,
  );
  if (workflowStateId !== undefined && !destination) return false;
  if (workItem.workflowStateId === workflowStateId) {
    if (patch) localStore.updateWorkItem(workItem._id, patch);
    return true;
  }
  const name = destination?.name ?? "No state";

  const closes = destination?.done === true && workItem.status !== "archived";
  const includeSubitems = closes
    ? await resolveIncludeSubitems(workItem, "close")
    : false;
  if (includeSubitems === null) return false;

  const sourceWrites: Record<string, string> = {};
  const itemWrite = workflowStateId === undefined ? "" : await resolveSourceWrite(
    workItem,
    workflowStateId,
    name,
    true,
  );
  if (itemWrite === null) return false;
  if (itemWrite) sourceWrites[workItem._id] = itemWrite;
  if (includeSubitems && workflowStateId !== undefined) {
    for (const subitem of getOpenSubitems(state, workItem._id, "close")) {
      const write = await resolveSourceWrite(
        subitem,
        workflowStateId,
        name,
        false,
      );
      if (write) sourceWrites[subitem._id] = write;
    }
  }

  const reopens = !destination?.done && workItem.status === "archived";
  // Save the editor's other fields only after every move prompt succeeds.
  if (patch) localStore.updateWorkItem(workItem._id, patch);
  const writtenIds = Object.keys(sourceWrites);
  offerUndo(
    localStore.moveWorkItemToState(workItem._id, workflowStateId, {
      includeSubitems,
      sourceWrites,
    }),
    {
      title: closes
        ? `Closed in ${name}`
        : reopens
          ? `Reopened in ${name}`
          : `Moved to ${name}`,
      subject: "backlog item",
      onWindowClosed:
        writtenIds.length > 0
          ? () => void sendPendingSourceWrites(writtenIds)
          : undefined,
    },
  );
  return true;
}

/**
 * The other source states of the item's workflow state, which Change source
 * state… offers. Empty when the item can't write to its source.
 */
export function getOtherSourceStates(workItem: LocalWorkItem): string[] {
  if (!workItem.workflowStateId || !canWriteToSource(workItem)) return [];
  return getSourceStatesMappedTo(
    localStore.snapshot().workflowStateMappings,
    {
      source: workItem.source,
      connectionId: workItem.sourceConnectionId,
      sourceProjectName: workItem.sourceProjectName,
    },
    workItem.workflowStateId,
  )
    .map((sourceState) => sourceState.label)
    .filter(
      (label) =>
        label.toLowerCase() !== workItem.sourceStatusLabel?.toLowerCase(),
    );
}

/** Change source state…: picks another source state of the same workflow state. */
export async function changeSourceStateWithUndo(workItem: LocalWorkItem) {
  const options = getOtherSourceStates(workItem);
  if (options.length === 0) return;
  const workflowStateName = localStore
    .snapshot()
    .workflowStates.find(
      (state) => state._id === workItem.workflowStateId,
    )?.name;

  const label = await requestSourceStateChoice({
    workItem,
    title: "Change source state",
    description: `The item stays in ${workflowStateName ?? "its state"}. The new state is written when the Undo toast closes.`,
    sourceStatusLabels: options,
    allowNoWrite: false,
  });
  if (!label) return;

  offerUndo(localStore.changeWorkItemSourceState(workItem._id, label), {
    title: `Source state set to ${label}`,
    subject: "backlog item",
    onWindowClosed: () => void sendPendingSourceWrites([workItem._id]),
  });
}
