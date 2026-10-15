import {
  writeToolInputSchemas,
  type WriteToolName,
} from "@ajour/shared/agent-tools";
import {
  getBacklogItemActions,
  getProjectActions,
  getTaskActions,
  getTimeEntryActions,
  getTimeEntryActionState,
  type BacklogItemActionOptions,
  type ObjectAction,
} from "@/domain/actions/object-actions";
import {
  findWorkItemOrRefuse,
  readRunningTimer,
  toAgentEntry,
} from "@/domain/agents/agent-read-model";
import { AgentToolRefusal } from "@/domain/agents/agent-tool-refusal";
import { isBacklogItemSnoozed } from "@/domain/backlog/backlog-item-lifecycle";
import { isSubtaskWorkItem } from "@/domain/backlog/work-item-hierarchy";
import {
  getLocalProjectDisplayName,
  type LocalAppState,
  type LocalTimesheetEntry,
  type LocalWorkItem,
} from "@/domain/local-state";
import { localStore } from "@/lib/local-store";

/**
 * Timer and entry tools. Each one checks the object's action set from
 * domain/actions/object-actions.ts, so an agent can do exactly what the UI
 * allows and gets the UI's disabled reason when it can't. Each write runs
 * as one undoable action.
 */

const MINUTE = 60_000;

export interface AgentWriteOutcome {
  output: unknown;
  undoToken: string | null;
  /** Past tense, shown in the Undo toast and the activity list. */
  action: string;
  objectId: string;
  objectTitle: string;
  /** For "Can't undo. The <subject> changed after that action." */
  undoSubject: string;
  /** Synced items whose source write goes when the Undo window closes. */
  sourceWriteIds?: string[];
}

/** Throws the action's disabled reason, or a refusal when the set lacks it. */
export function assertAllowed<Id extends string>(
  actions: ObjectAction<Id>[],
  id: Id,
) {
  const action = actions.find((candidate) => candidate.id === id);
  if (!action) {
    throw new AgentToolRefusal(`Ajour does not offer ${id} for this object.`);
  }
  if (action.disabledReason) throw new AgentToolRefusal(action.disabledReason);
}

/** Finds an active project and task an entry can go to. */
export function requireProjectTask(
  state: LocalAppState,
  projectId: string,
  taskId?: string,
) {
  const project = state.projects.find(
    (candidate) => candidate._id === projectId,
  );
  if (!project) {
    throw new AgentToolRefusal(
      `No project has the id ${projectId}. Call list_projects.`,
    );
  }
  if (taskId === undefined) {
    assertAllowed(getProjectActions(project), "edit");
    return {
      project,
      task: undefined,
      title: getLocalProjectDisplayName(project),
    };
  }
  const task = project.tasks.find((candidate) => candidate._id === taskId);
  if (!task) {
    throw new AgentToolRefusal(
      `Project ${getLocalProjectDisplayName(project)} has no task with the id ${taskId}. Call list_projects.`,
    );
  }
  assertAllowed(getTaskActions(project, task), "start-entry");
  return {
    project,
    task,
    title: `${getLocalProjectDisplayName(project)} · ${task.name}`,
  };
}

export function backlogActionOptions(
  state: LocalAppState,
  item: LocalWorkItem,
  now: number,
): BacklogItemActionOptions {
  return {
    subitemCount: state.workItems.filter(
      (candidate) => candidate.parentWorkItemId === item._id,
    ).length,
    isSubitem: isSubtaskWorkItem(item),
    isRunning: state.timers.some((timer) => timer.workItemId === item._id),
    isSnoozed: isBacklogItemSnoozed(item, now),
  };
}

export function isEntryRunning(
  state: LocalAppState,
  entry: LocalTimesheetEntry,
) {
  return state.timers.some((timer) => timer.entryId === entry._id);
}

export function requireEntry(state: LocalAppState, entryId: string) {
  const entry = state.timesheetEntries.find(
    (candidate) => candidate._id === entryId,
  );
  if (!entry) {
    throw new AgentToolRefusal(
      `No entry has the id ${entryId}. Call list_time_entries.`,
    );
  }
  return entry;
}

function entryActions(state: LocalAppState, entry: LocalTimesheetEntry) {
  return getTimeEntryActions(
    getTimeEntryActionState({
      submittedAt: entry.submittedAt,
      isRunning: isEntryRunning(state, entry),
    }),
  );
}

function entryTitle(state: LocalAppState, entry: LocalTimesheetEntry) {
  const agentEntry = toAgentEntry(state, entry);
  return (
    [agentEntry.projectName, agentEntry.taskName].filter(Boolean).join(" · ") ||
    entry.label
  );
}

