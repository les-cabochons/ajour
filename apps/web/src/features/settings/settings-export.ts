import type ExcelJS from "exceljs";
import type { LocalProject, LocalTimesheetEntry } from "@/domain/local-state";
import {
  formatTaskImportName,
  normalizeTaskImportName,
} from "@/domain/projects/task-import";

export interface TimesheetExportRow {
  date: string;
  project: string;
  task: string;
  note: string;
  hours: number;
}

export interface TimesheetImportRow {
  date: string;
  project: string;
  task: string;
  note: string;
  hours: number;
}

export interface TimesheetImportReviewRow extends TimesheetImportRow {
  potentialConflict: boolean;
}

interface TimesheetExportOptions {
  entries: LocalTimesheetEntry[];
  projects: LocalProject[];
  startDate: string;
  endDate: string;
}

const workbookMimeType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const expectedImportHeaders = [
  "date",
  "project",
  "task",
  "note",
  "hours",
] as const;

function roundDecimalHours(durationMs: number) {
  return Math.round((durationMs / (60 * 60 * 1000)) * 100) / 100;
}

function resolveProject(projects: LocalProject[], projectId?: string) {
  return projects.find((project) => project._id === projectId);
}

function normalizeImportCell(value: unknown) {
  return formatTaskImportName(String(value ?? ""));
}

function normalizeImportKey(values: {
  date: string;
  project: string;
  task: string;
}) {
  return [
    values.date.trim(),
    normalizeTaskImportName(values.project),
    normalizeTaskImportName(values.task),
  ].join("::");
}

export function buildTimesheetExportRows({
  entries,
  projects,
  startDate,
  endDate,
}: TimesheetExportOptions): TimesheetExportRow[] {
  return [...entries]
    .filter(
      (entry) => entry.localDate >= startDate && entry.localDate <= endDate,
    )
    .sort((left, right) => {
      if (left.localDate !== right.localDate) {
        return left.localDate.localeCompare(right.localDate);
      }

      if (left.committedAt !== right.committedAt) {
        return left.committedAt - right.committedAt;
      }

      return left._id.localeCompare(right._id);
    })
    .map((entry) => {
      const project = resolveProject(projects, entry.projectId);
      const task = project?.tasks.find((item) => item._id === entry.taskId);

      return {
        date: entry.localDate,
        project: project?.name ?? "",
        task: task?.name ?? "",
        note: entry.note ?? "",
        hours: roundDecimalHours(entry.durationMs),
      };
    });
}

export async function parseTimesheetImportWorkbook(
  buffer: ArrayBuffer | Uint8Array,
): Promise<TimesheetImportRow[]> {
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

  const sheet = workbook.getWorksheet("Time Logs") ?? workbook.worksheets[0];
  if (!sheet) {
    throw new Error("The workbook does not contain any worksheets.");
  }

  const headerRow = sheet.getRow(1);
  const headers = expectedImportHeaders.map((_, index) =>
    normalizeImportCell(headerRow.getCell(index + 1).value),
  );
  if (headers.join("|") !== expectedImportHeaders.join("|")) {
    throw new Error(
      "The Time Logs sheet must contain the columns date, project, task, note, and hours.",
    );
  }

  const rows: TimesheetImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const date = normalizeImportCell(row.getCell(1).value);
    const project = normalizeImportCell(row.getCell(2).value);
    const task = normalizeImportCell(row.getCell(3).value);
    const note = String(row.getCell(4).value ?? "").trim();
    const hoursValue = row.getCell(5).value;
    const hours =
      typeof hoursValue === "number"
        ? hoursValue
        : Number(String(hoursValue ?? "").trim());

    const isBlankRow =
      !date &&
      !project &&
      !task &&
      !note &&
      (!Number.isFinite(hours) || hours === 0);
    if (isBlankRow) {
      continue;
    }

    if (!date || !Number.isFinite(hours) || hours <= 0 || (!project && task)) {
      throw new Error(
        `Row ${rowNumber} is invalid. Date and a positive hours value are required. A task also requires a project.`,
      );
    }

    rows.push({
      date,
      project,
      task,
      note,
      hours: Math.round(hours * 100) / 100,
    });
  }

  return rows;
}

export function detectTimesheetImportConflicts(options: {
  rows: TimesheetImportRow[];
  entries: LocalTimesheetEntry[];
  projects: LocalProject[];
}): TimesheetImportReviewRow[] {
  const existingKeys = new Set(
    options.entries.map((entry) => {
      const project = resolveProject(options.projects, entry.projectId);
      const task = project?.tasks.find((item) => item._id === entry.taskId);
      return normalizeImportKey({
        date: entry.localDate,
        project: project?.name ?? "",
        task: task?.name ?? "",
      });
    }),
  );

  return options.rows.map((row) => ({
    ...row,
    potentialConflict: existingKeys.has(
      normalizeImportKey({
        date: row.date,
        project: row.project,
        task: row.task,
      }),
    ),
  }));
}

function toArrayBuffer(workbookBytes: ArrayBuffer | Uint8Array) {
  if (workbookBytes instanceof ArrayBuffer) {
    return workbookBytes.slice(0);
  }

  const normalized = new ArrayBuffer(workbookBytes.byteLength);
  new Uint8Array(normalized).set(workbookBytes);
  return normalized;
}

export async function createTimesheetExportWorkbook(
  options: TimesheetExportOptions,
): Promise<ArrayBuffer> {
  const rows = buildTimesheetExportRows(options);
  const ExcelJSModule = await import("exceljs");
  const workbook = new ExcelJSModule.default.Workbook();
  const sheet = workbook.addWorksheet("Time Logs");

  sheet.columns = [
    { header: "date", key: "date", width: 12 },
    { header: "project", key: "project", width: 24 },
    { header: "task", key: "task", width: 24 },
    { header: "note", key: "note", width: 36 },
    { header: "hours", key: "hours", width: 12, style: { numFmt: "0.00" } },
  ];

  for (const row of rows) {
    sheet.addRow(row);
  }

  const workbookBytes = await workbook.xlsx.writeBuffer();
  return toArrayBuffer(workbookBytes as ArrayBuffer | Uint8Array);
}

export function buildTimesheetExportFilename(
  startDate: string,
  endDate: string,
) {
  return startDate === endDate
    ? `timelogs-${startDate}.xlsx`
    : `timelogs-${startDate}-to-${endDate}.xlsx`;
}

function toBlobPart(workbookBytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (workbookBytes instanceof ArrayBuffer) {
    return workbookBytes.slice(0);
  }

  const normalized = new ArrayBuffer(workbookBytes.byteLength);
  new Uint8Array(normalized).set(workbookBytes);
  return normalized;
}

export function downloadWorkbookFile(
  workbookBytes: ArrayBuffer | Uint8Array,
  filename: string,
) {
  const blob = new Blob([toBlobPart(workbookBytes)], {
    type: workbookMimeType,
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Safari can invalidate the download if the blob URL is revoked synchronously.
  window.setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 1000);
}
