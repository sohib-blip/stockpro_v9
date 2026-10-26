import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildAccessoryEndOfDayPreview } from "../../lib/outbound/accessoryEndOfDay";
import { parseEndOfDayWorkbook } from "../../lib/outbound/endOfDayParser";

const NEON = "865031064765315";
const HARDWIRED = "861778063561681";
const INVENTORY = [
  { id: "fuse", name: "3 amp Fuse mini blade", current_stock: 885 },
  { id: "holder", name: "Fuse Holder - mini blade in-line", current_stock: 696 },
  { id: "pads", name: "NEON-T Adhesive Pads", current_stock: 315 },
  { id: "neon-bin", name: "Neon", current_stock: 10 },
];

function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Order Ref", "Item Type", "IMEI / ID", "Companion Device IMEI"], ...rows]),
    "RADIUS"
  );
  return book;
}

const report = [
  ["A-1", "Hardwired", HARDWIRED, "N/A"],
  ["A-1", "3 amp Fuse mini blade", HARDWIRED, "N/A"],
  ["A-1", "Fuse Holder - mini blade in-line", HARDWIRED, "N/A"],
  ["A-2", "Neon", NEON, "N/A"],
  ["A-2", "NEON-T Adhesive Pads", NEON, "N/A"],
];

describe("End-of-Day report and Inventory > Accessories", () => {
  it("blocks Item Types it does not know, as before", () => {
    const result = parseEndOfDayWorkbook(workbook(report));
    expect(result.errors.map((error) => error.message)).toEqual([
      expect.stringContaining('Unknown Item Type "3 amp Fuse mini blade"'),
      expect.stringContaining('Unknown Item Type "Fuse Holder - mini blade in-line"'),
      expect.stringContaining('Unknown Item Type "NEON-T Adhesive Pads"'),
    ]);
  });

  it("recognises rows named like an active inventory accessory", () => {
    const result = parseEndOfDayWorkbook(workbook(report), {
      accessoryNames: INVENTORY.map((bin) => bin.name),
    });
    expect(result.errors).toEqual([]);
    expect(result.imeis).toEqual([HARDWIRED, NEON]);
    expect(result.accessories.map((row) => row.itemType)).toEqual([
      "3 amp Fuse mini blade",
      "Fuse Holder - mini blade in-line",
      "NEON-T Adhesive Pads",
    ]);
  });

  it("also accepts the start of an accessory name, and still blocks names that match nothing", () => {
    const result = parseEndOfDayWorkbook(
      workbook([
        ["A-1", "Fuse Holder", HARDWIRED, "N/A"],
        ["A-1", "Mystery part", HARDWIRED, "N/A"],
      ]),
      { accessoryNames: INVENTORY.map((bin) => bin.name) }
    );
    expect(result.accessories.map((row) => row.itemType)).toEqual(["Fuse Holder"]);
    expect(result.errors.map((error) => error.message)).toEqual([
      expect.stringContaining('Unknown Item Type "Mystery part"'),
    ]);
  });

  it("keeps devices as devices even when an accessory has the same name", () => {
    const result = parseEndOfDayWorkbook(workbook([["A-2", "Neon", NEON, "N/A"]]), {
      accessoryNames: ["Neon"],
    });
    expect(result.imeis).toEqual([NEON]);
    expect(result.accessories).toEqual([]);
  });

  it("removes each accessory once when the rule and the report both have it", () => {
    const parsed = parseEndOfDayWorkbook(workbook(report), {
      accessoryNames: INVENTORY.map((bin) => bin.name),
    });
    const { rows, issues } = buildAccessoryEndOfDayPreview({
      report: parsed,
      accessoryBins: INVENTORY,
      stockItems: [
        { imei: HARDWIRED, device_id: "hardwired-model" },
        { imei: NEON, device_id: "neon-model" },
      ],
      templates: [
        // Rule: 14 fuses for this report (report has 1) -> 14, not 15.
        { device_id: "hardwired-model", accessory_bin_id: "fuse", quantity: 14, per_devices: 1 },
        // No rule for the holder: the report row removes 1.
        // Rule for the pads, report has 1 too -> 1.
        { device_id: "neon-model", accessory_bin_id: "pads", quantity: 1, per_devices: 1 },
      ],
    });
    expect(issues).toEqual([]);
    expect(rows.map((row) => [row.accessory, row.report_qty, row.template_qty, row.qty])).toEqual([
      ["3 amp Fuse mini blade", 1, 13, 14],
      ["Fuse Holder - mini blade in-line", 1, 0, 1],
      ["NEON-T Adhesive Pads", 1, 0, 1],
    ]);
  });
});
