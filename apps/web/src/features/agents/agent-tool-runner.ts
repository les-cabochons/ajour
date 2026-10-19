import { ZodError } from "zod";
import {
  readToolInputSchemas,
  type BridgeToolCall,
  type BridgeToolResult,
  type DataToolOutput,
  type ReadToolName,
} from "@ajour/shared/agent-tools";
import {
  getWeekChangesForAgent,
  getWorkItemForAgent,
  listProjectsForAgent,
  listTimeEntriesForAgent,
  listWorkItemsForAgent,
  readRunningTimer,
} from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import {
  listCommentsForAgent,
  postCommentForAgent,
} from "@/features/agents/agent-comment-tools";
import {
  ENTRY_WRITE_TOOLS,
  runEntryWriteTool,
  type AgentWriteOutcome,
  type EntryWriteTool,
} from "@/features/agents/agent-write-tools";
import {
  WORK_ITEM_WRITE_TOOLS,
  runWorkItemWriteTool,
  type WorkItemWriteTool,
} from "@/features/agents/agent-work-item-tools";
import { listProjectPropertyPlugins } from "@/lib/plugin-project-properties";
import {
  releaseSettleComment,
  sendPendingSourceWrites,
} from "@/features/backlog/backlog-source-writes";
import { offerUndo } from "@/features/feedback/undo-toast";
import { getUncheckedChangeIds } from "@/lib/commit-selection";
import { localStore } from "@/lib/local-store";
import { getIsoWeekDates } from "@/lib/utils";

/**
 * Runs the data tools an agent calls through the local API's bridge. Inputs
 * are validated again here: the renderer does not trust the API's parsing.
 * A refusal returns a sentence the agent can act on. Anything else throws,
 * and the bridge reports it as a failure.
 */

function isReadTool(tool: string): tool is ReadToolName {
  return Object.hasOwn(readToolInputSchemas, tool);
}

function formatZodError(error: ZodError) {
  return error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    )
    .join(" ");
}

/** Each read tool, typed against its output schema. */
const readTools: {
  [Name in ReadToolName]: (
    rawInput: unknown,
  ) => DataToolOutput<Name> | Promise<DataToolOutput<Name>>;
} = {
  get_running_timer: () => ({
    running: readRunningTimer(localStore.snapshot(), Date.now()),
  }),
  list_time_entries: (rawInput) =>
    listTimeEntriesForAgent(
      localStore.snapshot(),
      readToolInputSchemas.list_time_entries.parse(rawInput),
      Date.now(),
    ),
  list_projects: () => listProjectsForAgent(localStore.snapshot()),
  list_work_items: (rawInput) =>
    listWorkItemsForAgent(
      localStore.snapshot(),
      readToolInputSchemas.list_work_items.parse(rawInput),
      Date.now(),
    ),
  get_work_item: (rawInput) =>
    getWorkItemForAgent(
      localStore.snapshot(),
      readToolInputSchemas.get_work_item.parse(rawInput).workItemId,
      Date.now(),
    ),
  list_work_item_comments: listCommentsForAgent,
  get_week_changes: async (rawInput) => {
    const input = readToolInputSchemas.get_week_changes.parse(rawInput);
    // Project properties are optional context; without them the changes still go out.
    const projectPropertyPlugins = await listProjectPropertyPlugins().catch(
      (error: unknown) => {
        console.warn(
          "Plugin project properties unavailable for get_week_changes.",
          error,
        );
        return [];
      },
    );
    const weekDates = getIsoWeekDates(input.weekOf);
    return getWeekChangesForAgent(localStore.snapshot(), {
      weekDates,
      onlyChecked: input.onlyChecked,
      uncheckedIds: getUncheckedChangeIds(weekDates[0]!),
      projectPropertyPlugins,
    });
  },
};

function isEntryWriteTool(tool: string): tool is EntryWriteTool {
  return (ENTRY_WRITE_TOOLS as readonly string[]).includes(tool);
}

function isWorkItemWriteTool(tool: string): tool is WorkItemWriteTool {
  return (WORK_ITEM_WRITE_TOOLS as readonly string[]).includes(tool);
}

/** Shows the Undo toast with the client's name and builds the result. */
function finishWrite(
  call: BridgeToolCall,
  outcome: AgentWriteOutcome,
): BridgeToolResult {
  const sourceWriteIds = outcome.sourceWriteIds ?? [];
  const settleComments = outcome.settleComments ?? [];
  offerUndo(outcome.undoToken, {
    title: `${call.client.name}: ${outcome.action}`,
    subject: outcome.undoSubject,
    onWindowClosed:
      sourceWriteIds.length > 0 || settleComments.length > 0
        ? () => {
            void sendPendingSourceWrites(sourceWriteIds);
            // Each waits for its item's write above when there is one.
            for (const { commentId, workItemId } of settleComments) {
              void releaseSettleComment(commentId, workItemId);
            }
          }
        : undefined,
  });
  return {
    requestId: call.requestId,
    ok: true,
    output: outcome.output,
    activity: {
      action: outcome.action,
      objectId: outcome.objectId,
      objectTitle: outcome.objectTitle,
    },
  };
}

export async function runAgentToolCall(
  call: BridgeToolCall,
): Promise<BridgeToolResult> {
  const refuse = (error: string): BridgeToolResult => ({
    requestId: call.requestId,
    ok: false,
    error,
  });

  try {
    if (isReadTool(call.tool)) {
      return {
        requestId: call.requestId,
        ok: true,
        output: await readTools[call.tool](call.input),
      };
    }
    if (isEntryWriteTool(call.tool)) {
      return finishWrite(call, runEntryWriteTool(call.tool, call.input));
    }
    if (isWorkItemWriteTool(call.tool)) {
      return finishWrite(
        call,
        await runWorkItemWriteTool(call.tool, call.input),
      );
    }
    if (call.tool === "post_work_item_comment") {
      return await postCommentForAgent(call);
    }
    return refuse(`Ajour has no tool named ${call.tool}.`);
  } catch (error) {
    if (error instanceof AgentToolRefusal) return refuse(error.message);
    if (error instanceof ZodError) return refuse(formatZodError(error));
    throw error;
  }
}
