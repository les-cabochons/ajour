import { applyLoggedTimeToWorkItems } from "@/domain/backlog/work-item-estimates";
import type {
  LocalAppState,
  LocalProject,
  LocalTimesheetImportDraft,
} from "@/domain/local-state";
import {
  createProject,
  createProjectTask,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";
import {
  formatTaskImportName,
  normalizeTaskImportName,
} from "@/domain/projects/task-import";
import { createTimesheetEntry } from "@/domain/time/timesheet-entry";

export type TimesheetImportFactories = ProjectFactories;

export interface TimesheetImportRow {
  date: string;
  project: string;
  task: string;
  note?: string;
  hours: number;
}

function formatImportName(value?: string) {
  return formatTaskImportName(value ?? "");
}

function isValidLocalDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function resolveImportedProject(projects: LocalProject[], projectName: string) {
  const normalizedProjectName = normalizeTaskImportName(projectName);
  return projects.find(
    (project) =>
      normalizeTaskImportName(project.name) === normalizedProjectName,
  );
}

function resolveImportedTask(
  project: LocalProject | undefined,
  taskName: string,
) {
  const normalizedTaskName = normalizeTaskImportName(taskName);
  return project?.tasks.find(
    (task) => normalizeTaskImportName(task.name) === normalizedTaskName,
  );
}

function findTimesheetImportConflicts(
  state: LocalAppState,
  values: {
    localDate: string;
    projectName: string;
    taskName: string;
  },
) {
  const project = resolveImportedProject(state.projects, values.projectName);
  const task = resolveImportedTask(project, values.taskName);
  const hasProjectName = Boolean(normalizeTaskImportName(values.projectName));
  const hasTaskName = Boolean(normalizeTaskImportName(values.taskName));
  if ((hasProjectName && !project) || (hasTaskName && !task)) {
    return {
      potentialConflict: false,
      conflictEntryIds: [],
    };
  }
  const conflictEntryIds = state.timesheetEntries
    .filter(
      (entry) =>
        entry.localDate === values.localDate &&
        entry.projectId === project?._id &&
        (entry.taskId ?? "") === (task?._id ?? ""),
    )
    .map((entry) => entry._id);

  return {
    potentialConflict: conflictEntryIds.length > 0,
    conflictEntryIds,
  };
}

function createTimesheetImportDraft(
  state: LocalAppState,
  values: TimesheetImportRow,
  factories: TimesheetImportFactories,
): LocalTimesheetImportDraft {
  const projectName = formatImportName(values.project);
  const taskName = formatImportName(values.task);
  const localDate = values.date.trim();
  const note = values.note?.trim() || undefined;
  const durationMs = Math.round(values.hours * 60 * 60 * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Imported hours must be a positive finite number.");
  }
  if (!isValidLocalDate(localDate)) {
    throw new Error("Imported date must use a valid YYYY-MM-DD value.");
  }
  const conflicts = findTimesheetImportConflicts(state, {
    localDate,
    projectName,
    taskName,
  });

  return {
    _id: factories.createId("timesheet_import"),
    localDate,
    projectName,
    taskName,
    note,
    durationMs,
    ...conflicts,
    importedAt: factories.now(),
  };
}

export function stageTimesheetImportRows(
  state: LocalAppState,
  rows: TimesheetImportRow[],
  factories: TimesheetImportFactories,
): LocalAppState {
  return {
    ...state,
    timesheetImportDrafts: rows.map((row) =>
      createTimesheetImportDraft(state, row, factories),
    ),
  };
}

export function clearTimesheetImportDrafts(
  state: LocalAppState,
): LocalAppState {
  return {
    ...state,
    timesheetImportDrafts: [],
  };
}

export function dismissTimesheetImportDraft(
  state: LocalAppState,
  draftId: string,
): LocalAppState {
  return {
    ...state,
    timesheetImportDrafts: state.timesheetImportDrafts.filter(
      (draft) => draft._id !== draftId,
    ),
  };
}

function ensureImportedProjectAndTask(
  state: LocalAppState,
  values: {
    projectName: string;
    taskName: string;
  },
  factories: TimesheetImportFactories,
) {
  const projectName = formatImportName(values.projectName);
  const taskName = formatImportName(values.taskName);

  if (!projectName) {
    if (taskName) {
      throw new Error("Imported tasks require a project.");
    }
    return {
      projects: state.projects,
      projectId: undefined,
      taskId: undefined,
    };
  }

  const existingProject = resolveImportedProject(state.projects, projectName);
  if (existingProject) {
    const existingTask = taskName
      ? resolveImportedTask(existingProject, taskName)
      : undefined;

    if (existingTask || !taskName) {
      return {
        projects: state.projects.map((project) =>
          project._id === existingProject._id
            ? {
                ...project,
                status: "active" as const,
                tasks: project.tasks.map((task) =>
                  task._id === existingTask?._id
                    ? {
                        ...task,
                        status: "active" as const,
                        archivedAt: undefined,
                      }
                    : task,
                ),
              }
            : project,
        ),
        projectId: existingProject._id,
        taskId: existingTask?._id,
      };
    }

    const task = createProjectTask({ name: taskName }, factories);
    return {
      projects: state.projects.map((project) =>
        project._id === existingProject._id
          ? {
              ...project,
              status: "active" as const,
              tasks: [...project.tasks, task],
            }
          : project,
      ),
      projectId: existingProject._id,
      taskId: task._id,
    };
  }

  const project = createProject(
    {
      name: projectName,
      color: "#3d5a80",
      tasks: taskName ? [{ name: taskName }] : [],
    },
    factories,
  );

  return {
    projects: [...state.projects, project],
    projectId: project._id,
    taskId: project.tasks[0]?._id,
  };
}

function commitDraft(
  state: LocalAppState,
  draft: LocalTimesheetImportDraft,
  factories: TimesheetImportFactories,
) {
  const ensured = ensureImportedProjectAndTask(
    state,
    {
      projectName: draft.projectName,
      taskName: draft.taskName,
    },
    factories,
  );
  const timesheetEntry = createTimesheetEntry(
    ensured.projects,
    {
      localDate: draft.localDate,
      projectId: ensured.projectId,
      taskId: ensured.taskId,
      note: draft.note,
      durationMs: draft.durationMs,
      sourceBlockIds: [],
    },
    factories,
  );

  return {
    ...state,
    projects: ensured.projects,
    timesheetEntries: [...state.timesheetEntries, timesheetEntry],
    workItems: applyLoggedTimeToWorkItems(state.workItems, {
      projectId: ensured.projectId,
      taskId: ensured.taskId,
      durationMsDelta: draft.durationMs,
    }),
  };
}

export function commitTimesheetImportDraft(
  state: LocalAppState,
  draftId: string,
  factories: TimesheetImportFactories,
): LocalAppState {
  const draft = state.timesheetImportDrafts.find(
    (item) => item._id === draftId,
  );
  if (!draft) {
    return state;
  }

  const committed = commitDraft(state, draft, factories);
  return {
    ...committed,
    timesheetImportDrafts: committed.timesheetImportDrafts.filter(
      (item) => item._id !== draftId,
    ),
  };
}

export function commitReadyTimesheetImportDrafts(
  state: LocalAppState,
  factories: TimesheetImportFactories,
): LocalAppState {
  if (state.timesheetImportDrafts.length === 0) {
    return state;
  }

  let committed = state;
  const retainedDrafts: LocalTimesheetImportDraft[] = [];
  for (const draft of state.timesheetImportDrafts) {
    const conflicts = findTimesheetImportConflicts(committed, {
      localDate: draft.localDate,
      projectName: draft.projectName,
      taskName: draft.taskName,
    });
    if (conflicts.potentialConflict) {
      retainedDrafts.push({ ...draft, ...conflicts });
      continue;
    }

    committed = commitDraft(committed, draft, factories);
  }

  return {
    ...committed,
    timesheetImportDrafts: retainedDrafts,
  };
}
