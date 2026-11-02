import type {
  LocalProject,
  LocalProjectDraft,
  LocalProjectTask,
  LocalProjectTaskDraft,
} from "@/domain/local-state";
import type { ProjectDataShapeImportProject } from "@ajour/shared";
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

/** A task as a file describes it. A field the file leaves out keeps Ajour's value. */
interface ImportedTask {
  name: string;
  status?: ProjectTransferStatus;
  billable?: boolean;
  budgetMs?: number;
  adjustmentMs?: number;
}

/**
 * Adds `task` to `tasks`, or merges it into the task of the same name: its
 * fields win, except those it leaves out.
 */
function addImportedTask(tasks: ImportedTask[], task: ImportedTask) {
  const taskKey = normalizeTaskImportName(task.name);
  const existingTaskIndex = tasks.findIndex(
    (candidate) => normalizeTaskImportName(candidate.name) === taskKey,
  );
  if (existingTaskIndex < 0) {
    tasks.push(task);
    return;
  }
  tasks[existingTaskIndex] = {
    ...tasks[existingTaskIndex]!,
    ...Object.fromEntries(
      Object.entries(task).filter(([, value]) => value !== undefined),
    ),
  };
}

/** A task the file names commits as its name, unless it is Local only. */
function confirmCommitAs(task: LocalProjectTask) {
  return task.commitAs === "waiting" ? undefined : task.commitAs;
}

/** One Not known yet task the file doesn't name, and the file's new names. */
export interface WaitingTaskChoice {
  taskId: string;
  name: string;
  /** The file's names the project lacks, closest to `name` first. */
  newNames: string[];
}

/**
 * The project's Not known yet tasks that a task file doesn't name, when the
 * file also adds tasks: Import tasks… asks which new task each one waited
 * for (#481). Empty when either list is empty, so the import applies at once.
 */
export function findWaitingTaskChoices(
  project: Pick<LocalProject, "tasks">,
  fileTaskNames: readonly string[],
): WaitingTaskChoice[] {
  const known = new Set(
    project.tasks.map((task) => normalizeTaskImportName(task.name)),
  );
  const fileKeys = new Set<string>();
  const newNames: string[] = [];
  for (const raw of fileTaskNames) {
    const name = formatTaskImportName(raw);
    const key = normalizeTaskImportName(name);
    if (!key || fileKeys.has(key)) continue;
    fileKeys.add(key);
    if (!known.has(key)) newNames.push(name);
  }
  if (newNames.length === 0) return [];
  return project.tasks
    .filter(
      (task) =>
        task.status === "active" &&
        task.commitAs === "waiting" &&
        !fileKeys.has(normalizeTaskImportName(task.name)),
    )
    .map((task) => ({
      taskId: task._id,
      name: task.name,
      newNames: rankByCommonWords(task.name, newNames),
    }));
}

/** `names` with the most words in common with `name` first, else in order. */
function rankByCommonWords(name: string, names: readonly string[]) {
  const words = new Set(normalizeTaskImportName(name).split(" "));
  const score = (candidate: string) =>
    normalizeTaskImportName(candidate)
      .split(" ")
      .filter((word) => words.has(word)).length;
  // Array.prototype.sort is stable, so equal scores keep the file's order.
  return [...names].sort((left, right) => score(right) - score(left));
}

/** What Import tasks… does with a Not known yet task the file doesn't name. */
export type WaitingTaskAnswer =
  { kind: "rename"; name: string } | { kind: "wait" } | { kind: "local" };

/**
 * Applies the answers before the merge: a picked name renames the task, so
 * the merge updates it instead of adding a twin, and the task commits as its
 * name; Local only makes it local; Still waiting leaves it. A name picked
 * for two tasks renames the first only.
 */
export function applyWaitingTaskAnswers(
  projects: LocalProject[],
  projectId: string,
  answers: Readonly<Record<string, WaitingTaskAnswer>>,
): LocalProject[] {
  const taken = new Set<string>();
  return projects.map((project) =>
    project._id !== projectId
      ? project
      : {
          ...project,
          tasks: project.tasks.map((task) => {
            const answer = Object.hasOwn(answers, task._id)
              ? answers[task._id]
              : undefined;
            if (!answer || task.commitAs !== "waiting") return task;
            if (answer.kind === "local") return { ...task, commitAs: "local" };
            if (answer.kind === "wait") return task;
            const name = formatTaskImportName(answer.name);
            const key = normalizeTaskImportName(name);
            const clash = project.tasks.some(
              (other) =>
                other._id !== task._id &&
                normalizeTaskImportName(other.name) === key,
            );
            if (!key || clash || taken.has(key)) return task;
            taken.add(key);
            return { ...task, name, commitAs: undefined };
          }),
        },
  );
}

/**
 * Merges imported tasks into a project's tasks by name: a new name adds a
 * task, and a known one takes the file's status, billable, budget and
 * adjustment, keeping its own where the file has none.
 */
