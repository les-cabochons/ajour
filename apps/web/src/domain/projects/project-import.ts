import type {
  LocalProject,
  LocalProjectDraft,
  LocalProjectTask,
  LocalProjectTaskDraft,
} from "@/domain/local-state";
import type { ProjectDataShapeImportProject } from "@timetracker/shared";
import {
  durationHoursValueToMs,
  durationMsToHoursValue,
  normalizeProjectTaskAdjustmentMs,
  normalizeProjectTaskBudgetMs,
} from "@/domain/projects/task-budget";
import {
  formatTaskImportName,
  normalizeTaskImportName,
  type ProjectTaskImportResult,
} from "@/domain/projects/task-import";

export type ProjectTransferStatus = "active" | "archived";

export interface ProjectTransferRow {
  [key: string]: string | number;
  project: string;
  code: string;
  color: string;
  status: ProjectTransferStatus;
  task: string;
  taskStatus: ProjectTransferStatus | "";
  billable: "billable" | "non_billable" | "";
  budgetHours: number | "";
  adjustmentHours: number | "";
}

export interface ProjectWorkbookImportResult {
  createdProjectCount: number;
  mergedProjectCount: number;
  addedTaskCount: number;
  updatedTaskCount: number;
}

interface ProjectImportFactories {
  createProject: (project: LocalProjectDraft) => LocalProject;
  createTask: (task: LocalProjectTaskDraft) => LocalProjectTask;
  now: () => number;
}

interface ProjectImportOperation<T> {
  projects: LocalProject[];
  result: T;
}

function findProjectByName(projects: LocalProject[], projectName: string) {
  const normalizedProjectName = normalizeTaskImportName(projectName);
  return projects.find(
    (project) =>
      normalizeTaskImportName(project.name) === normalizedProjectName,
  );
}

function findProjectTaskByName(project: LocalProject, taskName: string) {
  const normalizedTaskName = normalizeTaskImportName(taskName);
  return project.tasks.find(
    (task) => normalizeTaskImportName(task.name) === normalizedTaskName,
  );
}

function groupWorkbookRows(rows: ProjectTransferRow[]) {
  const grouped = new Map<
    string,
    {
      projectName: string;
      code?: string;
      color?: string;
      status: ProjectTransferStatus;
      tasks: Array<{
        name: string;
        status?: ProjectTransferStatus;
        billable?: boolean;
        budgetMs?: number;
        adjustmentMs?: number;
      }>;
    }
  >();

  for (const row of rows) {
    const projectName = formatTaskImportName(row.project);
    const key = normalizeTaskImportName(projectName);
    if (!key) {
      continue;
    }
    const group = grouped.get(key) ?? {
      projectName,
      code: undefined,
      color: undefined,
      status: row.status,
      tasks: [],
    };

    group.projectName = projectName;
    group.code = formatTaskImportName(row.code) || group.code;
    group.color = formatTaskImportName(row.color) || group.color;
    group.status = row.status;

    const taskName = formatTaskImportName(row.task);
    if (taskName) {
      const taskKey = normalizeTaskImportName(taskName);
      const existingTaskIndex = group.tasks.findIndex(
        (task) => normalizeTaskImportName(task.name) === taskKey,
      );
      const task = {
        name: taskName,
        status: row.taskStatus || undefined,
        billable: row.billable
          ? row.billable === "billable"
          : undefined,
        budgetMs: durationHoursValueToMs(
          typeof row.budgetHours === "number" ? row.budgetHours : undefined,
        ),
        adjustmentMs: durationHoursValueToMs(
          typeof row.adjustmentHours === "number"
            ? row.adjustmentHours
            : undefined,
        ),
      } as const;

      if (existingTaskIndex >= 0) {
        const existingTask = group.tasks[existingTaskIndex]!;
        group.tasks[existingTaskIndex] = {
          ...existingTask,
          ...Object.fromEntries(
            Object.entries(task).filter(([, value]) => value !== undefined),
          ),
        };
      } else {
        group.tasks.push(task);
      }
    }

    grouped.set(key, group);
  }

  return Array.from(grouped.values());
}

export function importProjectTasks(
  projects: LocalProject[],
  projectId: string,
  taskNames: string[],
  factories: Pick<ProjectImportFactories, "createTask">,
): ProjectImportOperation<ProjectTaskImportResult> {
  const project = projects.find((item) => item._id === projectId);
  if (!project) {
    throw new Error("Project not found.");
  }

  const existingTaskNames = new Set(
    project.tasks.map((task) => normalizeTaskImportName(task.name)),
  );
  const nextTasks = [...project.tasks];
  const importedNames: string[] = [];
  let duplicateCount = 0;
  let blankCount = 0;

  for (const taskName of taskNames) {
    const displayName = formatTaskImportName(taskName);
    const normalizedName = normalizeTaskImportName(displayName);

    if (!normalizedName) {
      blankCount += 1;
      continue;
    }

    if (existingTaskNames.has(normalizedName)) {
      duplicateCount += 1;
      continue;
    }

    existingTaskNames.add(normalizedName);
    importedNames.push(displayName);
    nextTasks.push(factories.createTask({ name: displayName }));
  }

  return {
    projects: projects.map((item) =>
      item._id === projectId ? { ...item, tasks: nextTasks } : item,
    ),
    result: {
      importedCount: importedNames.length,
      duplicateCount,
      blankCount,
      headerCount: 0,
      importedNames,
    },
  };
}

