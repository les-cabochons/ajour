import type ExcelJS from "exceljs";
import {
  formatTaskImportName,
  normalizeTaskImportName,
} from "@/domain/projects/task-import";

export {
  formatTaskImportName,
  normalizeTaskImportName,
  type ProjectTaskImportResult,
} from "@/domain/projects/task-import";

const taskImportColumnIndex = 2;
const taskImportHeader = "nom personnalise de la tache";

function toArrayBuffer(workbookBytes: ArrayBuffer | Uint8Array) {
  if (workbookBytes instanceof ArrayBuffer) {
    return workbookBytes.slice(0);
  }

  const normalized = new ArrayBuffer(workbookBytes.byteLength);
  new Uint8Array(normalized).set(workbookBytes);
  return normalized;
}

export async function extractTaskNamesFromWorkbook(
  buffer: ArrayBuffer | Uint8Array,
) {
  let workbook: ExcelJS.Workbook;

  try {
    const ExcelJSModule = await import("exceljs");
    workbook = new ExcelJSModule.default.Workbook();
    await workbook.xlsx.load(toArrayBuffer(buffer));
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message
        ? `Unable to read Excel file: ${error.message}`
        : "Unable to read Excel file.",
    );
  }

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
