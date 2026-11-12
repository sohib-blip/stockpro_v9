import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { endOfDayReportContentLines } from "../../lib/outbound/endOfDayParser";
import {
  accessoryReportContentOperationId,
  accessoryReportOperationId,
} from "../../lib/outbound/reportFingerprint";

const HEADERS = ["Order Ref", "Item Type", "IMEI / ID", "Companion Device IMEI", "Item Quantity"];
const ROWS: unknown[][] = [
  ["ORD-1001", "ATOM", "990000000000101", "", 0],
  ["ORD-1001", "FOB", "", "", 5],
  ["ORD-1002", "NEON", "990000000000102", "", ""],
  ["ORD-1002", "HARDWIRED Cable", "990000000000102", "", 0],
];

function workbook(
  rows: unknown[][],
  options: { sheet?: string; headers?: string[]; title?: unknown[][] } = {}
) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ...(options.title ?? [["End of Day Report"], []]),
      options.headers ?? HEADERS,
      ...rows,
    ]),
    options.sheet ?? "RADIUS"
  );
  return book;
}

// Write the workbook to xlsx bytes and read it back, like an upload.
function roundTrip(book: XLSX.WorkBook) {
  const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { bytes, book: XLSX.read(bytes, { type: "buffer" }) };
}

function contentId(book: XLSX.WorkBook) {
  return accessoryReportContentOperationId(endOfDayReportContentLines(book));
}

describe("accessory End-of-Day duplicate key from the report content", () => {
  const original = roundTrip(workbook(ROWS));

  it("gives a version-5 UUID", () => {
    expect(contentId(original.book)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("recognises the same report re-saved with different file bytes", () => {
    const resaved = roundTrip(
      workbook(
        // Rows in another order, IMEIs and quantities typed as text, another sheet
        // name, another title block and an extra column.
        [...ROWS].reverse().map((row) => [...row.map((cell) => String(cell)), "exported 18:02"]),
        {
          sheet: "Sheet1",
          headers: [...HEADERS, "Export note"],
          title: [["Kinesis export"], ["12/11/2026"], []],
        }
      )
    );

    expect(resaved.bytes.equals(original.bytes)).toBe(false);
    expect(accessoryReportOperationId(resaved.bytes)).not.toBe(
      accessoryReportOperationId(original.bytes)
    );
    expect(contentId(resaved.book)).toBe(contentId(original.book));
  });

  it("treats an empty Item Quantity and 0 the same as 1", () => {
    const quantities = roundTrip(
      workbook(ROWS.map((row) => (row[4] === 5 ? row : [...row.slice(0, 4), 1])))
    );
    expect(contentId(quantities.book)).toBe(contentId(original.book));
  });

  it("changes when a quantity, an IMEI, an order or a line changes", () => {
    const variants = [
      ROWS.map((row) => (row[1] === "FOB" ? [...row.slice(0, 4), 4] : row)),
      ROWS.map((row) => (row[2] === "990000000000101" ? [row[0], row[1], "990000000000199", "", 0] : row)),
      ROWS.map((row) => (row[0] === "ORD-1002" ? ["ORD-2002", ...row.slice(1)] : row)),
      ROWS.slice(1),
      [...ROWS, ["ORD-1003", "FOB", "", "", 1]],
    ];
    const ids = variants.map((rows) => contentId(roundTrip(workbook(rows)).book));

    for (const id of ids) expect(id).not.toBe(contentId(original.book));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ignores rows without an Item Type and blank rows", () => {
    const padded = roundTrip(workbook([...ROWS, [], ["", "", "", "", ""], ["note", "", "", "", ""]]));
    expect(contentId(padded.book)).toBe(contentId(original.book));
  });

  it("keeps a line repeated twice in the report as two lines", () => {
    const doubled = roundTrip(workbook([...ROWS, ROWS[1]]));
    expect(contentId(doubled.book)).not.toBe(contentId(original.book));
  });
});
