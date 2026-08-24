import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseEndOfDayWorkbook } from "../../lib/outbound/endOfDayParser";

const headers = [
  "Order Ref",
  "Item Type",
  "IMEI / ID",
  "Companion Device IMEI",
];

function reportSheet(rows: unknown[][]) {
  return XLSX.utils.aoa_to_sheet([
    ["End of Day Report"],
    ["Generated for StockPro"],
    [],
    [],
    headers,
    ...rows,
  ]);
}

function workbookWithSheets(sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, reportSheet(rows), name);
  }
  return workbook;
}

describe("End-of-Day outbound parser", () => {
  it("reads every report worksheet and ignores known accessory rows", () => {
    const workbook = workbookWithSheets({
      RADIUS: [
        ["A-1", "AIO Camera", 861778063561681, "N/A"],
        ["A-1", "HARDWIRED Cable for CV200", 861778063561681, "N/A"],
        ["A-1", "FMB130 connectorized harness", 861778063561681, "N/A"],
        ["A-2", "Neon", "865031064765315", "N/A"],
      ],
      "WEX France": [
        ["B-1", "ATOM", "862129085814980", "N/A"],
        ["B-2", "OBD Cable FMC003", "862129085814980", "N/A"],
        ["B-3", "Trailer", "867105075485700", "N/A"],
      ],
    });

    const result = parseEndOfDayWorkbook(workbook);

    expect(result.errors).toEqual([]);
    expect(result.parsedSheets).toEqual(["RADIUS", "WEX France"]);
    expect(result.imeis).toEqual([
      "861778063561681",
      "865031064765315",
      "862129085814980",
      "867105075485700",
    ]);
    expect(result.ignoredRows).toBe(3);
    expect(result.accessories).toEqual([
      expect.objectContaining({
        sheet: "RADIUS",
        row: 7,
        itemType: "HARDWIRED Cable for CV200",
        linkedImei: "861778063561681",
      }),
      expect.objectContaining({
        sheet: "RADIUS",
        row: 8,
        itemType: "FMB130 connectorized harness",
        linkedImei: "861778063561681",
      }),
      expect.objectContaining({
        sheet: "WEX France",
        row: 7,
        itemType: "OBD Cable FMC003",
      }),
    ]);
    expect(result.duplicates).toEqual([]);
  });

  it("uses Companion Device IMEI when a DVR primary IMEI links to another device", () => {
    const workbook = workbookWithSheets({
      RADIUS: [
        ["A-1", "HARDWIRED", "860848080680417", "N/A"],
        ["A-1", "BUZZER", "860848080680417", "N/A"],
        [
          "A-1",
          "DVR-2CH",
          "860848080680417",
          "867105075485721",
        ],
        ["A-1", "FOB", "860848080680417", "C300001F0A671501"],
      ],
    });

    const result = parseEndOfDayWorkbook(workbook);

    expect(result.errors).toEqual([]);
    expect(result.imeis).toEqual([
      "860848080680417",
      "867105075485721",
    ]);
    expect(result.devices[1]).toMatchObject({
      deviceKind: "DVR_2",
      primaryImei: "860848080680417",
      imei: "867105075485721",
      linkedDvr: true,
    });
    expect(result.duplicates).toEqual([]);
  });

  it.each([
    "DVR 2 Channel",
    "DVR - 4 Channel - (N+)",
    "*DVR 8",
    "DVR-2CH",
    "DVR-4CH",
    "DVR-8CH",
  ])("recognizes DVR spelling variant %s and uses its own primary IMEI when unlinked", (itemType) => {
    const workbook = workbookWithSheets({
      Report: [["A-1", itemType, "867105075485722", "N/A"]],
    });

    const result = parseEndOfDayWorkbook(workbook);

    expect(result.errors).toEqual([]);
    expect(result.imeis).toEqual(["867105075485722"]);
  });

  it("blocks a linked DVR when its Companion Device IMEI is missing", () => {
    const workbook = workbookWithSheets({
      Report: [
        ["A-1", "OBD", "860848080680417", "N/A"],
        ["A-1", "DVR - 8 Channel", "860848080680417", "N/A"],
      ],
    });

    const result = parseEndOfDayWorkbook(workbook);

    expect(result.imeis).toEqual(["860848080680417"]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        sheet: "Report",
        row: 7,
        message: expect.stringContaining("Companion Device IMEI is missing or invalid"),
      }),
    ]);
  });

  it("keeps real device duplicates and blocks unknown Item Types", () => {
    const workbook = workbookWithSheets({
      Report: [
        ["A-1", "ATOM", "862129085814980", "N/A"],
        ["A-2", "ATOM", "862129085814980", "N/A"],
        ["A-3", "Future Tracker X", "867105075485799", "N/A"],
      ],
    });

    const result = parseEndOfDayWorkbook(workbook);

    expect(result.duplicates).toEqual([
      {
        imei: "862129085814980",
        count: 2,
        locations: [
          { sheet: "Report", row: 6 },
          { sheet: "Report", row: 7 },
        ],
      },
    ]);
    expect(result.unknownItemTypes).toEqual(["Future Tracker X"]);
    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 8,
        message: expect.stringContaining("Unknown Item Type"),
      }),
    ]);
  });

  it("accepts an accessory-only report for the shared accessory workflow", () => {
    const workbook = workbookWithSheets({
      Report: [
        ["A-1", "HARDWIRED Cable for CV200", "861778063561681", "N/A"],
        ["A-2", "OBD Cable FMC003", "862129085814980", "N/A"],
      ],
    });

    const result = parseEndOfDayWorkbook(workbook);

    expect(result.errors).toEqual([]);
    expect(result.deviceRows).toBe(0);
    expect(result.imeis).toEqual([]);
    expect(result.accessories).toHaveLength(2);
  });
});
