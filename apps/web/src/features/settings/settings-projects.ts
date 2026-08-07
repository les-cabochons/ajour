import type ExcelJS from "exceljs";
import {
  BUILT_IN_PROJECT_DATA_SHAPE_ID,
  validateProjectDataShapeDatasets,
  type ProjectDataShapeDataset,
  type ProjectDataShapeDefinition,
  type ProjectDataShapeExportProject,
} from "@timetracker/shared";
import {
  durationHoursValueToMs,
  durationMsToHoursValue,
} from "@/domain/projects/task-budget";
import type { LocalProject } from "@/domain/local-state";
import type {
  ProjectTransferRow,
  ProjectTransferStatus,
} from "@/domain/projects/project-import";
import { formatTaskImportName } from "@/domain/projects/task-import";

export type {
  ProjectTransferRow,
  ProjectTransferStatus,
} from "@/domain/projects/project-import";

interface ProjectTransferOptions {
  projects: LocalProject[];
  projectIds: string[];
}

const workbookMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DEFAULT_PROJECT_DATA_SHAPE_ID = BUILT_IN_PROJECT_DATA_SHAPE_ID;
export const DEFAULT_PROJECT_DATA_SHAPE_DEFINITION = {
  apiVersion: 1,
  datasets: [
    {
      id: "projects",
      displayName: "Projects",
      columns: [
        { key: "project", header: "project", type: "string", required: true, width: 28 },
        { key: "code", header: "code", type: "string", required: false, width: 16 },
        { key: "color", header: "color", type: "string", required: false, width: 14 },
        { key: "status", header: "status", type: "string", required: true, width: 14 },
        { key: "task", header: "task", type: "string", required: false, width: 28 },
        { key: "taskStatus", header: "task_status", type: "string", required: false, width: 16 },
        { key: "billable", header: "billable", type: "string", required: false, width: 16 },
        { key: "budgetHours", header: "budget_hours", type: "number", required: false, width: 16 },
        { key: "adjustmentHours", header: "adjustment_hours", type: "number", required: false, width: 18 },
      ],
    },
  ],
} satisfies ProjectDataShapeDefinition;

function toArrayBuffer(workbookBytes: ArrayBuffer | Uint8Array) {
  if (workbookBytes instanceof ArrayBuffer) {
    return workbookBytes.slice(0);
  }

  const normalized = new ArrayBuffer(workbookBytes.byteLength);
  new Uint8Array(normalized).set(workbookBytes);
  return normalized;
}

function normalizeImportHeader(value: unknown) {
  return formatTaskImportName(String(value ?? ""))
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function normalizeImportCell(value: unknown) {
  return formatTaskImportName(String(value ?? ""));
}

function workbookCellValue(value: ExcelJS.CellValue): string | number | boolean | null {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object" && "result" in value) {
    const result = value.result;
    if (
      result === null ||
      typeof result === "string" ||
      typeof result === "number" ||
      typeof result === "boolean"
    ) {
      return result;
    }
  }

  return String(value ?? "");
}

