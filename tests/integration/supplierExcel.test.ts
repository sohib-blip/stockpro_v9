import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseSupplierExcel } from "../../lib/excelImport";

function workbook(rows: unknown[][]) {
  const value = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(value, XLSX.utils.aoa_to_sheet(rows), "Stock");
  return Buffer.from(XLSX.write(value, { type: "buffer", bookType: "xlsx" }));
}

describe("generic supplier spreadsheet integration", () => {
  it("detects a preambled sheet and normalizes valid operational rows", () => {
    const result = parseSupplierExcel(
      workbook([
        ["Supplier delivery 2026"],
        ["Device Model", "Box Number", "IMEI"],
        ["FMC130-REV2", "025-36", "123 456 789 012 345"],
        ["FMC130-REV2", "025-36", "123456789012346.0"],
        ["FMB920", "22060", "223456789012345"],
      ])
    );

    expect(result.headerRowIdx).toBe(1);
    expect(result.columns).toEqual({ deviceCol: 0, boxCol: 1, imeiCol: 2 });
    expect(result.parsed).toEqual([
      {
        rowNumber: 3,
        device_raw: "FMC130-REV2",
        device: "FMC130",
        box_no: "025-36",
        imei: "123456789012345",
      },
      {
        rowNumber: 4,
        device_raw: "FMC130-REV2",
        device: "FMC130",
        box_no: "025-36",
        imei: "123456789012346",
      },
      {
        rowNumber: 5,
        device_raw: "FMB920",
        device: "FMB920",
        box_no: "22060",
        imei: "223456789012345",
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.boxes).toEqual([
      { box_no: "025-36", device: "FMC130", qty: 2 },
      { box_no: "22060", device: "FMB920", qty: 1 },
    ]);
  });

  it("reports missing, invalid, duplicate and mixed-device rows without inflating box totals", () => {
    const result = parseSupplierExcel(
      workbook([
        ["Device", "Box", "IMEI"],
        ["FMC130", "BOX123", "323456789012345"],
        ["FMC130", "BOX123", "323456789012345"],
        ["FMB920", "BOX123", "short"],
        ["", "", ""],
        ["FMC130", "", "423456789012345"],
      ])
    );

    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Duplicate IMEI in file: 323456789012345",
        "Box BOX123 has multiple devices (FMC130 vs FMB920)",
        "Missing IMEI",
        "Missing box number",
      ])
    );
    expect(result.boxes).toEqual([
      { box_no: "BOX123", device: "FMC130", qty: 1 },
    ]);
  });
});
