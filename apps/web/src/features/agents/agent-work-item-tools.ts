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
import type { BacklogSettleChange } from "@/domain/backlog/backlog-item-lifecycle";
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
import { fetchPluginsOverview, listBacklogSettleStates } from "@/lib/app-api";
import {
  agentAccessAllows,
  connectionAgentAccess,
  connectionAllowsLossyConversion,
} from "@ajour/shared";
import {
  descriptionAccess,
  descriptionCapabilityOf,
  descriptionLimit,
  descriptionLosses,
  hasUnwrittenDescription,
  lostFormatting,
  normalizeDescriptionText,
} from "@/domain/backlog/description-sync";
import { saveSyncedDescription } from "@/lib/description-save";
import { localStore } from "@/lib/local-store";
import { queueSettleComment } from "@/lib/settle-comments";
import { withEventAttribution } from "@/lib/wide-events";

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

/**
 * Checks an agent's change to a synced description as the user's save is
 * checked: Read and write on the connection, the read-only rule, and the
 * source's length limit. Lossy text needs the connection to allow lossy
 * conversion, which stands for the user's confirmation. Returns the text to
 * save and the losses it may write.
 *
 * The checks run on the item as it is after reading the settings. A sync or
 * an edit of the description meanwhile refuses the change: the agent's text
 * was written against the text it saw, and saving it over newer text would
 * erase that text without a merge.
 */
async function prepareAgentDescription(
  seen: LocalWorkItem,
  text: string,
): Promise<{
  description: string | undefined;
  allowedLoss: readonly string[];
}> {
  let overview;
  try {
    overview = await fetchPluginsOverview();
  } catch (error) {
    throw new AgentToolRefusal(
      `Ajour couldn't read its plugin settings: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const state = localStore.snapshot();
  const item = findWorkItemOrRefuse(state, seen._id);
  assertAllowed(
    getBacklogItemActions(item, backlogActionOptions(state, item, Date.now())),
    "edit",
  );
  if (
    item.description !== seen.description ||
    JSON.stringify(item.descriptionSync) !==
      JSON.stringify(seen.descriptionSync)
  ) {
    throw new AgentToolRefusal(
      "The description changed while Ajour checked the edit. Read the item again, then retry.",
    );
  }
  const connection = overview.connectionGroups
    .find((group) => group.plugin.id === item.source)
    ?.connections.find((candidate) => candidate.id === item.sourceConnectionId);
  const connectionName =
    connection?.label ?? item.sourceConnectionLabel ?? "item's";
  if (
    !connection ||
    !agentAccessAllows(connectionAgentAccess(connection), "readWrite")
  ) {
    throw new AgentToolRefusal(
      `The user hasn't allowed agents to change descriptions on the "${connectionName}" connection. They can set "Agent access" to "Read and write" on it in Ajour's Settings, under Plugins.`,
    );
  }
  const capability = descriptionCapabilityOf(item, overview);
  const allowLossy = connectionAllowsLossyConversion(connection);
  const access = descriptionAccess(item, capability, allowLossy);
  if (!access.editable) {
    throw new AgentToolRefusal(
      {
        archived: "The item is archived. Restore it first.",
        notWritable:
          "This description follows its source, which Ajour can't write to. Change it in the source.",
        cut: "This description is longer than Ajour keeps, so Ajour can't write it back. Change it in the source.",
        lossy: `Changing it here would lose its ${lostFormatting(descriptionLosses(item))} in the source, and the "${connectionName}" connection doesn't allow lossy conversion. Change it in the source, or ask the user to turn on "Allow lossy conversion".`,
      }[access.reason],
    );
  }
  const description = normalizeDescriptionText(text) || undefined;
  const limit = descriptionLimit(capability);
  if ((description?.length ?? 0) > limit) {
    throw new AgentToolRefusal(
      `The item's source takes descriptions of at most ${limit.toLocaleString("en-US")} characters. This one has ${description!.length.toLocaleString("en-US")}.`,
    );
  }
  return {
    description,
    allowedLoss: allowLossy ? descriptionLosses(item) : [],
  };
}

/**
 * Writes the agent's description, saved in Ajour, to the source as the user's
 * save does, and says what came of it. An unchanged text is written only when
 * the source lacks it.
 */