function normalizeHoursValue(
  value: unknown,
  options?: { allowBlank?: boolean },
): number | "" {
  if (value === null || value === undefined || value === "") {
    return options?.allowBlank ? "" : 0;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Duration hours must be a finite number.");
    }

    return value;
  }

  const normalized = normalizeImportCell(value).replace(",", ".");
  if (!normalized) {
    return options?.allowBlank ? "" : 0;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid duration hours "${normalized}".`);
  }

  return parsed;
}

function normalizeBillableValue(
  value: unknown,
  options?: { allowBlank?: boolean },
): "billable" | "non_billable" | "" {
  const normalized = normalizeImportCell(value).toLowerCase().replace(/\s+/g, "_");
  if (!normalized) {
    return options?.allowBlank ? "" : "billable";
  }

  if (
    normalized === "billable" ||
    normalized === "true" ||
    normalized === "yes"
  ) {
    return "billable";
  }

  if (
    normalized === "non_billable" ||
    normalized === "non-billable" ||
    normalized === "false" ||
    normalized === "no"
  ) {
    return "non_billable";
  }

  throw new Error(`Invalid billable value "${normalized}". Expected billable or non_billable.`);
}

function normalizeStatus(
  value: unknown,
  options?: { allowBlank?: boolean; fallback?: ProjectTransferStatus },
): ProjectTransferStatus | "" {
  const normalized = normalizeImportCell(value).toLowerCase();

  if (!normalized) {
    return options?.allowBlank ? "" : (options?.fallback ?? "active");
  }

  if (normalized === "active" || normalized === "archived") {
    return normalized;
  }

  throw new Error(`Invalid status "${normalized}". Expected active or archived.`);
}

export function buildProjectTransferRows({
  projects,
  projectIds,
}: ProjectTransferOptions): ProjectTransferRow[] {
  return projects
    .filter((project) => projectIds.includes(project._id))
    .flatMap<ProjectTransferRow>((project) => {
      if (project.tasks.length === 0) {
        return [
          {
            project: project.name,
            code: project.code ?? "",
            color: project.color,
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
        color: project.color,
        status: project.status,
        task: task.name,
        taskStatus: task.status,
        billable: task.billable === false ? "non_billable" : "billable",
        budgetHours: durationMsToHoursValue(task.budgetMs) ?? "",
        adjustmentHours: durationMsToHoursValue(task.adjustmentMs) ?? "",
      }));
    });
}

export function buildProjectDataShapeExportProjects({
  projects,
  projectIds,
}: ProjectTransferOptions): ProjectDataShapeExportProject[] {
  return projects
    .filter((project) => projectIds.includes(project._id))
    .map((project) => ({
      name: project.name,
      ...(project.code ? { code: project.code } : {}),
      color: project.color,
      status: project.status,
      tasks: project.tasks.map((task) => ({
        name: task.name,
        status: task.status,
        billable: task.billable ?? true,
        ...(task.budgetMs === undefined ? {} : { budgetMs: task.budgetMs }),
        ...(task.adjustmentMs === undefined
          ? {}
          : { adjustmentMs: task.adjustmentMs }),
      })),
    }));
}

const MAX_EXCEL_WORKSHEET_NAME_LENGTH = 31;

function truncateExcelWorksheetName(value: string, maxLength: number): string {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maxLength) {
      break;
    }
    result += character;
  }
  return result;
}

function excelWorksheetNames(
  definition: ProjectDataShapeDefinition,
): string[] {
  const usedNames = new Set<string>();

  return definition.datasets.map((dataset, datasetIndex) => {
    const sanitizedName = dataset.displayName
      .trim()
      .replace(/[\\/*?:[\]]/gu, "_")
      .replace(/[\u0000-\u001f]/gu, "_")
      .replace(/^'+|'+$/gu, "_");
    const baseName = sanitizedName || `Dataset ${datasetIndex + 1}`;
    let suffix = "";
    let occurrence = 1;
    let worksheetName = truncateExcelWorksheetName(
      baseName,
      MAX_EXCEL_WORKSHEET_NAME_LENGTH,
    );

    while (usedNames.has(worksheetName.toLocaleLowerCase())) {
      occurrence += 1;
      suffix = ` (${occurrence})`;
      worksheetName = `${truncateExcelWorksheetName(
        baseName,
        MAX_EXCEL_WORKSHEET_NAME_LENGTH - suffix.length,
      )}${suffix}`;
    }

    usedNames.add(worksheetName.toLocaleLowerCase());
    return worksheetName;
  });
}

export async function createProjectDataShapeWorkbook(
  definition: ProjectDataShapeDefinition,
  datasets: ProjectDataShapeDataset[],
): Promise<ArrayBuffer> {
  const validatedDatasets = validateProjectDataShapeDatasets(
    definition,
    datasets,
  );
  const datasetsById = new Map(
    validatedDatasets.map((dataset) => [dataset.id, dataset] as const),
  );
  const ExcelJSModule = await import("exceljs");
  const workbook = new ExcelJSModule.default.Workbook();
  const worksheetNames = excelWorksheetNames(definition);

  for (const [datasetIndex, datasetDefinition] of definition.datasets.entries()) {
    const dataset = datasetsById.get(datasetDefinition.id)!;
    const sheet = workbook.addWorksheet(worksheetNames[datasetIndex]);
    sheet.columns = datasetDefinition.columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width,
    }));
    for (const row of dataset.rows) {
      sheet.addRow(row);
    }
  }

  const workbookBytes = await workbook.xlsx.writeBuffer();
  return toArrayBuffer(workbookBytes as ArrayBuffer | Uint8Array);
}

export async function parseProjectDataShapeWorkbook(
  buffer: ArrayBuffer | Uint8Array,
  definition: ProjectDataShapeDefinition,
): Promise<ProjectDataShapeDataset[]> {
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

  const worksheetNames = excelWorksheetNames(definition);

  return definition.datasets.map((datasetDefinition, datasetIndex) => {
    const sheet =
      workbook.getWorksheet(worksheetNames[datasetIndex]) ??
      (definition.datasets.length === 1 && datasetIndex === 0
        ? workbook.worksheets[0]
        : undefined);
    if (!sheet) {
      throw new Error(
        `The workbook does not contain the ${datasetDefinition.displayName} sheet.`,
      );
    }

    const actualHeaders = datasetDefinition.columns.map((_, columnIndex) =>
      normalizeImportHeader(sheet.getRow(1).getCell(columnIndex + 1).value),
    );
    const expectedHeaders = datasetDefinition.columns.map((column) =>
      normalizeImportHeader(column.header),
    );
    if (actualHeaders.join("|") !== expectedHeaders.join("|")) {
      throw new Error(
        `The ${datasetDefinition.displayName} sheet must contain the columns ${datasetDefinition.columns
          .map((column) => column.header)
          .join(", ")}.`,
      );
    }

    const rows = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const sheetRow = sheet.getRow(rowNumber);
      const row = Object.fromEntries(
        datasetDefinition.columns.map((column, columnIndex) => [
          column.key,
          workbookCellValue(sheetRow.getCell(columnIndex + 1).value),
        ]),
      );
      rows.push(row);
    }

    return { id: datasetDefinition.id, rows };
  });
}

export async function createProjectTransferWorkbook(options: ProjectTransferOptions): Promise<ArrayBuffer> {
  const rows = buildProjectTransferRows(options);
  return await createProjectDataShapeWorkbook(
    DEFAULT_PROJECT_DATA_SHAPE_DEFINITION,
    [{ id: "projects", rows }],
  );
}

export async function parseProjectTransferWorkbook(
  buffer: ArrayBuffer | Uint8Array,
): Promise<ProjectTransferRow[]> {
  const [dataset] = await parseProjectDataShapeWorkbook(
    buffer,
    DEFAULT_PROJECT_DATA_SHAPE_DEFINITION,
  );

  const rows: ProjectTransferRow[] = [];

  for (const [rowIndex, row] of (dataset?.rows ?? []).entries()) {
    const rowNumber = rowIndex + 2;
    const project = normalizeImportCell(row.project);
    const code = normalizeImportCell(row.code);
    const color = normalizeImportCell(row.color);
    const rawStatus = row.status;
    const task = normalizeImportCell(row.task);
    const rawTaskStatus = row.taskStatus;
    const rawBillable = row.billable;
    const rawBudgetHours = row.budgetHours;
    const rawAdjustmentHours = row.adjustmentHours;

    const isBlankRow =
      !project &&
      !code &&
      !color &&
      !normalizeImportCell(rawStatus) &&
      !task &&
      !normalizeImportCell(rawTaskStatus) &&
      !normalizeImportCell(rawBillable) &&
      (rawBudgetHours === null || rawBudgetHours === "") &&
      (rawAdjustmentHours === null || rawAdjustmentHours === "");
    if (isBlankRow) {
      continue;
    }

    if (!project) {
      throw new Error(`Row ${rowNumber} is invalid. A project name is required.`);
    }

    const status = normalizeStatus(rawStatus, { fallback: "active" }) as ProjectTransferStatus;
    const taskStatus = normalizeStatus(rawTaskStatus, { allowBlank: true });
    const billable = normalizeBillableValue(rawBillable, { allowBlank: true });
    const budgetHours = normalizeHoursValue(rawBudgetHours, { allowBlank: true });
    const adjustmentHours = normalizeHoursValue(rawAdjustmentHours, { allowBlank: true });

    if (!task && taskStatus) {
      throw new Error(`Row ${rowNumber} is invalid. Task status requires a task name.`);
    }

    if (!task && (billable !== "" || budgetHours !== "" || adjustmentHours !== "")) {
      throw new Error(`Row ${rowNumber} is invalid. Billable, budget, or adjustment requires a task name.`);
    }

    rows.push({
      project,
      code,
      color,
      status,
      task,
      taskStatus,
      billable,
      budgetHours,
      adjustmentHours,
    });
  }

  return rows;
}

export function buildProjectTransferFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `projects-${year}-${month}-${day}.xlsx`;
}

function toBlobPart(workbookBytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (workbookBytes instanceof ArrayBuffer) {
    return workbookBytes.slice(0);
  }

  const normalized = new ArrayBuffer(workbookBytes.byteLength);
  new Uint8Array(normalized).set(workbookBytes);
  return normalized;
}

export function downloadProjectTransferWorkbook(workbookBytes: ArrayBuffer | Uint8Array, filename: string) {
  const blob = new Blob([toBlobPart(workbookBytes)], { type: workbookMimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 1000);
}