/** The entry `after` has and `before` lacks, for tools that create one. */
function addedEntry(before: LocalAppState, after: LocalAppState) {
  const known = new Set(before.timesheetEntries.map((entry) => entry._id));
  return after.timesheetEntries.find((entry) => !known.has(entry._id));
}

export const ENTRY_WRITE_TOOLS = [
  "start_timer",
  "stop_timer",
  "edit_running_entry",
  "create_entry",
  "edit_entry",
  "move_entry",
  "duplicate_entry",
  "mark_entries_submitted",
] as const satisfies readonly WriteToolName[];
export type EntryWriteTool = (typeof ENTRY_WRITE_TOOLS)[number];

export function runEntryWriteTool(
  tool: EntryWriteTool,
  rawInput: unknown,
): AgentWriteOutcome {
  const state = localStore.snapshot();
  const now = Date.now();

  switch (tool) {
    case "start_timer": {
      const input = writeToolInputSchemas.start_timer.parse(rawInput);
      let draft: Parameters<typeof localStore.startTimer>[0];
      let title: string;
      if (input.workItemId) {
        const item = state.workItems.find(
          (candidate) => candidate._id === input.workItemId,
        );
        if (!item) {
          throw new AgentToolRefusal(
            `No backlog item has the id ${input.workItemId}. Call list_work_items.`,
          );
        }
        assertAllowed(
          getBacklogItemActions(item, backlogActionOptions(state, item, now)),
          "start-entry",
        );
        const projectId = input.projectId ?? item.projectId;
        const taskId = input.projectId
          ? input.taskId
          : (input.taskId ?? item.taskId);
        if (projectId) requireProjectTask(state, projectId, taskId);
        draft = { workItemId: item._id, projectId, taskId, note: input.note };
        title = item.title;
      } else if (input.projectId) {
        const target = requireProjectTask(state, input.projectId, input.taskId);
        draft = {
          projectId: input.projectId,
          taskId: input.taskId,
          note: input.note,
        };
        title = target.title;
      } else {
        throw new AgentToolRefusal(
          "Pass a workItemId, or a projectId with an optional taskId.",
        );
      }
      const { undoToken } = localStore.runWithUndo(() =>
        localStore.startTimer(draft),
      );
      const running = readRunningTimer(localStore.snapshot(), Date.now());
      return {
        output: running,
        undoToken,
        action: "Started an entry",
        objectId: running?.timerId ?? "",
        objectTitle: title,
        undoSubject: "entry",
      };
    }

    case "stop_timer": {
      writeToolInputSchemas.stop_timer.parse(rawInput);
      const timer = state.timers[0];
      if (!timer) throw new AgentToolRefusal("No entry is running.");
      const running = readRunningTimer(state, now)!;
      const { undoToken } = localStore.runWithUndo(() =>
        localStore.saveTimer(timer._id),
      );
      return {
        output: { stopped: true, countedMinutes: running.countedMinutes },
        undoToken,
        action: "Stopped the entry",
        objectId: timer._id,
        objectTitle:
          [running.projectName, running.taskName].filter(Boolean).join(" · ") ||
          "Running entry",
        undoSubject: "entry",
      };
    }

    case "edit_running_entry": {
      const input = writeToolInputSchemas.edit_running_entry.parse(rawInput);
      const timer = state.timers[0];
      if (!timer) throw new AgentToolRefusal("No entry is running.");
      const projectId = input.projectId ?? timer.projectId;
      // A different project drops the old task, which belongs to the old project.
      const taskId =
        input.projectId && input.projectId !== timer.projectId
          ? input.taskId
          : (input.taskId ?? timer.taskId);
      if (projectId) requireProjectTask(state, projectId, taskId);
      const { undoToken } = localStore.runWithUndo(() =>
        localStore.editRunningEntry(timer._id, {
          projectId,
          taskId,
          note: input.note ?? timer.note,
          ...(input.countedMinutes !== undefined
            ? { countedDurationMs: input.countedMinutes * MINUTE }
            : {}),
        }),
      );
      const running = readRunningTimer(localStore.snapshot(), Date.now());
      return {
        output: running,
        undoToken,
        action: "Edited the running entry",
        objectId: timer._id,
        objectTitle:
          [running?.projectName, running?.taskName]
            .filter(Boolean)
            .join(" · ") || "Running entry",
        undoSubject: "entry",
      };
    }

    case "create_entry": {
      const input = writeToolInputSchemas.create_entry.parse(rawInput);
      const target = requireProjectTask(state, input.projectId, input.taskId);
      if (input.workItemId) {
        const item = findWorkItemOrRefuse(state, input.workItemId);
        assertAllowed(
          getBacklogItemActions(item, backlogActionOptions(state, item, now)),
          "new-entry",
        );
      }
      const { undoToken } = localStore.runWithUndo(() =>
        localStore.saveManualTimeEntry({
          localDate: input.date,
          projectId: input.projectId,
          taskId: input.taskId,
          workItemId: input.workItemId,
          note: input.note,
          durationMs: input.minutes * MINUTE,
        }),
      );
      const after = localStore.snapshot();
      const entry = addedEntry(state, after);
      if (!entry) throw new AgentToolRefusal("Ajour did not add the entry.");
      return {
        output: toAgentEntry(after, entry),
        undoToken,
        action: "Added an entry",
        objectId: entry._id,
        objectTitle: target.title,
        undoSubject: "entry",
      };
    }

    case "edit_entry": {
      const input = writeToolInputSchemas.edit_entry.parse(rawInput);
      const entry = requireEntry(state, input.entryId);
      if (isEntryRunning(state, entry)) {
        throw new AgentToolRefusal(
          "Use edit_running_entry for the running entry.",
        );
      }
      assertAllowed(entryActions(state, entry), "edit");
      const projectId = input.projectId ?? entry.projectId;
      // A different project drops the old task, which belongs to the old project.
      const taskId =
        input.projectId && input.projectId !== entry.projectId
          ? input.taskId
          : (input.taskId ?? entry.taskId);
      if (projectId) requireProjectTask(state, projectId, taskId);
      const { undoToken } = localStore.runWithUndo(() =>
        localStore.updateTimesheetEntry(entry._id, {
          projectId,
          taskId,
          note: input.note ?? entry.note,
          durationMs:
            input.minutes !== undefined
              ? input.minutes * MINUTE
              : entry.durationMs,
        }),
      );
      const after = localStore.snapshot();
      const updated = requireEntry(after, entry._id);
      return {
        output: toAgentEntry(after, updated),
        undoToken,
        action: "Edited an entry",
        objectId: entry._id,
        objectTitle: entryTitle(after, updated),
        undoSubject: "entry",
      };
    }

    case "move_entry":
    case "duplicate_entry": {
      const input =
        tool === "move_entry"
          ? writeToolInputSchemas.move_entry.parse(rawInput)
          : writeToolInputSchemas.duplicate_entry.parse(rawInput);
      const entry = requireEntry(state, input.entryId);
      assertAllowed(
        entryActions(state, entry),
        tool === "move_entry"
          ? "move-to"
          : input.date
            ? "duplicate-to"
            : "duplicate",
      );
      const values = {
        localDate: input.date ?? entry.localDate,
        projectId: entry.projectId,
        taskId: entry.taskId,
        note: entry.note,
        durationMs: entry.durationMs,
      };
      const { undoToken } = localStore.runWithUndo(() =>
        tool === "move_entry"
          ? localStore.moveTimesheetEntry(entry._id, values)
          : localStore.duplicateTimesheetEntry(entry._id, values),
      );
      const after = localStore.snapshot();
      const result =
        tool === "move_entry"
          ? after.timesheetEntries.find(
              (candidate) => candidate._id === entry._id,
            )
          : addedEntry(state, after);
      return {
        output: result ? toAgentEntry(after, result) : null,
        undoToken,
        action:
          tool === "move_entry" ? "Moved an entry" : "Duplicated an entry",
        objectId: result?._id ?? entry._id,
        objectTitle: entryTitle(state, entry),
        undoSubject: "entry",
      };
    }

    case "mark_entries_submitted": {
      const input =
        writeToolInputSchemas.mark_entries_submitted.parse(rawInput);
      for (const entryId of input.entryIds) {
        const entry = requireEntry(state, entryId);
        if (isEntryRunning(state, entry)) {
          throw new AgentToolRefusal("Stop the running entry first");
        }
      }
      const { undoToken } = localStore.runWithUndo(() =>
        localStore.markTimesheetEntriesSubmitted(input.entryIds),
      );
      const count = input.entryIds.length;
      return {
        output: { marked: count },
        undoToken,
        action: `Marked ${count} ${count === 1 ? "entry" : "entries"} as submitted`,
        objectId: input.entryIds[0]!,
        objectTitle: `${count} ${count === 1 ? "entry" : "entries"}`,
        undoSubject: "entry",
      };
    }
  }
}
