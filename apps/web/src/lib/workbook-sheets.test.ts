import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readWorkbookSheets } from "./workbook-sheets";

describe("readWorkbookSheets", () => {
  it("reads every sheet as rows of plain cells, keeping row numbers", async () => {
    const workbook = new ExcelJS.Workbook();
    const summary = workbook.addWorksheet("Récapitulatif");
    summary.getCell("A1").value = "Nom du projet";
    summary.getCell("B1").value = "Mercury";
    // Row 2 stays blank: row 3 must still be rows[2].
    summary.getCell("A3").value = "Date de début";
    summary.getCell("B3").value = new Date(Date.UTC(2026, 5, 1));
    summary.getCell("A4").value = {
      richText: [
        { text: "Heures " },
        { font: { bold: true }, text: "prévues" },
      ],
    };
    summary.getCell("B4").value = { formula: "1+1", result: 2 };
    summary.getCell("C4").value = {
      formula: "1/0",
      result: { error: "#DIV/0!" },
    };
    summary.getCell("A5").value = {
      text: "Workday",
      hyperlink: "https://example.com",
    };
    summary.getCell("B5").value = true;
    summary.getCell("D5").value = null;
    workbook.addWorksheet("Vide");
    const tasks = workbook.addWorksheet("Tâches");
    tasks.addRow(["Phase", "Tâche"]);
    tasks.addRow(["Support", "Billet 101"]);

    const sheets = await readWorkbookSheets(
      (await workbook.xlsx.writeBuffer()) as ArrayBuffer,
    );

    expect(sheets).toEqual([
      {
        name: "Récapitulatif",
        rows: [
          ["Nom du projet", "Mercury"],
          [],
          ["Date de début", "2026-06-01T00:00:00.000Z"],
          ["Heures prévues", 2, "#DIV/0!"],
          ["Workday", true],
        ],
      },
      { name: "Vide", rows: [] },
      {
        name: "Tâches",
        rows: [
          ["Phase", "Tâche"],
          ["Support", "Billet 101"],
        ],
      },
    ]);
  });

  it("says when the file isn't a workbook", async () => {
    await expect(
      readWorkbookSheets(new TextEncoder().encode("not a workbook")),
    ).rejects.toThrow("Unable to read Excel file");
  });
});
