import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

describe("spreadsheet libraries", () => {
  it("round-trips an XLSX workbook with SheetJS", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      { imei: "123456789012345", device: "FMC 003" },
    ]);

    XLSX.utils.book_append_sheet(workbook, sheet, "Stock");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const parsed = XLSX.read(bytes, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(parsed.Sheets.Stock);

    expect(rows).toEqual([
      { imei: "123456789012345", device: "FMC 003" },
    ]);
  });

  it("writes an ExcelJS workbook with the patched UUID dependency", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Count");
    sheet.addRow(["Device", "Quantity"]);
    sheet.addRow(["FMC 003", 2]);

    const bytes = await workbook.xlsx.writeBuffer();

    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
