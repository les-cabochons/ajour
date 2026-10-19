import {
  writeToolInputSchemas,
  type AgentClientRef,
  type WriteToolName,
} from "@ajour/shared/agent-tools";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import {
  findWorkItemOrRefuse,
  toAgentWorkItem,
} from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import {
  settleMarkOf,
  type BacklogSettleChange,
} from "@/domain/backlog/backlog-item-lifecycle";
import type { WorkItemPatch } from "@/domain/backlog/work-item-transitions";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  moveBacklogItem,
  resolveIncludeSubitems,
  SourceStatesLoadError,
  type SourceStateRequest,
} from "@/features/backlog/backlog-item-moves";
import type { CloseSubitemsVerb } from "@/features/backlog/close-subitems-dialog";
import { getSettleBehavior } from "@/features/backlog/settle-dialog";
import { findSettleState } from "@/features/backlog/settle-draft";
import {
  assertCommentFits,
  requireAgentCommentAccess,
} from "@/features/agents/agent-comment-tools";
import {
  assertAllowed,
  backlogActionOptions,
  nextTaskId,
  requireProjectTask,
  type AgentWriteOutcome,
} from "@/features/agents/agent-write-tools";
import { listBacklogSettleStates } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { queueSettleComment } from "@/lib/settle-comments";

/**
 * Backlog item tools. Like the UI, they check the item's action set, and
 * moves and settles go through the UI's own move and settle rules. Where the
 * UI opens a dialog, the agent's input answers it, or the tool refuses with
 * the options so the agent can call again.
 */

export const WORK_ITEM_WRITE_TOOLS = [
  "create_work_item",
  "edit_work_item",
  "move_work_item",
  "settle_work_item",
  "unsettle_work_item",
  "snooze_work_item",
  "unsnooze_work_item",
  "archive_work_item",
  "restore_work_item",
] as const satisfies readonly WriteToolName[];
export type WorkItemWriteTool = (typeof WORK_ITEM_WRITE_TOOLS)[number];

function requireWorkflowState(state: LocalAppState, workflowStateId: string) {
  const workflowState = state.workflowStates.find(
    (candidate) => candidate._id === workflowStateId,
  );
  if (!workflowState) {
    throw new AgentToolRefusal(
      `No workflow state has the id ${workflowStateId}.`,
    );
  }
  return workflowState;
}

/**
 * Whether a close or settle takes the item's open subitems along: the
 * agent's answer, else the user's setting. Refuses when the setting says Ask.
 */
async function resolveAgentIncludeSubitems(
  item: LocalWorkItem,
  verb: CloseSubitemsVerb,
  requested: boolean | undefined,
) {
  if (requested !== undefined) return requested;
  const include = await resolveIncludeSubitems(
    item,
    verb,
    async (_, subitems) => {
      const count = subitems.length;
      throw new AgentToolRefusal(
        `This item has ${count} open ${count === 1 ? "subitem" : "subitems"}. Call again with includeSubitems true or false.`,
      );
    },
  );
  // Only a cancelled dialog answers null, and this ask has no dialog.
  return include === true;
}

function refuseWithSourceStates(why: string, options: string[]): never {
  throw new AgentToolRefusal(
    `${why} Call again with sourceState, one of: ${options.join(", ")}.`,
  );
}

/** Answers a move's source state question with the agent's sourceState. */
const chooseMoveSourceState =
  (requested: string | undefined) =>
  async ({ workflowStateName, sourceStatusLabels }: SourceStateRequest) => {
    const key = requested?.trim().toLowerCase();
    return (
      sourceStatusLabels.find((label) => label.trim().toLowerCase() === key) ??
      refuseWithSourceStates(
        `${workflowStateName} stands for more than one state in the item's source.`,
        sourceStatusLabels,
      )
    );
  };

/**
 * The settle's change to the source, as Settle in the UI decides it: none
 * for an item that settles locally, the source project's settle rule, or the
 * agent's sourceState where the UI would open the settle dialog. A
 * sourceState also replaces the rule's state.
 */
