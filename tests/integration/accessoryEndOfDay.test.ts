import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildAccessoryEndOfDayPreview } from "../../lib/outbound/accessoryEndOfDay";
import { parseEndOfDayWorkbook } from "../../lib/outbound/endOfDayParser";
import {
  accessoryReportFingerprint,
  accessoryReportOperationId,
} from "../../lib/outbound/reportFingerprint";

const headers = [
  "Order Ref",
  "Item Type",
  "IMEI / ID",
  "Companion Device IMEI",
];

function parse(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["End of Day Report"],
      [],
      [],
      [],
      headers,
      ...rows,
    ]),
    "RADIUS"
  );
  return parseEndOfDayWorkbook(workbook);
}

describe("End-of-Day accessory calculation", () => {
  it("uses report quantities first and templates only to fill what is missing", () => {
    const report = parse([
      ["A-1", "AIO Camera", "861778063561681", "N/A"],
      ["A-1", "*HARDWIRED-Cable for CV200", "861778063561681", "N/A"],
      ["A-2", "ATOM", "862129085814980", "N/A"],
    ]);

    const result = buildAccessoryEndOfDayPreview({
      report,
      accessoryBins: [
        { id: "cable", name: "HARDWIRED Cable for CV200", current_stock: 50 },
        { id: "power", name: "Power Cable", current_stock: 40 },
      ],
      stockItems: [
        { imei: "861778063561681", device_id: "aio" },
        { imei: "862129085814980", device_id: "atom" },
      ],
      templates: [
        {
          device_id: "aio",
          accessory_bin_id: "cable",
          quantity: 1,
          per_devices: 1,
        },
        {
          device_id: "atom",
          accessory_bin_id: "power",
          quantity: 2,
          per_devices: 1,
        },
      ],
    });

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      {
        accessory_bin_id: "cable",
        accessory: "HARDWIRED Cable for CV200",
        report_qty: 1,
        template_expected_qty: 1,
        template_qty: 0,
        qty: 1,
        current_stock: 50,
        after_stock: 49,
      },
      {
        accessory_bin_id: "power",
        accessory: "Power Cable",
        report_qty: 0,
        template_expected_qty: 2,
        template_qty: 2,
        qty: 2,
        current_stock: 40,
        after_stock: 38,
      },
    ]);
  });

  it("fills a partial report quantity without double-counting explicit extras", () => {
    const report = parse([
      ["A-1", "ATOM", "862129085814980", "N/A"],
      ["A-2", "ATOM", "862129085814981", "N/A"],
      ["A-1", "Power Cable", "862129085814980", "N/A"],
    ]);

    const result = buildAccessoryEndOfDayPreview({
      report,
      accessoryBins: [
        { id: "power", name: "Power Cable", current_stock: 10 },
      ],
      stockItems: [
        { imei: "862129085814980", device_id: "atom" },
        { imei: "862129085814981", device_id: "atom" },
      ],
      templates: [
        {
          device_id: "atom",
          accessory_bin_id: "power",
          quantity: 1,
          per_devices: 1,
        },
      ],
    });

    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      report_qty: 1,
      template_expected_qty: 2,
      template_qty: 1,
      qty: 2,
    });
  });

  it("matches report labels to bins that append an internal product code", () => {
    const report = parse([
      ["A-1", "ATOM", "862129085814980", "N/A"],
      ["A-1", "*Camera - Front Facing", "862129085814980", "N/A"],
    ]);

    const result = buildAccessoryEndOfDayPreview({
      report,
      accessoryBins: [
        {
          id: "front-camera",
          name: "*Camera - Front Facing PRO895",
          current_stock: 10,
        },
      ],
      stockItems: [
        { imei: "862129085814980", device_id: "atom" },
      ],
      templates: [],
    });

    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      accessory: "*Camera - Front Facing PRO895",
      report_qty: 1,
      template_qty: 0,
      qty: 1,
    });
  });

  it("uses the DVR Companion Device IMEI for automatic templates", () => {
    const report = parse([
      ["A-1", "HARDWIRED", "860848080680417", "N/A"],
      [
        "A-1",
        "DVR - 8 Channel - (N+)",
        "860848080680417",
        "867105075485721",
      ],
    ]);

    const result = buildAccessoryEndOfDayPreview({
      report,
      accessoryBins: [
        { id: "dvr-kit", name: "DVR Installation Kit", current_stock: 5 },
      ],
      stockItems: [
        { imei: "860848080680417", device_id: "hardwired" },
        { imei: "867105075485721", device_id: "dvr-8" },
      ],
      templates: [
        {
          device_id: "dvr-8",
          accessory_bin_id: "dvr-kit",
          quantity: 1,
          per_devices: 1,
        },
      ],
    });

    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      accessory: "DVR Installation Kit",
      report_qty: 0,
      template_qty: 1,
      qty: 1,
    });
  });

  it("blocks unmapped accessory names and device IMEIs missing from StockPro", () => {
    const report = parse([
      ["A-1", "ATOM", "862129085814980", "N/A"],
      ["A-1", "Power Cable", "862129085814980", "N/A"],
    ]);

    const result = buildAccessoryEndOfDayPreview({
      report,
      accessoryBins: [],
      stockItems: [],
      templates: [],
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("does not match an active accessory bin"),
        }),
        expect.objectContaining({
          message: expect.stringContaining("is not linked to a StockPro device template"),
        }),
      ])
    );
  });
});

describe("End-of-Day accessory report fingerprint", () => {
  it("generates a stable UUID per file and changes it when the file changes", () => {
    const first = Buffer.from("same report");
    const second = Buffer.from("different report");

    expect(accessoryReportFingerprint(first)).toHaveLength(64);
    expect(accessoryReportOperationId(first)).toBe(
      accessoryReportOperationId(Buffer.from("same report"))
    );
    expect(accessoryReportOperationId(first)).not.toBe(
      accessoryReportOperationId(second)
    );
    expect(accessoryReportOperationId(first)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
