import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalProject, LocalTimesheetEntry } from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  buildTimesheetExportRows,
  detectTimesheetImportConflicts,
  createTimesheetExportWorkbook,
  parseTimesheetImportWorkbook,
  downloadWorkbookFile,
} from "./settings-export";

const projects: LocalProject[] = [
  {
    _id: "project-1",
    name: "Project Mercury",
    color: "#123456",
    icon: DEFAULT_PROJECT_ICON,
    status: "active",
    tasks: [
      {
        _id: "task-1",
        name: "Feature Work",
        status: "active",
        createdAt: 1,
      },
    ],
  },
  {
    _id: "project-2",
    name: "Project Gemini",
    color: "#654321",
    icon: DEFAULT_PROJECT_ICON,
    status: "active",
    tasks: [],
  },
];

const entries: LocalTimesheetEntry[] = [
  {
    _id: "entry-1",
    localDate: "2026-04-10",
    projectId: "project-1",
    taskId: "task-1",
    label: "Feature Work",
    note: "Polish export UX",
    durationMs: 90 * 60 * 1000,
    sourceBlockIds: [],
    committedAt: 2,
  },
  {
    _id: "entry-2",
    localDate: "2026-04-11",
    projectId: "project-2",
    label: "Internal work",
    note: "",
    durationMs: 45 * 60 * 1000,
    sourceBlockIds: [],
    committedAt: 3,
  },
  {
    _id: "entry-3",
    localDate: "2026-04-12",
    projectId: "missing-project",
    label: "Ignored",
    note: "Outside selected range",
    durationMs: 30 * 60 * 1000,
    sourceBlockIds: [],
    committedAt: 1,
  },
];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function toArrayBuffer(workbookBytes: ArrayBuffer | Uint8Array) {
  if (workbookBytes instanceof ArrayBuffer) {
    return workbookBytes.slice(0);
  }

  const normalized = new ArrayBuffer(workbookBytes.byteLength);
  new Uint8Array(normalized).set(workbookBytes);
  return normalized;
}