async function resolveSettleChange(
  item: LocalWorkItem,
  requested: string | undefined,
): Promise<BacklogSettleChange | undefined> {
  const behavior = getSettleBehavior(item);
  if (behavior.kind === "local") return undefined;
  if (behavior.kind === "apply" && requested === undefined) {
    return behavior.change;
  }
  let states;
  try {
    ({ states } = await listBacklogSettleStates(
      item.source,
      item.sourceConnectionId!,
      item.sourceId!,
    ));
  } catch (error) {
    throw new AgentToolRefusal(
      `Ajour couldn't load the item's source states: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
  const found = findSettleState(states, requested);
  if (!found) {
    refuseWithSourceStates(
      requested === undefined
        ? "This item's source asks which state it settles in."
        : `${requested} is not a state of this item's source.`,
      states.map((state) => state.name),
    );
  }
  return {
    ...(behavior.kind === "apply" ? behavior.change : {}),
    state: { name: found.name, done: found.done },
  };
}

/** Reads the item back after the write, so the agent sees its new state. */
function outcome(
  workItemId: string,
  undoToken: string | null,
  action: string,
  sourceWriteIds: string[] = [],
  settleComments: AgentWriteOutcome["settleComments"] = [],
): AgentWriteOutcome {
  const after = localStore.snapshot();
  const item = findWorkItemOrRefuse(after, workItemId);
  return {
    output: toAgentWorkItem(after, item, Date.now()),
    undoToken,
    action,
    objectId: item._id,
    objectTitle: item.title,
    undoSubject: "backlog item",
    sourceWriteIds,
    settleComments,
  };
}

