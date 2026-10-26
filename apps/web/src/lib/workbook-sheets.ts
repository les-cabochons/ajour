import type ExcelJS from "exceljs";
import {
  PROJECT_DATA_SHAPE_IMPORT_LIMITS,
  type ProjectDataShapeCell,
  type ProjectDataShapeSheet,
} from "@ajour/shared";

/** The bytes in an ArrayBuffer of their own, as ExcelJS and Blob take them. */
export function toWorkbookArrayBuffer(
  bytes: ArrayBuffer | Uint8Array,
): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes.slice(0);
  }

  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Opens an Excel workbook, or fails with a message the user can read. */
export async function loadWorkbook(
  bytes: ArrayBuffer | Uint8Array,
): Promise<ExcelJS.Workbook> {
  try {
    const ExcelJSModule = await import("exceljs");
    const workbook = new ExcelJSModule.default.Workbook();
    await workbook.xlsx.load(toWorkbookArrayBuffer(bytes));
    return workbook;
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message
        ? `Unable to read Excel file: ${error.message}`
        : "Unable to read Excel file.",
    );
  }
}

/**
 * A cell's value as plain data. A date becomes ISO 8601 text, a formula its
 * cached result, rich text and a link their text, and an error its code,
 * such as `#N/A`. A number that isn't finite counts as no value.
 */
export function workbookCellValue(
  value: ExcelJS.CellValue | undefined,
): ProjectDataShapeCell {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if ("richText" in value) {
    return value.richText.map((run) => run.text).join("");
  }
  if ("hyperlink" in value) {
    return workbookCellValue(value.text);
  }
  if ("error" in value) {
    return value.error;
  }
  if ("result" in value) {
    return workbookCellValue(value.result as ExcelJS.CellValue | undefined);
  }
  if ("formula" in value || "sharedFormula" in value) {
    // A formula Excel never calculated holds no result.
    return null;
  }
  return String(value);
}

/**
 * Reads every worksheet into rows of cells, for a schema plugin to map.
 * Row `n` of the sheet is `rows[n - 1]`. Each row runs from column A to its
 * last value, and the sheet stops at its last row with a value.
 */
export async function readWorkbookSheets(
  bytes: ArrayBuffer | Uint8Array,
): Promise<ProjectDataShapeSheet[]> {
  const workbook = await loadWorkbook(bytes);
  const limits = PROJECT_DATA_SHAPE_IMPORT_LIMITS;
  if (workbook.worksheets.length === 0) {
    throw new Error("The workbook does not contain any worksheets.");
  }
  if (workbook.worksheets.length > limits.sheets) {
    throw new Error(`The workbook has more than ${limits.sheets} worksheets.`);
  }

  return workbook.worksheets.map((sheet) => {
    if (sheet.rowCount > limits.rows) {
      throw new Error(
        `The ${sheet.name} sheet has more than ${limits.rows} rows.`,
      );
    }

    const rows: ProjectDataShapeCell[][] = [];
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const sheetRow = sheet.getRow(rowNumber);
      const cells: ProjectDataShapeCell[] = [];
      for (
        let columnNumber = 1;
        columnNumber <= sheetRow.cellCount;
        columnNumber += 1
      ) {
        cells.push(workbookCellValue(sheetRow.getCell(columnNumber).value));
      }
      while (cells.length > 0 && cells.at(-1) === null) {
        cells.pop();
      }
      if (cells.length > limits.cells) {
        throw new Error(
          `Row ${rowNumber} of the ${sheet.name} sheet has more than ${limits.cells} cells.`,
        );
      }
      rows.push(cells);
    }
    while (rows.length > 0 && rows.at(-1)!.length === 0) {
      rows.pop();
    }

    return { name: sheet.name, rows };
  });
}
