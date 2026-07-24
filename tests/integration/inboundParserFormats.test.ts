import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  parseDigitalMatterExcel,
  parseQuicklinkExcel,
  parseTeltonikaExcel,
  parseTrustedExcel,
  parseVendorExcel,
} from "../../lib/inbound/parsers";
import { toDeviceMatchList } from "../../lib/inbound/vendorParser";

function workbookBytes(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Inbound"
  );
  return new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
  );
}

const devices = toDeviceMatchList([
  {
    canonical_name: "FMC130",
    device: "FMC130",
    active: true,
    units_per_imei: 2,
  },
  {
    canonical_name: "CNHYCV200XEU",
    device: "CV200",
    active: true,
    units_per_imei: 1,
  },
  {
    canonical_name: "BARRAGPS",
    device: "Barra GPS",
    active: true,
    units_per_imei: 3,
  },
  {
    canonical_name: "NEONR",
    device: "Neon-R T7",
    active: true,
    units_per_imei: 1,
  },
]);

describe("inbound spreadsheet parser integration", () => {
  it("parses grouped Teltonika boxes, deduplicates IMEIs and applies the device multiplier", () => {
    const bytes = workbookBytes([
      ["FMC130"],
      ["Box No.", "", "IMEI"],
      ["FMC130-025-001", "", "123456789012345"],
      ["", "", "123456789012346"],
      ["", "", "123456789012345"],
      ["FMC130-025-002", "", "123456789012347"],
    ]);

    const result = parseTeltonikaExcel(bytes, devices);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labels).toEqual([
      expect.objectContaining({
        vendor: "teltonika",
        device: "FMC130",
        box_no: "025-001",
        imeis: ["123456789012345", "123456789012346"],
        qty: 4,
        qr_data: "123456789012345\n123456789012346",
      }),
      expect.objectContaining({
        vendor: "teltonika",
        device: "FMC130",
        box_no: "025-002",
        imeis: ["123456789012347"],
        qty: 2,
      }),
    ]);
    expect(result.counts).toEqual({ devices: 1, boxes: 2, items: 6 });
  });

  it("parses Quicklink cartons into stable five-digit box numbers", () => {
    const bytes = workbookBytes([
      ["IMEI", "Carton"],
      ["223456789012345", "CNHYCV200XEU202500001"],
      ["223456789012346", "CNHYCV200XEU202500002"],
      ["invalid", "CNHYCV200XEU202500002"],
    ]);

    const result = parseQuicklinkExcel(bytes, devices);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labels.map(({ box_no, imeis }) => ({ box_no, imeis }))).toEqual([
      { box_no: "00001", imeis: ["223456789012345"] },
      { box_no: "00002", imeis: ["223456789012346"] },
    ]);
    expect(result.counts).toEqual({ devices: 1, boxes: 2, items: 2 });
  });

  it("parses Digital Matter rows with the configured device and multiplier", () => {
    const bytes = workbookBytes([
      ["IMEI", "Box Number"],
      ["323456789012345", "DM-01"],
      ["323456789012346", "DM-01"],
      ["323456789012346", "DM-01"],
    ]);

    const result = parseDigitalMatterExcel(bytes, devices);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labels).toEqual([
      expect.objectContaining({
        vendor: "digitalmatter",
        device: "Barra GPS",
        box_no: "DM-01",
        imeis: ["323456789012345", "323456789012346"],
        qty: 6,
      }),
    ]);
  });

  it("parses Truster serial-number files and falls back to data-based column detection", () => {
    const explicit = parseTrustedExcel(
      workbookBytes([
        ["Serialnumber", "Comment"],
        ["423456789012345", "first"],
        ["423456789012346", "second"],
      ]),
      devices
    );
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.labels[0]).toEqual(
        expect.objectContaining({
          vendor: "truster",
          device: "Neon-R T7",
          box_no: "1",
          qty: 2,
        })
      );
    }

    const detected = parseTrustedExcel(
      workbookBytes([
        ["Reference", "Identifier value"],
        ["A", "523456789012345"],
        ["B", "523456789012346"],
        ["C", "523456789012347"],
      ]),
      devices
    );
    expect(detected.ok).toBe(true);
    if (detected.ok) {
      expect(detected.labels[0].imeis).toEqual([
        "523456789012345",
        "523456789012346",
        "523456789012347",
      ]);
      expect(detected.debug.idxImei).toBe(1);
    }
  });

  it("returns actionable failures for malformed files, missing devices and unknown vendors", () => {
    const missingHeaders = parseTeltonikaExcel(
      workbookBytes([["Something else"], ["value"]]),
      devices
    );
    expect(missingHeaders).toMatchObject({
      ok: false,
      error: expect.stringContaining("header row"),
    });

    const unknownDevice = parseQuicklinkExcel(
      workbookBytes([
        ["IMEI", "Carton"],
        ["623456789012345", "UNKNOWN90000001"],
      ]),
      devices
    );
    expect(unknownDevice).toMatchObject({
      ok: false,
      unknown_devices: ["UNKNOWN90000001"],
    });

    const unknownVendor = parseVendorExcel(
      "unsupported" as never,
      workbookBytes([["IMEI"], ["723456789012345"]]),
      devices
    );
    expect(unknownVendor).toMatchObject({
      ok: false,
      error: "Unknown vendor",
    });
  });
});