export async function runWorkItemWriteTool(
  tool: WorkItemWriteTool,
  rawInput: unknown,
  client: AgentClientRef,
): Promise<AgentWriteOutcome> {
  const state = localStore.snapshot();
  const now = Date.now();
  const actionsFor = (item: LocalWorkItem) =>
    getBacklogItemActions(item, backlogActionOptions(state, item, now));

  switch (tool) {
    case "create_work_item": {
      const input = writeToolInputSchemas.create_work_item.parse(rawInput);
      if (input.parentWorkItemId) {
        assertAllowed(
          actionsFor(findWorkItemOrRefuse(state, input.parentWorkItemId)),
          "add-subitem",
        );
      }
      if (input.workflowStateId) {
        const workflowState = requireWorkflowState(
          state,
          input.workflowStateId,
        );
        // An active item in a done state would contradict the lifecycle.
        if (workflowState.done) {
          throw new AgentToolRefusal(
            `${workflowState.name} is a done state. Create the item in another state, then move it.`,
          );
        }
      }
      if (input.taskId && !input.projectId) {
        throw new AgentToolRefusal("Pass a projectId with the taskId.");
      }
      if (input.projectId) {
        requireProjectTask(state, input.projectId, input.taskId);
      }
      const { result: workItemId, undoToken } = localStore.runWithUndo(() =>
        localStore.addWorkItem({
          title: input.title,
          description: input.description,
          projectId: input.projectId,
          taskId: input.taskId,
          priority: input.priority ?? undefined,
          workflowStateId: input.workflowStateId,
          parentWorkItemId: input.parentWorkItemId,
          remainingEstimateHours: input.remainingEstimateHours,
          originalEstimateHours: input.remainingEstimateHours,
        }),
      );
      return outcome(workItemId, undoToken, "Added a backlog item");
    }

    case "edit_work_item": {
      const input = writeToolInputSchemas.edit_work_item.parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      assertAllowed(actionsFor(item), "edit");

      const patch: WorkItemPatch = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) {
        patch.description = input.description;
      }
      if (input.priority !== undefined) {
        patch.priority = input.priority ?? undefined;
      }
      if (input.remainingEstimateHours !== undefined) {
        patch.remainingEstimateHours =
          input.remainingEstimateHours ?? undefined;
      }
      if (input.projectId !== undefined || input.taskId !== undefined) {
        const projectId =
          input.projectId === undefined
            ? item.projectId
            : (input.projectId ?? undefined);
        // Null clears the task.
        const taskId =
          input.taskId === null
            ? undefined
            : nextTaskId(item, projectId, input.taskId);
        if (taskId && !projectId) {
          throw new AgentToolRefusal("Pass a projectId with the taskId.");
        }
        if (projectId) requireProjectTask(state, projectId, taskId);
        patch.projectId = projectId;
        patch.taskId = taskId;
      }
      if (Object.keys(patch).length === 0) {
        throw new AgentToolRefusal("Pass at least one field to change.");
      }
      const undoToken = localStore.updateWorkItemWithUndo(item._id, patch);
      return outcome(item._id, undoToken, "Edited a backlog item");
    }

    case "move_work_item": {
      const input = writeToolInputSchemas.move_work_item.parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      const destination = requireWorkflowState(state, input.workflowStateId);
      let result;
      try {
        result = await moveBacklogItem(item, destination._id, {
          includeSubitems: (target) =>
            resolveAgentIncludeSubitems(target, "close", input.includeSubitems),
          chooseSourceState: chooseMoveSourceState(input.sourceState),
        });
      } catch (error) {
        if (!(error instanceof SourceStatesLoadError)) throw error;
        throw new AgentToolRefusal(
          `Ajour couldn't load the item's source states: ${error.message}`,
        );
      }
      switch (result.kind) {
        case "unchanged":
          throw new AgentToolRefusal(
            `The item is already in ${destination.name}.`,
          );
        case "cancelled":
          throw new AgentToolRefusal(
            "The item changed while Ajour prepared the move. Read it again with get_work_item.",
          );
        case "moved":
          return outcome(
            item._id,
            result.undoToken,
            result.title,
            result.sourceWriteIds,
          );
      }
    }

    case "settle_work_item": {
      const input = writeToolInputSchemas.settle_work_item.parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      assertAllowed(actionsFor(item), "settle");
      // Checked first, so a refused comment leaves the item as it was.
      const commentSource = input.comment
        ? await requireAgentCommentAccess(item, "readWrite")
        : undefined;
      if (commentSource && input.comment) {
        assertCommentFits(commentSource, input.comment);
      }
      const change = await resolveSettleChange(item, input.sourceState);
      const includeSubitems = await resolveAgentIncludeSubitems(
        item,
        "settle",
        input.includeSubitems,
      );
      const undoToken = localStore.settleWorkItem(item._id, change, {
        includeSubitems,
      });
      if (!undoToken) {
        throw new AgentToolRefusal(
          "The item changed while Ajour prepared the settle. Read it again with get_work_item.",
        );
      }
      const settled = findWorkItemOrRefuse(localStore.snapshot(), item._id);
      const commentId = crypto.randomUUID();
      if (commentSource && input.comment) {
        queueSettleComment({
          id: commentId,
          settleMark: settleMarkOf(settled),
          agentClient: client.name,
          itemId: item._id,
          pluginId: commentSource.pluginId,
          connectionId: commentSource.connectionId,
          sourceId: commentSource.sourceId,
          body: input.comment,
          at: Date.now(),
        });
      }
      return outcome(
        item._id,
        undoToken,
        settled.status === "archived"
          ? "Archived a backlog item"
          : "Settled a backlog item",
        // Like the UI, the settle's source write goes when the Undo toast closes.
        settled.pendingSourceWrite ? [item._id] : [],
        commentSource ? [{ commentId, workItemId: item._id }] : [],
      );
    }

    case "snooze_work_item": {
      const input = writeToolInputSchemas.snooze_work_item.parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      assertAllowed(actionsFor(item), "snooze");
      const until = Date.parse(input.until);
      if (until <= now) {
        throw new AgentToolRefusal("Pick a time in the future.");
      }
      const undoToken = localStore.snoozeWorkItem(item._id, until);
      return outcome(item._id, undoToken, "Snoozed a backlog item");
    }

    case "archive_work_item": {
      const input = writeToolInputSchemas.archive_work_item.parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      assertAllowed(actionsFor(item), "archive");
      const undoToken = localStore.archiveWorkItem(item._id);
      return outcome(item._id, undoToken, "Archived a backlog item");
    }

    case "unsettle_work_item":
    case "unsnooze_work_item":
    case "restore_work_item": {
      const input = writeToolInputSchemas[tool].parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      // These store commands keep no undo of their own.
      const reverse = {
        unsettle_work_item: {
          actionId: "unsettle",
          label: "Unsettled a backlog item",
          run: () => localStore.unsettleWorkItem(item._id),
        },
        unsnooze_work_item: {
          actionId: "unsnooze",
          label: "Ended a snooze",
          run: () => localStore.unsnoozeWorkItem(item._id),
        },
        restore_work_item: {
          actionId: "restore",
          label: "Restored a backlog item",
          run: () => localStore.restoreWorkItem(item._id),
        },
      } satisfies Record<
        typeof tool,
        { actionId: BacklogItemActionId; label: string; run: () => void }
      >;
      const { actionId, label, run } = reverse[tool];
      assertAllowed(actionsFor(item), actionId);
      const { undoToken } = localStore.runWithUndo(run);
      return outcome(item._id, undoToken, label);
    }
  }
}
