import { getOpenSubitems } from "@/domain/backlog/backlog-item-lifecycle";
import { showErrorToast } from "@/components/ui/toast";
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
import { listBacklogSettleStates } from "@/lib/app-api";

function readUnchangedItem(expected: LocalWorkItem) {
  const current = localStore
    .snapshot()
    .workItems.find((item) => item._id === expected._id);
  const fields = [
    "workflowStateId",
    "workflowStateIdBeforeClose",
    "status",
    "settledAt",
    "archivedAt",
    "settledWithParentId",
    "snoozedUntil",
    "source",
    "sourceId",
    "sourceConnectionId",
    "sourceProjectName",
    "sourceStatusKey",
    "sourceStatusLabel",
    "parentWorkItemId",
    "parentSourceId",
  ] as const;
  return current && fields.every((field) => current[field] === expected[field])
    ? current
    : undefined;
}

/** The plugin couldn't list an item's source states. */
export class SourceStatesLoadError extends Error {}

async function loadSourceStates(workItem: LocalWorkItem): Promise<string[]> {
  try {
    const result = await listBacklogSettleStates(
      workItem.source,
      workItem.sourceConnectionId!,
      workItem.sourceId!,
    );
    return result.states.map((state) => state.name);
  } catch (error) {
    throw new SourceStatesLoadError(
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

function showSourceStatesError(error: SourceStatesLoadError) {
  showErrorToast({
    title: "Couldn't load the item's source states",
    description: error.message,
  });
}

/**
 * Answers whether open subitems go along when the user's setting says Ask.
 * Null cancels.
 */
export type AskAboutSubitems = (
  workItem: LocalWorkItem,
  subitems: LocalWorkItem[],
  verb: CloseSubitemsVerb,
) => Promise<boolean | null>;

/** The close subitems dialog. Null when the subitems changed meanwhile. */
const askUserAboutSubitems: AskAboutSubitems = async (
  workItem,
  subitems,
  verb,
) => {
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
};

/**
 * Whether closing or settling this item takes its open subitems along, from
 * the user's setting or, when it says Ask, from `ask`: the dialog unless the
 * caller answers another way. Null means cancelled.
 */
export async function resolveIncludeSubitems(
  workItem: LocalWorkItem,
  verb: CloseSubitemsVerb,
  ask: AskAboutSubitems = askUserAboutSubitems,
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
      return ask(workItem, subitems, verb);
  }
}

/** A move's source write that the item's write rule leaves to a person. */
export interface SourceStateRequest {
  workItem: LocalWorkItem;
  workflowStateName: string;
  sourceStatusLabels: string[];
}

/** How a move gets the answers the UI asks for in dialogs. */
export interface BacklogMoveChoices {
  /** Whether a close takes the open subitems along. Null cancels. */
  includeSubitems: (workItem: LocalWorkItem) => Promise<boolean | null>;
  /** Picks the moved item's source state. "" writes nothing, null cancels. */
  chooseSourceState: (request: SourceStateRequest) => Promise<string | null>;
}

const askUserForSourceState: BacklogMoveChoices["chooseSourceState"] = ({
  workItem,
  workflowStateName,
  sourceStatusLabels,
}) =>
  requestSourceStateChoice({
    workItem,
    title: `Which source state for ${workflowStateName}?`,
    description: `${workflowStateName} stands for more than one state in the source. It is written when the Undo toast closes.`,
    sourceStatusLabels,
    allowNoWrite: true,
  });

/**
 * The source state a move writes for one item, from its source project's
 * write rule. Ask goes to `choose` when given, and takes the first source
 * state otherwise. "" writes nothing; null cancels the move.
 */
async function resolveSourceWrite(
  workItem: LocalWorkItem,
  workflowStateId: string,
  workflowStateName: string,
  choose: BacklogMoveChoices["chooseSourceState"] | undefined,
): Promise<string | null> {
  if (!canWriteToSource(workItem)) return "";
  const state = localStore.snapshot();
  const mapped = getSourceStatesMappedTo(
    state.workflowStateMappings,
    {
      source: workItem.source,
      connectionId: workItem.sourceConnectionId,
      sourceProjectName: workItem.sourceProjectName,
    },
    workflowStateId,
  );
  if (
    planWorkflowStateWrite(
      state,
      workItem,
      workflowStateId,
      mapped.map((candidate) => candidate.label),
    ).kind === "none"
  )
    return "";
  const available = await loadSourceStates(workItem);
  if (!readUnchangedItem(workItem)) return null;
  const plan = planWorkflowStateWrite(
    localStore.snapshot(),
    workItem,
    workflowStateId,
    available,
  );
  switch (plan.kind) {
    case "none":
      return "";
    case "write":
      return plan.sourceStatusLabel;
    case "ask":
      return choose
        ? choose({
            workItem,
            workflowStateName,
            sourceStatusLabels: plan.sourceStatusLabels,
          })
        : (plan.sourceStatusLabels[0] ?? "");
  }
}

/**
 * What a move did. `unchanged` means the item was already in that state, so
 * only the patch was saved. `cancelled` means a choice was cancelled or the
 * item changed while the move waited.
 */
export type BacklogMoveResult =
  | { kind: "cancelled" }
  | { kind: "unchanged" }
  | {
      kind: "moved";
      undoToken: string | null;
      /** "Closed in Done", "Reopened in Doing" or "Moved to Review". */
      title: string;
      /** Items with a source write to send when the Undo window closes. */
      sourceWriteIds: string[];
    };

/**
 * Moves a backlog item to a workflow state. A done state closes the item,
 * with its open subitems when `choices` says so, and leaving one reopens it.
 * Synced items get a pending write of their new source state, as their
 * source project's write rule says; subitems take the rule's first state.
 * Throws SourceStatesLoadError when the plugin can't list the states.
 */
export async function moveBacklogItem(
  workItem: LocalWorkItem,
  workflowStateId: string | undefined,
  choices: BacklogMoveChoices,
  {
    patch,
    orderedIds,
  }: {
    patch?: Omit<WorkItemPatch, "workflowStateId">;
    orderedIds?: string[];
  } = {},
): Promise<BacklogMoveResult> {
  const cancelled = { kind: "cancelled" } as const;
  const state = localStore.snapshot();
  workItem =
    state.workItems.find((item) => item._id === workItem._id) ?? workItem;
  const destination = state.workflowStates.find(
    (state) => state._id === workflowStateId,
  );
  if (workflowStateId !== undefined && !destination) return cancelled;
  if (workItem.workflowStateId === workflowStateId) {
    if (patch) localStore.updateWorkItem(workItem._id, patch);
    return { kind: "unchanged" };
  }
  const name = destination?.name ?? "No state";
  const stillCurrent = () => {
    const current = readUnchangedItem(workItem);
    const nextDestination = localStore
      .snapshot()
      .workflowStates.find((item) => item._id === workflowStateId);
    return (
      current &&
      (workflowStateId === undefined || nextDestination) &&
      nextDestination?.done === destination?.done
    );
  };

  const closes = destination?.done === true && workItem.status !== "archived";
  const includeSubitems = closes
    ? await choices.includeSubitems(workItem)
    : false;
  if (includeSubitems === null) return cancelled;
  if (!stillCurrent()) return cancelled;
  const subitems = includeSubitems
    ? getOpenSubitems(localStore.snapshot(), workItem._id, "close")
    : [];
  const readyToCommit = () => {
    if (!stillCurrent()) return false;
    const currentChildren = includeSubitems
      ? getOpenSubitems(localStore.snapshot(), workItem._id, "close")
      : [];
    return (
      currentChildren.length === subitems.length &&
      subitems.every(
        (item) =>
          readUnchangedItem(item) &&
          currentChildren.some((child) => child._id === item._id),
      )
    );
  };

  const sourceWrites: Record<string, string> = {};
  const itemWrite =
    workflowStateId === undefined
      ? ""
      : await resolveSourceWrite(
          workItem,
          workflowStateId,
          name,
          choices.chooseSourceState,
        );
  if (itemWrite === null) return cancelled;
  if (!readyToCommit()) return cancelled;
  if (itemWrite) sourceWrites[workItem._id] = itemWrite;
  if (includeSubitems && workflowStateId !== undefined) {
    for (const subitem of subitems) {
      const write = await resolveSourceWrite(
        subitem,
        workflowStateId,
        name,
        undefined,
      );
      if (write === null) return cancelled;
      if (!readyToCommit()) return cancelled;
      if (write) sourceWrites[subitem._id] = write;
    }
  }

  const reopens = !destination?.done && workItem.status === "archived";
  const current = localStore.snapshot();
  for (const [itemId, label] of Object.entries(sourceWrites)) {
    const item = current.workItems.find((item) => item._id === itemId);
    if (
      !item ||
      !canWriteToSource(item) ||
      !getSourceStatesMappedTo(
        current.workflowStateMappings,
        {
          source: item.source,
          connectionId: item.sourceConnectionId,
          sourceProjectName: item.sourceProjectName,
        },
        workflowStateId!,
      ).some((state) => state.label === label)
    )
      return cancelled;
  }
  // Save the editor's other fields only after every move prompt succeeds.
  if (patch) localStore.updateWorkItem(workItem._id, patch);
  return {
    kind: "moved",
    undoToken: localStore.moveWorkItemToState(workItem._id, workflowStateId, {
      includeSubitems,
      sourceWrites,
      orderedIds,
    }),
    title: closes
      ? `Closed in ${name}`
      : reopens
        ? `Reopened in ${name}`
        : `Moved to ${name}`,
    sourceWriteIds: Object.keys(sourceWrites),
  };
}

/**
 * Moves a backlog item to a workflow state from any surface, with Undo in a
 * toast. The dialogs answer the choices. Synced items write their new source
 * state when the toast closes.
 */
export async function moveBacklogItemWithUndo(
  workItem: LocalWorkItem,
  workflowStateId: string | undefined,
  options: {
    patch?: Omit<WorkItemPatch, "workflowStateId">;
    orderedIds?: string[];
  } = {},
) {
  let result: BacklogMoveResult;
  try {
    result = await moveBacklogItem(
      workItem,
      workflowStateId,
      {
        includeSubitems: (item) => resolveIncludeSubitems(item, "close"),
        chooseSourceState: askUserForSourceState,
      },
      options,
    );
  } catch (error) {
    if (!(error instanceof SourceStatesLoadError)) throw error;
    showSourceStatesError(error);
    return false;
  }
  if (result.kind === "cancelled") return false;
  if (result.kind === "unchanged") return true;
  const { sourceWriteIds } = result;
  offerUndo(result.undoToken, {
    title: result.title,
    subject: "backlog item",
    onWindowClosed:
      sourceWriteIds.length > 0
        ? () => void sendPendingSourceWrites(sourceWriteIds)
        : undefined,
  });
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
  if (!canWriteToSource(workItem)) return;
  const currentItem = () => {
    const current = readUnchangedItem(workItem);
    return current && canWriteToSource(current) ? current : undefined;
  };
  if (!currentItem()) return;
  let available: string[];
  try {
    available = await loadSourceStates(workItem);
  } catch (error) {
    if (!(error instanceof SourceStatesLoadError)) throw error;
    showSourceStatesError(error);
    return;
  }
  const current = currentItem();
  if (!current) return;
  const options = getOtherSourceStates(current).filter((label) =>
    available.some(
      (candidate) =>
        candidate.trim().toLowerCase() === label.trim().toLowerCase(),
    ),
  );
  if (options.length === 0) return;
  const workflowStateName = localStore
    .snapshot()
    .workflowStates.find(
      (state) => state._id === workItem.workflowStateId,
    )?.name;

  const label = await requestSourceStateChoice({
    workItem: current,
    title: "Change source state",
    description: `The item stays in ${workflowStateName ?? "its state"}. The new state is written when the Undo toast closes.`,
    sourceStatusLabels: options,
    allowNoWrite: false,
  });
  if (!label) return;
  const selected = currentItem();
  if (!selected || !getOtherSourceStates(selected).includes(label)) return;

  offerUndo(localStore.changeWorkItemSourceState(workItem._id, label), {
    title: `Source state set to ${label}`,
    subject: "backlog item",
    onWindowClosed: () => void sendPendingSourceWrites([workItem._id]),
  });
}