function mergeImportedTasks(
  project: LocalProject,
  importedTasks: ImportedTask[],
  factories: Pick<ProjectImportFactories, "createTask" | "now">,
) {
  const tasks = [...project.tasks];
  let addedTaskCount = 0;
  let updatedTaskCount = 0;

  for (const importedTask of importedTasks) {
    const existingTask = findProjectTaskByName(project, importedTask.name);
    if (!existingTask) {
      tasks.push(factories.createTask(importedTask));
      addedTaskCount += 1;
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
      updatedTaskCount += 1;
    }

    const existingTaskIndex = tasks.findIndex(
      (task) => task._id === existingTask._id,
    );
    if (existingTaskIndex >= 0) {
      tasks[existingTaskIndex] = {
        ...existingTask,
        status,
        archivedAt:
          status === "archived"
            ? (existingTask.archivedAt ?? factories.now())
            : undefined,
        billable,
        budgetMs,
        adjustmentMs,
        // The file has the task, so a Not known yet task is known now.
        commitAs: confirmCommitAs(existingTask),
      };
    }
  }

  return { tasks, addedTaskCount, updatedTaskCount };
}

function groupWorkbookRows(rows: ProjectTransferRow[]) {
  const grouped = new Map<
    string,
    {
      projectName: string;
      code?: string;
      color?: string;
      status: ProjectTransferStatus;
      tasks: ImportedTask[];
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
      addImportedTask(group.tasks, {
        name: taskName,
        status: row.taskStatus || undefined,
        billable: row.billable ? row.billable === "billable" : undefined,
        budgetMs: durationHoursValueToMs(
          typeof row.budgetHours === "number" ? row.budgetHours : undefined,
        ),
        adjustmentMs: durationHoursValueToMs(
          typeof row.adjustmentHours === "number"
            ? row.adjustmentHours
            : undefined,
        ),
      });
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
      const known = nextTasks.findIndex(
        (task) =>
          normalizeTaskImportName(task.name) === normalizedName &&
          task.commitAs === "waiting",
      );
      if (known >= 0) {
        nextTasks[known] = {
          ...nextTasks[known]!,
          commitAs: confirmCommitAs(nextTasks[known]!),
        };
      }
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
    const existingProject = findProjectByName(nextProjects, group.projectName);

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

    const merged = mergeImportedTasks(existingProject, group.tasks, factories);
    const nextTasks = merged.tasks;
    result.addedTaskCount += merged.addedTaskCount;
    result.updatedTaskCount += merged.updatedTaskCount;

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

/**
 * Import tasks… refused a file made for another project. The message names
 * neither project, because it reaches the store command's event, which holds
 * no names. `fileProjectName` lets the page say which project the file is for.
 */
export class ImportedProjectMismatchError extends Error {
  readonly fileProjectName: string;

  constructor(fileProjectName: string) {
    super("This file is for another project.");
    this.name = "ImportedProjectMismatchError";
    this.fileProjectName = fileProjectName;
  }
}

/** The tasks a project gained and changed from an Import tasks… file. */
export interface ProjectTaskMergeResult {
  addedTaskCount: number;
  updatedTaskCount: number;
}

/**
 * Merges projects a schema read from a file, by name. A project without a
 * name refuses the whole file: only Import tasks… on a project takes it.
 */
export function importProjectDataShapeProjects(
  projects: LocalProject[],
  importedProjects: ProjectDataShapeImportProject[],
  factories: ProjectImportFactories,
) {
  const namedProjects = importedProjects.map(({ name, ...project }) => {
    if (name === undefined) {
      throw new Error(
        "This file doesn't name its project. Open the project in Ajour and use Import tasks… instead.",
      );
    }
    return { ...project, name };
  });
  const rows = namedProjects.flatMap<ProjectTransferRow>((project) => {
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

/**
 * Merges the tasks of one project a schema read from a file into the project
 * `projectId`, by name, as a project import would. The file must hold one
 * project. A name it gives must be this project's, so another project's file
 * changes nothing.
 */
export function importProjectDataShapeTasks(
  projects: LocalProject[],
  projectId: string,
  importedProjects: ProjectDataShapeImportProject[],
  factories: Pick<ProjectImportFactories, "createTask" | "now">,
): ProjectImportOperation<ProjectTaskMergeResult> {
  const project = projects.find((item) => item._id === projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  const [importedProject, ...otherProjects] = importedProjects;
  if (!importedProject || otherProjects.length > 0) {
    throw new Error(
      `This file holds ${importedProjects.length} projects. Import tasks… takes a file with one project.`,
    );
  }
  if (
    importedProject.name !== undefined &&
    normalizeTaskImportName(importedProject.name) !==
      normalizeTaskImportName(project.name)
  ) {
    throw new ImportedProjectMismatchError(
      formatTaskImportName(importedProject.name),
    );
  }

  const importedTasks: ImportedTask[] = [];
  for (const task of importedProject.tasks) {
    const name = formatTaskImportName(task.name);
    if (name) {
      addImportedTask(importedTasks, { ...task, name });
    }
  }
  const merged = mergeImportedTasks(project, importedTasks, factories);

  return {
    projects: projects.map((item) =>
      item._id === projectId ? { ...item, tasks: merged.tasks } : item,
    ),
    result: {
      addedTaskCount: merged.addedTaskCount,
      updatedTaskCount: merged.updatedTaskCount,
    },
  };
}