function getUint16(bytes: Uint8Array, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function getUint32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function findZipEntry(
  workbookBytes: ArrayBuffer | Uint8Array,
  entryName: string,
) {
  const bytes = new Uint8Array(toArrayBuffer(workbookBytes));
  const decoder = new TextDecoder();

  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (getUint32(bytes, offset) !== 0x02014b50) {
      continue;
    }

    const compressionMethod = getUint16(bytes, offset + 10);
    const compressedSize = getUint32(bytes, offset + 20);
    const fileNameLength = getUint16(bytes, offset + 28);
    const extraLength = getUint16(bytes, offset + 30);
    const commentLength = getUint16(bytes, offset + 32);
    const localHeaderOffset = getUint32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd));

    if (name !== entryName) {
      offset = nameEnd + extraLength + commentLength - 1;
      continue;
    }

    if (getUint32(bytes, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid local file header for ${entryName}.`);
    }

    const localNameLength = getUint16(bytes, localHeaderOffset + 26);
    const localExtraLength = getUint16(bytes, localHeaderOffset + 28);
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      return compressed;
    }

    if (compressionMethod === 8) {
      return inflateRawSync(compressed);
    }

    throw new Error(
      `Unsupported zip compression method ${compressionMethod} for ${entryName}.`,
    );
  }

  return null;
}

async function readWorkbookRows(
  workbookBytes: ArrayBuffer | Uint8Array,
  sheetName: string,
  columnCount: number,
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toArrayBuffer(workbookBytes));
  const sheet = workbook.getWorksheet(sheetName);

  if (!sheet) {
    throw new Error(`Worksheet ${sheetName} was not found.`);
  }

  const rows: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    rows.push(
      Array.from({ length: columnCount }, (_, index) => {
        const value = row.getCell(index + 1).value;
        return value ?? "";
      }),
    );
  }

  return {
    sheetNames: workbook.worksheets.map((sheet) => sheet.name),
    rows,
  };
}

describe("buildTimesheetExportRows", () => {
  it("filters by date range and resolves project and task names", () => {
    expect(
      buildTimesheetExportRows({
        entries,
        projects,
        startDate: "2026-04-10",
        endDate: "2026-04-11",
      }),
    ).toEqual([
      {
        date: "2026-04-10",
        project: "Project Mercury",
        task: "Feature Work",
        note: "Polish export UX",
        hours: 1.5,
      },
      {
        date: "2026-04-11",
        project: "Project Gemini",
        task: "",
        note: "",
        hours: 0.75,
      },
    ]);
  });
});

describe("createTimesheetExportWorkbook", () => {
  it("creates an xlsx workbook with the requested columns in order", async () => {
    const workbookBytes = await createTimesheetExportWorkbook({
      entries,
      projects,
      startDate: "2026-04-10",
      endDate: "2026-04-11",
    });

    const { sheetNames, rows } = await readWorkbookRows(
      workbookBytes,
      "Time Logs",
      5,
    );

    expect(sheetNames).toEqual(["Time Logs"]);
    expect(rows).toEqual([
      ["date", "project", "task", "note", "hours"],
      [
        "2026-04-10",
        "Project Mercury",
        "Feature Work",
        "Polish export UX",
        1.5,
      ],
      ["2026-04-11", "Project Gemini", "", "", 0.75],
    ]);
  });

  it("does not include the orphaned metadata parts that triggered Excel repair warnings", async () => {
    const workbookBytes = await createTimesheetExportWorkbook({
      entries,
      projects,
      startDate: "2026-04-10",
      endDate: "2026-04-11",
    });

    expect(findZipEntry(workbookBytes, "xl/metadata.xml")).toBeNull();

    const workbookRels = findZipEntry(
      workbookBytes,
      "xl/_rels/workbook.xml.rels",
    );
    expect(workbookRels).toBeTruthy();
    expect(new TextDecoder().decode(workbookRels!)).not.toContain(
      "sheetMetadata",
    );

    const contentTypes = findZipEntry(workbookBytes, "[Content_Types].xml");
    expect(contentTypes).toBeTruthy();
    expect(new TextDecoder().decode(contentTypes!)).not.toContain(
      "/xl/metadata.xml",
    );
  });
});

describe("parseTimesheetImportWorkbook", () => {
  it("parses workbook rows from the Time Logs sheet", async () => {
    const workbookBytes = await createTimesheetExportWorkbook({
      entries,
      projects,
      startDate: "2026-04-10",
      endDate: "2026-04-11",
    });

    await expect(parseTimesheetImportWorkbook(workbookBytes)).resolves.toEqual([
      {
        date: "2026-04-10",
        project: "Project Mercury",
        task: "Feature Work",
        note: "Polish export UX",
        hours: 1.5,
      },
      {
        date: "2026-04-11",
        project: "Project Gemini",
        task: "",
        note: "",
        hours: 0.75,
      },
    ]);
  });

  it("parses exported rows that do not have an assigned project or task", async () => {
    const workbookBytes = await createTimesheetExportWorkbook({
      entries,
      projects,
      startDate: "2026-04-12",
      endDate: "2026-04-12",
    });

    await expect(parseTimesheetImportWorkbook(workbookBytes)).resolves.toEqual([
      {
        date: "2026-04-12",
        project: "",
        task: "",
        note: "Outside selected range",
        hours: 0.5,
      },
    ]);
  });

  it("fails when the workbook does not expose the expected columns", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Time Logs");
    sheet.addRows([
      ["foo", "bar"],
      ["2026-04-10", "Project Mercury"],
    ]);
    const workbookBytes = await workbook.xlsx.writeBuffer();

    await expect(parseTimesheetImportWorkbook(workbookBytes)).rejects.toThrow(
      "The Time Logs sheet must contain the columns date, project, task, note, and hours.",
    );
  });
});

describe("detectTimesheetImportConflicts", () => {
  it("flags potential conflicts when date, project, and task already exist", () => {
    expect(
      detectTimesheetImportConflicts({
        rows: [
          {
            date: "2026-04-10",
            project: "Project Mercury",
            task: "Feature Work",
            note: "Imported note",
            hours: 2,
          },
          {
            date: "2026-04-11",
            project: "Project Gemini",
            task: "",
            note: "",
            hours: 1,
          },
        ],
        entries,
        projects,
      }).map((row) => row.potentialConflict),
    ).toEqual([true, true]);
  });
});

describe("downloadWorkbookFile", () => {
  it("waits until after the click before revoking the object url", () => {
    vi.useFakeTimers();

    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const createObjectURL = vi.fn(() => "blob:timelogs");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        click,
        remove,
        href: "",
        download: "",
      })),
      body: {
        appendChild,
      },
    });
    vi.stubGlobal("window", {
      URL: {
        createObjectURL,
        revokeObjectURL,
      },
      setTimeout,
    });
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        parts: unknown[];
        options?: BlobPropertyBag;

        constructor(parts: unknown[], options?: BlobPropertyBag) {
          this.parts = parts;
          this.options = options;
        }
      },
    );

    downloadWorkbookFile(new Uint8Array([1, 2, 3]), "timelogs.xlsx");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:timelogs");
  });
});
