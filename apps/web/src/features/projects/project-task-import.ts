import { BUILT_IN_PROJECT_DATA_SHAPE_ID } from "@ajour/shared";
import type { ProjectTaskMergeResult } from "@/domain/projects/project-import";
import {
  formatTaskImportName,
  normalizeTaskImportName,
  type ProjectTaskImportResult,
} from "@/domain/projects/task-import";
import {
  getProjectDataShapePlugins,
  importProjectsWithDataShape,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
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
  return skipped.length > 0
    ? `Imported ${importedLabel}. Skipped ${skipped.join(", ")}.`
    : `Imported ${importedLabel}.`;
}

export function formatSchemaTaskImportSummary(result: ProjectTaskMergeResult) {
  const parts = [];
  if (result.addedTaskCount > 0) {
    parts.push(
      `Imported ${formatCount(result.addedTaskCount, "task", "tasks")}`,
    );
  }
  if (result.updatedTaskCount > 0) {
    parts.push(
      `updated ${formatCount(result.updatedTaskCount, "task", "tasks")}`,
    );
  }
  return parts.length > 0 ? `${parts.join(", ")}.` : "No tasks changed.";
}

/** The schema plugin picked in Settings › Projects, when it is available. */
async function pickedSchemaPlugin() {
  const schemaId = localStore.snapshot().userPreferences.projectDataShapeId;
  if (!schemaId || schemaId === BUILT_IN_PROJECT_DATA_SHAPE_ID) {
    return undefined;
  }
  try {
    return (await getProjectDataShapePlugins()).find(
      (plugin) => plugin.id === schemaId,
    );
  } catch {
    // Without the local API, as in the web build, no schema plugin runs.
    return undefined;
  }
}

/**
 * Imports a workbook's tasks into a project and says what changed. With a
 * schema plugin picked in Settings › Projects, the plugin reads the file and
 * Ajour merges its tasks by name. Otherwise Ajour adds the task names in
 * column C of the first worksheet.
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
    return formatSchemaTaskImportSummary(
      localStore.importProjectDataShapeTasks(projectId, plugin.id, projects),
    );
  }

  const workbook = await extractTaskNamesFromWorkbook(bytes);
  if (workbook.taskNames.length === 0) {
    throw new Error(
      "No usable task names were found in column C of the first worksheet.",
    );
  }
  const result = localStore.importProjectTasks(projectId, workbook.taskNames);
  return formatTaskNameImportSummary({
    ...result,
    blankCount: workbook.blankCount,
    headerCount: workbook.headerCount,
  });
}
