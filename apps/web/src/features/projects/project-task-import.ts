import { BUILT_IN_PROJECT_DATA_SHAPE_ID } from "@ajour/shared";
import { getTaskNameField } from "@/domain/projects/plugin-properties";
import {
  findWaitingTaskChoices,
  ImportedProjectMismatchError,
  type ProjectTaskMergeResult,
  type WaitingTaskAnswer,
} from "@/domain/projects/project-import";
import {
  formatTaskImportName,
  normalizeTaskImportName,
  type ProjectTaskImportResult,
} from "@/domain/projects/task-import";
import {
  getProjectDataShapePlugins,
  importProjectsWithDataShape,
} from "@/lib/app-api";
import { requestWaitingTaskAnswers } from "@/features/projects/waiting-tasks-dialog";
import { localStore } from "@/lib/local-store";
import { listTaskPropertyPlugins } from "@/lib/plugin-project-properties";
import { loadWorkbook, readWorkbookSheets } from "@/lib/workbook-sheets";

export {
  formatTaskImportName,
  normalizeTaskImportName,
  type ProjectTaskImportResult,
} from "@/domain/projects/task-import";

const taskImportColumnIndex = 2;
const taskImportHeader = "nom personnalise de la tache";

/**
 * Reads task names from column C of the first worksheet, the column of
 * Workday's project plan export. It skips blank cells and the header.
 */
