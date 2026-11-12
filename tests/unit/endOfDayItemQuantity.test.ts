import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildAccessoryEndOfDayPreview } from "../../lib/outbound/accessoryEndOfDay";
import { parseEndOfDayWorkbook } from "../../lib/outbound/endOfDayParser";
import { translateUiText } from "../../lib/i18n";

const ATOM = "865031064765315";
const NEON = "861778063561681";
const HEADER = ["Order Ref", "Item Type", "IMEI / ID", "Companion Device IMEI", "Item Quantity"];

function report(rows: unknown[][], header = HEADER) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["End of Day Report"], [], header, ...rows]), "RADIUS");
  return parseEndOfDayWorkbook(book);
}

const FOB = { id: "fob", name: "FOB\t1", current_stock: 400 };
const CABLE = { id: "cable", name: "*3M AV Extension Cable PRO900", current_stock: 200 };

function preview(parsed: ReturnType<typeof report>, templates: Parameters<typeof buildAccessoryEndOfDayPreview>[0]["templates"] = []) {
  return buildAccessoryEndOfDayPreview({
    report: parsed,
    accessoryBins: [FOB, CABLE],
    stockItems: [
      { imei: ATOM, device_id: "atom-model" },
      { imei: NEON, device_id: "neon-model" },
    ],
    templates,
  });
}

describe("End-of-Day Item Quantity", () => {
  it("reads 0 as one item per line and a number as the quantity of the line", () => {
    // Same pattern as the 29/10 report: FOB lines with 2 and 1, other lines with 0.
    const parsed = report([
      ["A-1", "ATOM", ATOM, "N/A", "0"],
      ["A-1", "FOB", ATOM, "N/A", "2"],
      ["A-1", "FOB", ATOM, "N/A", "2"],
      ["A-1", "FOB", ATOM, "N/A", "2"],
      ["A-2", "Neon", NEON, "N/A", "0"],
      ["A-2", "FOB", NEON, "N/A", "1"],
      ["A-2", "*3M AV Extension Cable", NEON, "N/A", "0"],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.accessories.map((row) => [row.itemType, row.quantity])).toEqual([
      ["FOB", 2],
      ["FOB", 2],
      ["FOB", 2],
      ["FOB", 1],
      ["*3M AV Extension Cable", 1],
    ]);
    const { rows, issues } = preview(parsed);
    expect(issues).toEqual([]);
    expect(rows.map((row) => [row.accessory, row.report_qty, row.qty])).toEqual([
      ["*3M AV Extension Cable PRO900", 1, 1],
      ["FOB\t1", 7, 7],
    ]);
  });

  it("counts a quantity on one line for any accessory, even without a device", () => {
    // Same pattern as the 28/10 report: one FOB line with 5 and no IMEI.
    const parsed = report([
      ["B-1", "FOB", "", "", "5"],
      ["B-2", "*3M AV Extension Cable", ATOM, "N/A", 3],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(preview(parsed).rows.map((row) => [row.accessory, row.qty])).toEqual([
      ["*3M AV Extension Cable PRO900", 3],
      ["FOB\t1", 5],
    ]);
  });

  it("still removes each accessory once between a rule and the report", () => {
    const parsed = report([
      ["C-1", "ATOM", ATOM, "N/A", "0"],
      ["C-1", "FOB", ATOM, "N/A", "3"],
    ]);
    const rule = (quantity: number) => [{ device_id: "atom-model", accessory_bin_id: "fob", quantity, per_devices: 1 }];
    // Report 3, rule 2 -> 3. Report 3, rule 5 -> 5.
    expect(preview(parsed, rule(2)).rows.map((row) => [row.report_qty, row.template_qty, row.qty])).toEqual([[3, 0, 3]]);
    expect(preview(parsed, rule(5)).rows.map((row) => [row.report_qty, row.template_qty, row.qty])).toEqual([[3, 2, 5]]);
  });

  it("works as before with reports without the column", () => {
    const parsed = report(
      [
        ["D-1", "ATOM", ATOM, "N/A"],
        ["D-1", "FOB", ATOM, "N/A"],
        ["D-1", "FOB", ATOM, "N/A"],
      ],
      HEADER.slice(0, 4)
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.accessories.map((row) => row.quantity)).toEqual([1, 1]);
  });

  it("blocks a device line with a quantity and an invalid quantity", () => {
    const parsed = report([
      ["E-1", "ATOM", ATOM, "N/A", "3"],
      ["E-2", "FOB", NEON, "N/A", "2.5"],
      ["E-3", "FOB", NEON, "N/A", "-1"],
      ["E-4", "FOB", NEON, "N/A", "1000"],
      ["E-5", "FOB", NEON, "N/A", "abc"],
    ]);
    expect(parsed.errors.map((error) => error.message)).toEqual([
      "Device ATOM has Item Quantity 3. Each device needs its own line and IMEI.",
      'Item Quantity "2.5" of FOB is not a valid quantity (whole number from 0 to 999).',
      'Item Quantity "-1" of FOB is not a valid quantity (whole number from 0 to 999).',
      'Item Quantity "1000" of FOB is not a valid quantity (whole number from 0 to 999).',
      'Item Quantity "abc" of FOB is not a valid quantity (whole number from 0 to 999).',
    ]);
    expect(parsed.accessories).toEqual([]);
  });

  it("translates the new messages", () => {
    expect(translateUiText("fr", "Device ATOM has Item Quantity 3. Each device needs its own line and IMEI.")).toBe(
      "L’appareil ATOM a une Item Quantity de 3. Chaque appareil doit avoir sa propre ligne et son IMEI."
    );
    expect(translateUiText("nl", "Device MatrixIQ does not contain a valid 12-digit serial number.")).toBe(
      "Apparaat MatrixIQ bevat geen geldig serienummer van 12 cijfers."
    );
    expect(translateUiText("fr", 'Item Quantity "abc" of FOB is not a valid quantity (whole number from 0 to 999).')).toBe(
      "L’Item Quantity « abc » de FOB n’est pas une quantité valide (nombre entier de 0 à 999)."
    );
  });
});
