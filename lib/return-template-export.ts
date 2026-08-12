import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { ReturnStatus } from "@/lib/returns";

export const RETURN_TEMPLATE_HEADERS = [
  "RETURNED",
  "DAMAGED",
  "DISPOSED",
  "LOST",
  "MANUFACTURER",
  "RETURNED_UNPROCESSED",
  "IN_TRANSIT",
  "GRADE_A_UNPROCESSED",
  "GRADE_B_UNPROCESSED",
  "GRADE_C_UNPROCESSED",
  "GRADE_D",
  "GRADE_W",
] as const;

const TEMPLATE_PATH = join(
  process.cwd(),
  "assets",
  "templates",
  "MultiDeviceReturnsTemplate.xlsx"
);

const STATUS_COLUMN: Record<ReturnStatus, number> = {
  available: 1,
  damaged: 2,
  disposed: 3,
  returned_unprocessed: 6,
};

export type ReturnTemplateRow = {
  imei: string;
  return_status: ReturnStatus;
};

export async function createReturnTemplateWorkbook(
  rows: readonly ReturnTemplateRow[]
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await readFile(TEMPLATE_PATH)) as any);

  const worksheet = workbook.getWorksheet("Sheet1") || workbook.worksheets[0];
  if (!worksheet) throw new Error("The return template has no worksheet");

  RETURN_TEMPLATE_HEADERS.forEach((header, index) => {
    if (String(worksheet.getCell(1, index + 1).value || "").trim() !== header) {
      throw new Error(`Unexpected return template header: ${header}`);
    }
  });

  const grouped = new Map<number, string[]>();
  for (const row of rows) {
    const column = STATUS_COLUMN[row.return_status];
    if (!column) throw new Error(`Unsupported return status: ${row.return_status}`);
    const imei = String(row.imei || "").trim();
    if (!/^\d{14,17}$/.test(imei)) {
      throw new Error(`Invalid IMEI in return export: ${imei || "empty"}`);
    }
    grouped.set(column, [...(grouped.get(column) || []), imei]);
  }

  const minimumRows = Math.max(worksheet.rowCount, 55);
  const longestColumn = Math.max(0, ...Array.from(grouped.values(), (v) => v.length));
  const finalRows = Math.max(minimumRows, longestColumn + 1);

  for (let rowNumber = 2; rowNumber <= finalRows; rowNumber += 1) {
    for (let column = 1; column <= RETURN_TEMPLATE_HEADERS.length; column += 1) {
      worksheet.getCell(rowNumber, column).value = null;
    }
  }

  for (const [column, imeis] of grouped) {
    imeis.forEach((imei, index) => {
      const cell = worksheet.getCell(index + 2, column);
      cell.value = imei;
      cell.numFmt = "@";
    });
  }

  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output as any).slice().buffer;
}

export function returnTemplateFilename(suffix: string) {
  const safeSuffix = suffix
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `multi-device-returns-${safeSuffix || "export"}.xlsx`;
}
