import * as XLSX from "xlsx";
import { ACCESSORY_CATEGORIES } from "./accessory-bin-input";
import {
  formatPackagingDimensions,
  packagingAvailableStock,
  packagingCategoryLabel,
  packagingStockStatus,
  type PackagingCategory,
} from "./packaging";

// Accessory export: one worksheet per accessory category, then the packaging
// inventory. Every sheet keeps its header row even when it has no rows, so
// the workbook always has the same layout.

export type AccessoryExportRow = {
  name: string;
  category: string | null;
  current_stock: number | null;
  minimum_stock: number | null;
  active: boolean | null;
};

export type PackagingExportRow = {
  code: string;
  name: string;
  category: PackagingCategory;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  on_hand_stock: number | null;
  reserved_stock: number | null;
  minimum_stock: number | null;
  active: boolean | null;
};

export type ExportSheet = {
  name: string;
  rows: Array<Array<string | number>>;
};

// Sheet order asked for by the warehouse; it differs from the form order.
export const ACCESSORY_EXPORT_SHEETS = ["Consumables", "Vision", "Harness", "Items"] as const;
const OTHER_SHEET = "Other";

const ACCESSORY_HEADER = ["Accessory", "Stock", "Minimum stock", "Status"];
const PACKAGING_HEADER = [
  "Name",
  "Code",
  "Type",
  "Dimensions",
  "On hand",
  "Reserved",
  "Available",
  "Minimum stock",
  "Status",
];

function accessorySheetName(category: string | null) {
  return (ACCESSORY_CATEGORIES as readonly string[]).includes(category ?? "")
    ? String(category)
    : OTHER_SHEET;
}

export function buildAccessoryExportSheets(
  accessories: AccessoryExportRow[],
  packaging: PackagingExportRow[]
): ExportSheet[] {
  const byCategory = new Map<string, ExportSheet["rows"]>();
  for (const accessory of accessories) {
    const sheet = accessorySheetName(accessory.category);
    const rows = byCategory.get(sheet) ?? [];
    rows.push([
      accessory.name,
      Number(accessory.current_stock || 0),
      Number(accessory.minimum_stock || 0),
      accessory.active === false ? "HIDE" : "SHOW",
    ]);
    byCategory.set(sheet, rows);
  }

  const sheets: ExportSheet[] = ACCESSORY_EXPORT_SHEETS.map((name) => ({
    name,
    rows: [ACCESSORY_HEADER, ...(byCategory.get(name) ?? [])],
  }));

  sheets.push({
    name: "Packaging",
    rows: [
      PACKAGING_HEADER,
      ...packaging.map((row) => {
        const onHand = Number(row.on_hand_stock || 0);
        const reserved = Number(row.reserved_stock || 0);
        const available = packagingAvailableStock(onHand, reserved);
        const minimum = Number(row.minimum_stock || 0);
        return [
          row.name,
          row.code,
          packagingCategoryLabel(row.category),
          formatPackagingDimensions(row),
          onHand,
          reserved,
          available,
          minimum,
          packagingStockStatus({
            active: row.active !== false,
            available_stock: available,
            minimum_stock: minimum,
          }),
        ];
      }),
    ],
  });

  const other = byCategory.get(OTHER_SHEET);
  if (other) sheets.push({ name: OTHER_SHEET, rows: [ACCESSORY_HEADER, ...other] });

  return sheets;
}

export function buildAccessoryExportWorkbook(sheets: ExportSheet[]) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  return workbook;
}
