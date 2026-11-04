import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import {
  normalizeReturnReasonForTemplate,
  type ReturnStatus,
} from "./returns";

export const RETURN_TEMPLATE_HEADERS = [
  "RETURN REASON",
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
  available: 2,
  damaged: 3,
  disposed: 4,
  returned_unprocessed: 7,
};

type WorksheetWithRangeValidations = ExcelJS.Worksheet & {
  dataValidations: {
    add(range: string, validation: ExcelJS.DataValidation): void;
  };
};

export type ReturnTemplateRow = {
  imei: string;
  return_status: ReturnStatus;
  return_reason: string;
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

  const minimumRows = Math.max(worksheet.rowCount, 55);
  const finalRows = Math.max(minimumRows, rows.length + 1);

  for (let rowNumber = 2; rowNumber <= finalRows; rowNumber += 1) {
    for (let column = 1; column <= RETURN_TEMPLATE_HEADERS.length; column += 1) {
      worksheet.getCell(rowNumber, column).value = null;
    }
  }

  (worksheet as WorksheetWithRangeValidations).dataValidations.add(
    `A2:A${finalRows}`,
    {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Invalid return reason",
      error: "Choose a return reason from the official list.",
      formulae: ["Return_Reasons!$A$1:$A$15"],
    }
  );

  rows.forEach((row, index) => {
    const column = STATUS_COLUMN[row.return_status];
    if (!column) throw new Error(`Unsupported return status: ${row.return_status}`);
    const imei = String(row.imei || "").trim();
    if (!/^\d{14,17}$/.test(imei)) {
      throw new Error(`Invalid IMEI in return export: ${imei || "empty"}`);
    }

    const rowNumber = index + 2;
    worksheet.getCell(rowNumber, 1).value = normalizeReturnReasonForTemplate(
      row.return_reason
    );
    const imeiCell = worksheet.getCell(rowNumber, column);
    imeiCell.value = imei;
    imeiCell.numFmt = "@";
  });

  const output = await workbook.xlsx.writeBuffer();
  return new Uint8Array(output as any).slice().buffer;
}

// Supabase caps every API response (max_rows, 1,000 on StockPro projects), so
// export rows are always read page by page instead of trusting one response.
// The next page starts after the rows actually received and reading stops only
// on an empty page, so a cap lower than the page size cannot truncate a file.
// fetchPage must use a stable order (created_at, id).
export const RETURN_TEMPLATE_PAGE_SIZE = 1000;
const RETURN_TEMPLATE_MAX_PAGES = 1000;

export async function readAllReturnTemplatePages<Row>(
  fetchPage: (from: number, to: number) => Promise<readonly Row[] | null>,
  pageSize = RETURN_TEMPLATE_PAGE_SIZE
) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Invalid return export page size");
  }

  const rows: Row[] = [];
  for (let pages = 0; pages < RETURN_TEMPLATE_MAX_PAGES; pages += 1) {
    const from = rows.length;
    const page = (await fetchPage(from, from + pageSize - 1)) || [];
    if (page.length === 0) return rows;
    rows.push(...page);
  }
  throw new Error("Return export has too many pages");
}

export function returnTemplateFilename(suffix: string) {
  const safeSuffix = suffix
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `multi-device-returns-${safeSuffix || "export"}.xlsx`;
}
