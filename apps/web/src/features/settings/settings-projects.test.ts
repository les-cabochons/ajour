import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  buildProjectTransferRows,
  createProjectDataShapeWorkbook,
  createProjectTransferWorkbook,
  parseProjectDataShapeWorkbook,
  parseProjectTransferWorkbook,
} from "./settings-projects";

const projects: LocalProject[] = [
  {
    _id: "project-1",
    name: "Project Mercury",
    code: "MER",
    color: "#123456",
    icon: DEFAULT_PROJECT_ICON,
    status: "active",
    tasks: [
      {
        _id: "task-1",
        name: "Feature Work",
        status: "active",
        createdAt: 1,
        billable: true,
        budgetMs: 2 * 60 * 60 * 1000,
        adjustmentMs: -30 * 60 * 1000,
      },
      {
        _id: "task-2",
        name: "Archive Me",
        status: "archived",
        createdAt: 2,
        archivedAt: 3,
        billable: false,
      },
    ],
  },
  {
    _id: "project-2",
    name: "Project Gemini",
    color: "#654321",
    icon: DEFAULT_PROJECT_ICON,
    status: "archived",
    tasks: [],
  },
];

describe("buildProjectTransferRows", () => {
  it("flattens selected projects into repeated project rows and preserves taskless projects", () => {
    expect(
      buildProjectTransferRows({
        projects,
        projectIds: ["project-1", "project-2"],
      }),
    ).toEqual([
      {
        project: "Project Mercury",
        code: "MER",
        color: "#123456",
        status: "active",
        task: "Feature Work",
        taskStatus: "active",
        billable: "billable",
        budgetHours: 2,
        adjustmentHours: -0.5,
      },
      {
        project: "Project Mercury",
        code: "MER",
        color: "#123456",
        status: "active",
        task: "Archive Me",
        taskStatus: "archived",
        billable: "non_billable",
        budgetHours: "",
        adjustmentHours: "",
      },
      {
        project: "Project Gemini",
        code: "",
        color: "#654321",
        status: "archived",
        task: "",
        taskStatus: "",
        billable: "",
        budgetHours: "",
        adjustmentHours: "",
      },
    ]);
  });

});

describe("project workbook round-trip", () => {
  it("derives valid, stable Excel sheet names from format-neutral dataset labels", async () => {
    const definition = {
      apiVersion: 1 as const,
      datasets: [
        {
          id: "first",
          displayName: "A very long/provider:dataset?name*that exceeds Excel",
          columns: [
            {
              key: "value",
              header: "value",
              type: "string" as const,
              required: false,
            },
          ],
        },
        {
          id: "second",
          displayName: "A very long/provider:dataset?name*that exceeds Excel",
          columns: [
            {
              key: "value",
              header: "value",
              type: "string" as const,
              required: false,
            },
          ],
        },
      ],
    };
    const datasets = [
      { id: "first", rows: [{ value: "one" }] },
      { id: "second", rows: [{ value: "two" }] },
    ];

    const workbookBytes = await createProjectDataShapeWorkbook(
      definition,
      datasets,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBytes);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "A very long_provider_dataset_na",
      "A very long_provider_datase (2)",
    ]);
    await expect(
      parseProjectDataShapeWorkbook(workbookBytes, definition),
    ).resolves.toEqual(datasets);
  });

  it("writes and re-parses the shared project import/export workbook shape", async () => {
    const workbookBytes = await createProjectTransferWorkbook({
      projects,
      projectIds: ["project-1", "project-2"],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Projects"]);

    const sheet = workbook.getWorksheet("Projects");
    expect(sheet).toBeTruthy();

    const rows: unknown[][] = [];
    for (let rowNumber = 1; rowNumber <= sheet!.rowCount; rowNumber += 1) {
      const row = sheet!.getRow(rowNumber);
      rows.push(
        Array.from({ length: 9 }, (_, index) => {
          const cellIndex = index + 1;
          const value = row.getCell(cellIndex).value;
          return value ?? "";
        }),
      );
    }

    expect(rows).toEqual([
      [
        "project",
        "code",
        "color",
        "status",
        "task",
        "task_status",
        "billable",
        "budget_hours",
        "adjustment_hours",
      ],
      [
        "Project Mercury",
        "MER",
        "#123456",
        "active",
        "Feature Work",
        "active",
        "billable",
        2,
        -0.5,
      ],
      [
        "Project Mercury",
        "MER",
        "#123456",
        "active",
        "Archive Me",
        "archived",
        "non_billable",
        "",
        "",
      ],
      ["Project Gemini", "", "#654321", "archived", "", "", "", "", ""],
    ]);

    await expect(parseProjectTransferWorkbook(workbookBytes)).resolves.toEqual([
      {
        project: "Project Mercury",
        code: "MER",
        color: "#123456",
        status: "active",
        task: "Feature Work",
        taskStatus: "active",
        billable: "billable",
        budgetHours: 2,
        adjustmentHours: -0.5,
      },
      {
        project: "Project Mercury",
        code: "MER",
        color: "#123456",
        status: "active",
        task: "Archive Me",
        taskStatus: "archived",
        billable: "non_billable",
        budgetHours: "",
        adjustmentHours: "",
      },
      {
        project: "Project Gemini",
        code: "",
        color: "#654321",
        status: "archived",
        task: "",
        taskStatus: "",
        billable: "",
        budgetHours: "",
        adjustmentHours: "",
      },
    ]);
  });

  it("keeps source row numbers accurate when blank rows are present", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Projects");
    sheet.addRow([
      "project",
      "code",
      "color",
      "status",
      "task",
      "task_status",
      "billable",
      "budget_hours",
      "adjustment_hours",
    ]);
    sheet.addRow([]);
    sheet.addRow(["", "", "", "active", "Feature Work"]);

    await expect(
      parseProjectTransferWorkbook(await workbook.xlsx.writeBuffer()),
    ).rejects.toThrow("Row 3 is invalid. A project name is required.");
  });
});