export async function extractTaskNamesFromWorkbook(
  buffer: ArrayBuffer | Uint8Array,
) {
  const workbook = await loadWorkbook(buffer);

  const firstSheet = workbook.worksheets[0];
  if (!firstSheet) {
    throw new Error("The workbook does not contain any worksheets.");
  }

  const taskNames: string[] = [];
  let blankCount = 0;
  let headerCount = 0;

  for (let rowNumber = 1; rowNumber <= firstSheet.rowCount; rowNumber += 1) {
    const row = firstSheet.getRow(rowNumber);
    const rawValue = row.getCell(taskImportColumnIndex + 1).value;
    const displayName = formatTaskImportName(String(rawValue ?? ""));

    if (!displayName) {
      blankCount += 1;
      continue;
    }

    if (normalizeTaskImportName(displayName) === taskImportHeader) {
      headerCount += 1;
      continue;
    }

    taskNames.push(displayName);
  }

  return {
    taskNames,
    blankCount,
    headerCount,
  };
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function formatTaskNameImportSummary(result: ProjectTaskImportResult) {
  const skipped: string[] = [];

  if (result.duplicateCount > 0) {
    skipped.push(formatCount(result.duplicateCount, "duplicate", "duplicates"));
  }
  if (result.blankCount > 0) {
    skipped.push(formatCount(result.blankCount, "blank cell", "blank cells"));
  }
  if (result.headerCount > 0) {
    skipped.push(formatCount(result.headerCount, "header row", "header rows"));
  }

  const importedLabel = formatCount(result.importedCount, "task", "tasks");
  const confirmed =
    result.confirmedWaitingCount > 0
      ? ` Confirmed ${formatCount(result.confirmedWaitingCount, "waiting task", "waiting tasks")}.`
      : "";
  return skipped.length > 0
    ? `Imported ${importedLabel}. Skipped ${skipped.join(", ")}.${confirmed}`
    : `Imported ${importedLabel}.${confirmed}`;
}

export function formatSchemaTaskImportSummary(result: ProjectTaskMergeResult) {
  const parts = [];
  if (result.addedTaskCount > 0) {
    parts.push(
      `imported ${formatCount(result.addedTaskCount, "task", "tasks")}`,
    );
  }
  if (result.updatedTaskCount > 0) {
    parts.push(
      `updated ${formatCount(result.updatedTaskCount, "task", "tasks")}`,
    );
  }
  if (parts.length === 0) return "No tasks changed.";
  const summary = parts.join(", ");
  return `${summary[0]!.toUpperCase()}${summary.slice(1)}.`;
}

/**
 * The schema plugin picked in Settings › Projects. A plugin no longer
 * listed, uninstalled or off, gives undefined: Settings then shows Ajour
 * default too. When the list can't be read, the import stops: column C
 * would drop what the schema reads, such as closed tasks.
 */
async function pickedSchemaPlugin() {
  const schemaId = localStore.snapshot().userPreferences.projectDataShapeId;
  if (!schemaId || schemaId === BUILT_IN_PROJECT_DATA_SHAPE_ID) {
    return undefined;
  }
  let plugins: Awaited<ReturnType<typeof getProjectDataShapePlugins>>;
  try {
    plugins = await getProjectDataShapePlugins();
  } catch (error) {
    throw new Error(
      `Ajour can't reach the schema picked in Settings › Projects. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
  return plugins.find((plugin) => plugin.id === schemaId);
}

/** Merges the plugin's tasks, naming the file's project when it is another one. */
function importSchemaTasks(
  projectId: string,
  schemaId: string,
  projects: Parameters<typeof localStore.importProjectDataShapeTasks>[2],
  waitingAnswers: Record<string, WaitingTaskAnswer>,
) {
  try {
    return localStore.importProjectDataShapeTasks(
      projectId,
      schemaId,
      projects,
      waitingAnswers,
    );
  } catch (error) {
    if (!(error instanceof ImportedProjectMismatchError)) throw error;
    const project = localStore
      .snapshot()
      .projects.find((item) => item._id === projectId);
    throw new Error(
      `This file is for ${error.fileProjectName}, not ${project?.name ?? "this project"}.`,
    );
  }
}

/**
 * What to do with the project's Not known yet tasks that the file doesn't
 * name, when it adds tasks (#481): the user picks, or null when they cancel.
 * No question when there is nothing to ask.
 */
async function askAboutWaitingTasks(
  projectId: string,
  fileTaskNames: string[],
): Promise<Record<string, WaitingTaskAnswer> | null> {
  const project = localStore
    .snapshot()
    .projects.find((item) => item._id === projectId);
  const choices = project ? findWaitingTaskChoices(project, fileTaskNames) : [];
  if (choices.length === 0) return {};
  const plugins = await listTaskPropertyPlugins().catch(() => []);
  const toolName =
    plugins.find((plugin) => getTaskNameField(plugin))?.capability.section ??
    "timesheet";
  return requestWaitingTaskAnswers(choices, toolName);
}

/**
 * "Matched 1 waiting task." after the summary, for the renames the import
 * applied. A merge that changed nothing else says only that.
 */
function withMatchedWaiting(summary: string, matched: number) {
  if (matched === 0) return summary;
  const sentence = `Matched ${formatCount(matched, "waiting task", "waiting tasks")}.`;
  return summary === "No tasks changed." ? sentence : `${summary} ${sentence}`;
}

/** What Import tasks… says when the user cancels the waiting tasks question. */
export const TASK_IMPORT_CANCELLED = "Import cancelled. Nothing changed.";

/**
 * Imports a workbook's tasks into a project and says what changed. With a
 * schema plugin picked in Settings › Projects, the plugin reads the file and
 * Ajour merges its tasks by name. Otherwise Ajour adds the task names in
 * column C of the first worksheet. Before writing, it asks which new task
 * each Not known yet task waited for, when there is one to ask about.
 */
export async function importTasksFromWorkbook(
  projectId: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const plugin = await pickedSchemaPlugin();
  if (plugin) {
    const { projects } = await importProjectsWithDataShape(
      plugin.id,
      await readWorkbookSheets(bytes),
    );
    // The merge refuses a file with several projects or another project's
    // name, so those ask nothing and fail there.
    const [fileProject] = projects;
    const projectName = localStore
      .snapshot()
      .projects.find((item) => item._id === projectId)?.name;
    const answers =
      fileProject &&
      projects.length === 1 &&
      (fileProject.name === undefined ||
        normalizeTaskImportName(fileProject.name) ===
          normalizeTaskImportName(projectName ?? ""))
        ? await askAboutWaitingTasks(
            projectId,
            fileProject.tasks.map((task) => task.name),
          )
        : {};
    if (!answers) return TASK_IMPORT_CANCELLED;
    const merged = importSchemaTasks(projectId, plugin.id, projects, answers);
    return withMatchedWaiting(
      formatSchemaTaskImportSummary(merged),
      merged.matchedWaitingCount,
    );
  }

  const workbook = await extractTaskNamesFromWorkbook(bytes);
  if (workbook.taskNames.length === 0) {
    throw new Error(
      "No usable task names were found in column C of the first worksheet.",
    );
  }
  const answers = await askAboutWaitingTasks(projectId, workbook.taskNames);
  if (!answers) return TASK_IMPORT_CANCELLED;
  const result = localStore.importProjectTasks(
    projectId,
    workbook.taskNames,
    answers,
  );
  return withMatchedWaiting(
    formatTaskNameImportSummary({
      ...result,
      // A renamed waiting task confirmed by the file is a match, not a skip.
      confirmedWaitingCount: Math.max(
        0,
        result.confirmedWaitingCount - result.matchedWaitingCount,
      ),
      blankCount: workbook.blankCount,
      headerCount: workbook.headerCount,
    }),
    result.matchedWaitingCount,
  );
}
