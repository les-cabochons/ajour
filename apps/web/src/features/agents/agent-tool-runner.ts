import { ZodError } from "zod";
import {
  readToolInputSchemas,
  type BridgeToolCall,
  type BridgeToolResult,
  type DataToolOutput,
  type ReadToolName,
} from "@ajour/shared/agent-tools";
import {
  getSubmitLinesForAgent,
  getWorkItemForAgent,
  listProjectsForAgent,
  listTimeEntriesForAgent,
  listWorkItemsForAgent,
  readRunningTimer,
} from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
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
import { sendPendingSourceWrites } from "@/features/backlog/backlog-source-writes";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";
import { getPaceTolerancePercent } from "@/domain/time/week-pace";
import { getIsoWeekDates, todayIsoDate } from "@/lib/utils";

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
  get_submit_lines: async (rawInput) => {
    const input = readToolInputSchemas.get_submit_lines.parse(rawInput);
    const projectPropertyPlugins = await listProjectPropertyPlugins();
    const state = localStore.snapshot();
    return getSubmitLinesForAgent(state, {
      weekDates: getIsoWeekDates(input.weekOf),
      groupBy: input.groupBy,
      onlyUnsubmitted: input.onlyUnsubmitted,
      today: todayIsoDate(),
      paceTolerancePercent: getPaceTolerancePercent(state.userPreferences),
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
  offerUndo(outcome.undoToken, {
    title: `${call.client.name}: ${outcome.action}`,
    subject: outcome.undoSubject,
    onWindowClosed:
      sourceWriteIds.length > 0
        ? () => void sendPendingSourceWrites(sourceWriteIds)
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
    return refuse(`Ajour has no tool named ${call.tool}.`);
  } catch (error) {
    if (error instanceof AgentToolRefusal) return refuse(error.message);
    if (error instanceof ZodError) return refuse(formatZodError(error));
    throw error;
  }
}