async function saveAgentDescription(
  itemId: string,
  allowedLoss: readonly string[],
  unchanged: boolean,
) {
  const saved = findWorkItemOrRefuse(localStore.snapshot(), itemId);
  const sourceName = saved.sourceConnectionLabel ?? "the source";
  if (unchanged && saved.descriptionSync?.conflict) {
    return {
      outcome: "conflict" as const,
      message: `The description already conflicts with a change in ${sourceName}, so nothing was written there. The user resolves the conflict in Sync review.`,
    };
  }
  if (unchanged && !hasUnwrittenDescription(saved)) {
    return { outcome: "unchanged" as const };
  }
  const result = await withEventAttribution({ trigger: "agent" }, () =>
    saveSyncedDescription(itemId, "save", allowedLoss, true),
  );
  switch (result.kind) {
    case "written":
      return result.merged
        ? {
            outcome: "merged" as const,
            message: `Merged with a change in ${sourceName}; read the item again for the text now.`,
          }
        : { outcome: "written" as const };
    case "agreed":
      return { outcome: "unchanged" as const };
    case "conflict":
      return {
        outcome: "conflict" as const,
        message: `Saved in Ajour, but a change in ${sourceName} touches the same lines, so nothing was written there. The user resolves the conflict in Sync review.`,
      };
    case "failed":
      return {
        outcome: "failed" as const,
        message: `Saved in Ajour, but not in ${sourceName}: ${result.message}`,
      };
  }
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
      // A synced description goes to its source through the user's own save,
      // checked first so a refusal changes nothing.
      const syncedDescription =
        input.description !== undefined && item.descriptionSync
          ? await prepareAgentDescription(item, input.description)
          : undefined;
      if (input.description !== undefined && !syncedDescription) {
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
      if (Object.keys(patch).length === 0 && !syncedDescription) {
        throw new AgentToolRefusal("Pass at least one field to change.");
      }
      if (!syncedDescription) {
        const undoToken = withEventAttribution({ trigger: "agent" }, () =>
          localStore.updateWorkItemWithUndo(item._id, patch),
        );
        return outcome(item._id, undoToken, "Edited a backlog item");
      }
      // The text has no Undo: like the user's, it is written at once. The
      // other fields, and what its timelog sets, share one Undo, taken after
      // the write, which would leave an earlier one stale.
      const unchanged = syncedDescription.description === item.description;
      const before = unchanged
        ? localStore.snapshot()
        : withEventAttribution({ trigger: "agent" }, () =>
            localStore.saveWorkItemDescriptionText(
              item._id,
              syncedDescription.description,
            ),
          );
      const descriptionSave = await saveAgentDescription(
        item._id,
        syncedDescription.allowedLoss,
        unchanged,
      );
      const undoToken = withEventAttribution({ trigger: "agent" }, () =>
        localStore.applyWorkItemEditsSince(item._id, patch, before),
      );
      const edited = outcome(item._id, undoToken, "Edited a backlog item");
      return { ...edited, output: { ...edited.output, descriptionSave } };
    }

    case "move_work_item": {
      const input = writeToolInputSchemas.move_work_item.parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      const destination = requireWorkflowState(state, input.workflowStateId);
      let result;
      try {
        result = await withEventAttribution({ trigger: "agent" }, () =>
          moveBacklogItem(item, destination._id, {
            includeSubitems: (target) =>
              resolveAgentIncludeSubitems(
                target,
                "close",
                input.includeSubitems,
              ),
            chooseSourceState: chooseMoveSourceState(input.sourceState),
          }),
        );
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
      const undoToken = withEventAttribution({ trigger: "agent" }, () =>
        localStore.settleWorkItem(item._id, change, { includeSubitems }),
      );
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
          settleId: settled.settleId,
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
      const undoToken = withEventAttribution({ trigger: "agent" }, () =>
        localStore.snoozeWorkItem(item._id, until),
      );
      return outcome(item._id, undoToken, "Snoozed a backlog item");
    }

    case "archive_work_item": {
      const input = writeToolInputSchemas.archive_work_item.parse(rawInput);
      const item = findWorkItemOrRefuse(state, input.workItemId);
      assertAllowed(actionsFor(item), "archive");
      const undoToken = withEventAttribution({ trigger: "agent" }, () =>
        localStore.archiveWorkItem(item._id),
      );
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
