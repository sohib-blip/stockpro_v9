import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildAccessoryExportSheets,
  buildAccessoryExportWorkbook,
} from "../../lib/accessory-export";

const accessories = [
  { name: "BUZZER\t4", category: "Items", current_stock: 46, minimum_stock: 5, active: true },
  { name: "WIPE\tTBD011", category: "Consumables", current_stock: 50, minimum_stock: 10, active: true },
  { name: "Old cable", category: null, current_stock: 3, minimum_stock: 0, active: false },
  { name: "CV200 Bullet Camera", category: "Vision", current_stock: 0, minimum_stock: 2, active: true },
];

const packaging = [
  {
    code: "TBD012",
    name: "Normal Box A",
    category: "BOX" as const,
    length_cm: 23,
    width_cm: 19,
    height_cm: 12,
    on_hand_stock: 260,
    reserved_stock: 10,
    minimum_stock: 100,
    active: true,
  },
  {
    code: "PCR25B",
    name: "Small Plastic Envelope",
    category: "PLASTIC_ENVELOPE" as const,
    length_cm: 24,
    width_cm: 35,
    height_cm: 0.1,
    on_hand_stock: 0,
    reserved_stock: 0,
    minimum_stock: 0,
    active: false,
  },
];

describe("accessory export", () => {
  it("writes one sheet per category, then packaging", () => {
    const sheets = buildAccessoryExportSheets(accessories, packaging);
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "Consumables",
      "Vision",
      "Harness",
      "Items",
      "Packaging",
      "Other",
    ]);

    const byName = Object.fromEntries(sheets.map((sheet) => [sheet.name, sheet.rows]));
    expect(byName.Consumables).toEqual([
      ["Accessory", "Stock", "Minimum stock", "Status"],
      ["WIPE\tTBD011", 50, 10, "SHOW"],
    ]);
    expect(byName.Items).toEqual([
      ["Accessory", "Stock", "Minimum stock", "Status"],
      ["BUZZER\t4", 46, 5, "SHOW"],
    ]);
    // Empty categories keep their header row.
    expect(byName.Harness).toEqual([["Accessory", "Stock", "Minimum stock", "Status"]]);
    // Accessories without a known category are never dropped.
    expect(byName.Other).toEqual([
      ["Accessory", "Stock", "Minimum stock", "Status"],
      ["Old cable", 3, 0, "HIDE"],
    ]);
  });

  it("lists packaging stock like Packaging Inventory", () => {
    const rows = buildAccessoryExportSheets([], packaging).find(
      (sheet) => sheet.name === "Packaging"
    )!.rows;
    expect(rows).toEqual([
      ["Name", "Code", "Type", "Dimensions", "On hand", "Reserved", "Available", "Minimum stock", "Status"],
      ["Normal Box A", "TBD012", "Box", "23 × 19 × 12 cm", 260, 10, 250, 100, "OK"],
      ["Small Plastic Envelope", "PCR25B", "Plastic Envelope", "24 × 35 × 0.1 cm", 0, 0, 0, 0, "INACTIVE"],
    ]);
  });

  it("omits the Other sheet when every accessory has a category", () => {
    const names = buildAccessoryExportSheets(accessories.slice(0, 2), []).map((sheet) => sheet.name);
    expect(names).toEqual(["Consumables", "Vision", "Harness", "Items", "Packaging"]);
  });

  it("builds a readable workbook", () => {
    const workbook = XLSX.read(
      XLSX.write(buildAccessoryExportWorkbook(buildAccessoryExportSheets(accessories, packaging)), {
        type: "buffer",
        bookType: "xlsx",
      }),
      { type: "buffer" }
    );
    expect(workbook.SheetNames).toEqual(["Consumables", "Vision", "Harness", "Items", "Packaging", "Other"]);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Vision)).toEqual([
      { Accessory: "CV200 Bullet Camera", Stock: 0, "Minimum stock": 2, Status: "SHOW" },
    ]);
  });
});