export function importProjectWorkbookRows(
  projects: LocalProject[],
  rows: ProjectTransferRow[],
  factories: ProjectImportFactories,
): ProjectImportOperation<ProjectWorkbookImportResult> {
  const result: ProjectWorkbookImportResult = {
    createdProjectCount: 0,
    mergedProjectCount: 0,
    addedTaskCount: 0,
    updatedTaskCount: 0,
  };
  const nextProjects = [...projects];

  for (const group of groupWorkbookRows(rows)) {
    const existingProject = findProjectByName(
      nextProjects,
      group.projectName,
    );

    if (!existingProject) {
      const nextProject = factories.createProject({
        name: group.projectName,
        code: group.code,
        color: group.color || "#3d5a80",
        status: group.status ?? "active",
        tasks: group.tasks,
      });
      nextProjects.push(nextProject);
      result.createdProjectCount += 1;
      result.addedTaskCount += group.tasks.length;
      continue;
    }

    result.mergedProjectCount += 1;

    const nextTasks = [...existingProject.tasks];
    for (const importedTask of group.tasks) {
      const existingTask = findProjectTaskByName(
        existingProject,
        importedTask.name,
      );
      if (!existingTask) {
        nextTasks.push(factories.createTask(importedTask));
        result.addedTaskCount += 1;
        continue;
      }

      const status = importedTask.status ?? existingTask.status;
      const budgetMs =
        importedTask.budgetMs === undefined
          ? existingTask.budgetMs
          : normalizeProjectTaskBudgetMs(importedTask.budgetMs);
      const adjustmentMs =
        importedTask.adjustmentMs === undefined
          ? existingTask.adjustmentMs
          : normalizeProjectTaskAdjustmentMs(importedTask.adjustmentMs);
      const billable = importedTask.billable ?? existingTask.billable ?? true;

      if (
        existingTask.status !== status ||
        (existingTask.billable ?? true) !== billable ||
        existingTask.budgetMs !== budgetMs ||
        existingTask.adjustmentMs !== adjustmentMs
      ) {
        result.updatedTaskCount += 1;
      }

      const existingTaskIndex = nextTasks.findIndex(
        (task) => task._id === existingTask._id,
      );
      if (existingTaskIndex >= 0) {
        nextTasks[existingTaskIndex] = {
          ...existingTask,
          status,
          archivedAt:
            status === "archived"
              ? (existingTask.archivedAt ?? factories.now())
              : undefined,
          billable,
          budgetMs,
          adjustmentMs,
        };
      }
    }

    const projectIndex = nextProjects.findIndex(
      (project) => project._id === existingProject._id,
    );
    if (projectIndex >= 0) {
      nextProjects[projectIndex] = {
      ...existingProject,
      name: group.projectName,
      displayName:
        existingProject.displayName === existingProject.name
          ? group.projectName
          : existingProject.displayName,
      code: group.code ?? existingProject.code,
        color: group.color || existingProject.color,
      status: group.status ?? existingProject.status,
        tasks: nextTasks,
      };
    }
  }

  return { projects: nextProjects, result };
}

export function importProjectDataShapeProjects(
  projects: LocalProject[],
  importedProjects: ProjectDataShapeImportProject[],
  factories: ProjectImportFactories,
) {
  const rows = importedProjects.flatMap<ProjectTransferRow>((project) => {
    if (project.tasks.length === 0) {
      return [
        {
          project: project.name,
          code: project.code ?? "",
          color: project.color ?? "",
          status: project.status,
          task: "",
          taskStatus: "",
          billable: "",
          budgetHours: "",
          adjustmentHours: "",
        },
      ];
    }

    return project.tasks.map((task) => ({
      project: project.name,
      code: project.code ?? "",
      color: project.color ?? "",
      status: project.status,
      task: task.name,
      taskStatus: task.status ?? "",
      billable:
        task.billable === undefined
          ? ""
          : task.billable
            ? "billable"
            : "non_billable",
      budgetHours: durationMsToHoursValue(task.budgetMs) ?? "",
      adjustmentHours: durationMsToHoursValue(task.adjustmentMs) ?? "",
    }));
  });

  return importProjectWorkbookRows(projects, rows, factories);
}
