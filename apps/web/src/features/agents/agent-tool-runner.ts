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
  getWeekStatusForAgent,
  getWorkItemForAgent,
  listProjectsForAgent,
  listTimeEntriesForAgent,
  listWorkItemsForAgent,
  readRunningTimer,
} from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import { getWeekDates } from "@/domain/time/local-date";
import { LockedWeekError } from "@/domain/time/locked-weeks";
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
import { NO_PROPERTY_PLUGINS } from "@/domain/projects/plugin-properties";
import { listPropertyPlugins } from "@/lib/plugin-project-properties";
import {
  releaseSettleComment,
  sendPendingSourceWrites,
} from "@/features/backlog/backlog-source-writes";
import { offerUndo } from "@/features/feedback/undo-toast";
import { getUncheckedChangeIds } from "@/lib/commit-selection";
import { localStore } from "@/lib/local-store";
import { StaleWindowError } from "@/lib/stale-window-error";
import { getIsoWeekDates, todayIsoDate } from "@/lib/utils";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import { reentry } from "@/lib/wide-events";

/**
 * Runs the data tools an agent calls through the local API's bridge. Inputs
 * are validated again here: the renderer does not trust the API's parsing.
 * A refusal returns a sentence the agent can act on. A write the local store
 * refuses because it would change a submitted week, or because another
 * window changed the submitted weeks, returns its reason the same way. Anything else throws, and the bridge reports it as a failure.
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

/**
 * Project and task properties are optional context; without them the tool
 * still answers. The overview call counts as failed on the tool call's event.
 */
function loadPropertyPlugins() {
  return listPropertyPlugins().catch(() => NO_PROPERTY_PLUGINS);
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
    const propertyPlugins = await loadPropertyPlugins();
    const weekDates = getIsoWeekDates(input.weekOf);
    return getWeekChangesForAgent(localStore.snapshot(), {
      weekDates,
      onlyChecked: input.onlyChecked,
      uncheckedIds: getUncheckedChangeIds(weekDates[0]!),
      propertyPlugins,
    });
  },
  get_week_status: async (rawInput) => {
    const input = readToolInputSchemas.get_week_status.parse(rawInput);
    return getWeekStatusForAgent(localStore.snapshot(), {
      weekDates: getWeekDates(input.weekOf),
      today: todayIsoDate(),
      propertyPlugins: await loadPropertyPlugins(),
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
  unit: AgentToolUnit | undefined,
): BridgeToolResult {
  const sourceWriteIds = outcome.sourceWriteIds ?? [];
  const settleComments = outcome.settleComments ?? [];
  unit?.set({ agent_tool: { undo_offered: outcome.undoToken !== null } });
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

/** The bridge's `agent_tool.call` job, which it hands the call it runs. */
type AgentToolUnit = Unit<AjourCatalog, "agent_tool.call">;

export async function runAgentToolCall(
  call: BridgeToolCall,
  unit?: AgentToolUnit,
): Promise<BridgeToolResult> {
  const refuse = (error: string): BridgeToolResult => ({
    requestId: call.requestId,
    ok: false,
    error,
  });
  // The bridge runs the call as a job: its writes after an `await` run in
  // it again, so they fold into its one event. The agent's attribution
  // covers only the synchronous work inside each `asAgent`: in a work item
  // write, only the code before its first `await`. The writes it makes after
  // an `await` are attributed by their own `reentry` in
  // agent-work-item-tools.ts, so a new write there needs one too, or it is
  // recorded as the user's.
  const asAgent = reentry({ trigger: "agent" });
  const tool = call.tool;

  try {
    if (isReadTool(tool)) {
      return {
        requestId: call.requestId,
        ok: true,
        output: await readTools[tool](call.input),
      };
    }
    if (isEntryWriteTool(tool)) {
      const propertyPlugins =
        tool === "submit_week"
          ? await loadPropertyPlugins()
          : NO_PROPERTY_PLUGINS;
      return asAgent(() =>
        finishWrite(
          call,
          runEntryWriteTool(tool, call.input, { propertyPlugins }),
          unit,
        ),
      );
    }
    if (isWorkItemWriteTool(tool)) {
      const outcome = await asAgent(() =>
        runWorkItemWriteTool(tool, call.input, call.client),
      );
      return asAgent(() => finishWrite(call, outcome, unit));
    }
    if (tool === "post_work_item_comment") {
      return await postCommentForAgent(call, unit);
    }
    return refuse(`Ajour has no tool named ${tool}.`);
  } catch (error) {
    if (error instanceof AgentToolRefusal) return refuse(error.message);
    if (error instanceof LockedWeekError) return refuse(error.message);
    if (error instanceof StaleWindowError) return refuse(error.message);
    if (error instanceof ZodError) return refuse(formatZodError(error));
    throw error;
  }
}
