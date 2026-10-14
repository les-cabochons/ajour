import { ZodError } from "zod";
import {
  readToolInputSchemas,
  type BridgeToolCall,
  type BridgeToolResult,
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

function runReadTool(tool: ReadToolName, rawInput: unknown): unknown {
  const state = localStore.snapshot();
  const now = Date.now();
  switch (tool) {
    case "get_running_timer":
      return readRunningTimer(state, now);
    case "list_time_entries":
      return listTimeEntriesForAgent(
        state,
        readToolInputSchemas.list_time_entries.parse(rawInput),
        now,
      );
    case "list_projects":
      return listProjectsForAgent(state);
    case "list_work_items":
      return listWorkItemsForAgent(
        state,
        readToolInputSchemas.list_work_items.parse(rawInput),
        now,
      );
    case "get_work_item":
      return getWorkItemForAgent(
        state,
        readToolInputSchemas.get_work_item.parse(rawInput).workItemId,
        now,
      );
    case "get_submit_lines": {
      const input = readToolInputSchemas.get_submit_lines.parse(rawInput);
      return getSubmitLinesForAgent(state, {
        weekDates: getIsoWeekDates(input.weekOf),
        groupBy: input.groupBy,
        onlyUnsubmitted: input.onlyUnsubmitted,
      });
    }
  }
}

export function runAgentToolCall(call: BridgeToolCall): BridgeToolResult {
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
        output: runReadTool(call.tool, call.input),
      };
    }
    return refuse(`Ajour has no tool named ${call.tool}.`);
  } catch (error) {
    if (error instanceof AgentToolRefusal) return refuse(error.message);
    if (error instanceof ZodError) return refuse(formatZodError(error));
    throw error;
  }
}
