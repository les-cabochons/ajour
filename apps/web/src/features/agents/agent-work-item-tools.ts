import {
  writeToolInputSchemas,
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
import { getOpenSubitems } from "@/domain/backlog/backlog-item-lifecycle";
import type { WorkItemPatch } from "@/domain/backlog/work-item-transitions";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import { canWriteToSource } from "@/features/backlog/backlog-source-writes";
import {
  assertAllowed,
  backlogActionOptions,
  requireProjectTask,
  type AgentWriteOutcome,
} from "@/features/agents/agent-write-tools";
import { localStore } from "@/lib/local-store";

/**
 * Backlog item tools. Like the UI, they check the item's action set. In v1
 * they leave synced items that write their state to the source to the user,
 * because those moves can open a source state dialog.
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

function refuseSourceWrites(item: LocalWorkItem) {
  if (canWriteToSource(item)) {
    throw new AgentToolRefusal(
      "This item writes its state to its source, which can need a choice in Ajour. Ask the user to do it.",
    );
  }
}

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
function resolveIncludeSubitems(
  state: LocalAppState,
  item: LocalWorkItem,
  verb: "settle" | "close",
  requested: boolean | undefined,
) {
  const open = getOpenSubitems(state, item._id, verb);
  if (open.length === 0) return false;
  if (requested !== undefined) return requested;
  switch (state.userPreferences.closeParentSubitems) {
    case "include":
      return true;
    case "leave":
      return false;
    default:
      throw new AgentToolRefusal(
        `This item has ${open.length} open ${open.length === 1 ? "subitem" : "subitems"}. Call again with includeSubitems true or false.`,
      );
  }
}

/** Reads the item back after the write, so the agent sees its new state. */
function outcome(
  workItemId: string,
  undoToken: string | null,
  action: string,
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
  };
}

export function runWorkItemWriteTool(
  tool: WorkItemWriteTool,
  rawInput: unknown,
): AgentWriteOutcome {
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
          note: input.note,
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
      if (input.note !== undefined) patch.note = input.note;
      if (input.priority !== undefined) {
        patch.priority = input.priority ?? undefined;
      }
      if (input.remainingEstimateHours !== undefined) {
        patch.remainingEstimateHours =
          input.remainingEstimateHours ?? undefined;
      }
      if (input.projectId !== undefined || input.taskId !== undefined) {
        // A new project drops the old task, which belongs to the old project.
        const projectId =
          input.projectId === undefined
            ? item.projectId
            : (input.projectId ?? undefined);
        const taskId =
          input.taskId !== undefined
            ? (input.taskId ?? undefined)
            : input.projectId !== undefined
              ? undefined
              : item.taskId;
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
      refuseSourceWrites(item);
      const closes = destination.done === true && item.status !== "archived";
      const includeSubitems = closes
        ? resolveIncludeSubitems(state, item, "close", input.includeSubitems)
        : false;
      const undoToken = localStore.moveWorkItemToState(
        item._id,
        destination._id,
        { includeSubitems },
      );
      const reopens = !destination.done && item.status === "archived";
      return outcome(
        item._id,
        undoToken,
        closes
          ? `Closed in ${destination.name}`
          : reopens
            ? `Reopened in ${destination.name}`
            : `Moved to ${destination.name}`,
      );
    }

    case "settle_work_item": {
      const input = writeToolInputSchemas.settle_work_item.parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      assertAllowed(actionsFor(item), "settle");
      refuseSourceWrites(item);
      const includeSubitems = resolveIncludeSubitems(
        state,
        item,
        "settle",
        input.includeSubitems,
      );
      const undoToken = localStore.settleWorkItem(item._id, undefined, {
        includeSubitems,
      });
      return outcome(item._id, undoToken, "Settled a backlog item");
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
