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
    canonical_name: "FMC003",
    device: "FMC003",
    active: true,
    units_per_imei: 1,
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
  {
    canonical_name: "NEONP",
    device: "Neon-P T1",
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

  it("prefers Teltonika's dedicated second Box No. column when the repeated first column is stale", () => {
    const bytes = workbookBytes([
      ["FMC003X5HVWU"],
      ["FL", "Box No.", "Box No.", "S/N", "IMEI", "ParentBoxGuid"],
      ["LT", "FMC003X5HVWU-050-001", "050-1", "1", "860848082320202", "box-1"],
      ["LT", "FMC003X5HVWU-050-002", "050-2", "2", "860848082078644", "box-2"],
      ["LT", "FMC003X5HVWU-050-001", "050-2", "3", "860848082073215", "box-2"],
      ["LT", "FMC003X5HVWU-050-001", "050-2", "4", "860848082073223", "box-2"],
    ]);

    const result = parseTeltonikaExcel(bytes, devices);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labels.map(({ box_no, imeis }) => ({ box_no, imeis }))).toEqual([
      { box_no: "050-001", imeis: ["860848082320202"] },
      {
        box_no: "050-002",
        imeis: ["860848082078644", "860848082073215", "860848082073223"],
      },
    ]);
    expect(result.counts).toEqual({ devices: 1, boxes: 2, items: 4 });
  });

  it("uses Teltonika master cartons instead of their smaller inner boxes", () => {
    const bytes = workbookBytes([
      ["FMC003X5HVWU"],
      ["Box No.", "Box No.", "S/N", "IMEI"],
      ["FMC003X5HVWU-076-004", "075-1", "1", "860848082320202"],
      ["FMC003X5HVWU-076-004", "075-2", "2", "860848082078644"],
      ["FMC003X5HVWU-075-001", "076-17", "3", "860848082073215"],
      ["FMC003X5HVWU-075-001", "076-18", "4", "860848082073223"],
    ]);

    const result = parseTeltonikaExcel(bytes, devices);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labels.map(({ box_no, imeis }) => ({ box_no, imeis }))).toEqual([
      {
        box_no: "075-001",
        imeis: ["860848082073215", "860848082073223"],
      },
      {
        box_no: "076-004",
        imeis: ["860848082320202", "860848082078644"],
      },
    ]);
    expect(result.debug.boxColumnSelections).toEqual([
      expect.objectContaining({ source: "master", selected: 0 }),
    ]);
    expect(result.counts).toEqual({ devices: 1, boxes: 2, items: 4 });
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

  it("maps Truster models and groups IMEIs into POD boxes", () => {
    const explicit = parseTrustedExcel(
      workbookBytes([
        ["Serialnumber", "Model", "Groupe", "Comment"],
        ["423456789012345", "T7LTE", "POD-001", "first"],
        ["423456789012346", "T7LTE", "POD-001", "second"],
        ["423456789012347", "T1", "POD-002", "third"],
      ]),
      devices
    );
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.labels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            vendor: "truster",
            device: "Neon-R T7",
            box_no: "POD-001",
            qty: 2,
            imeis: ["423456789012345", "423456789012346"],
          }),
          expect.objectContaining({
            vendor: "truster",
            device: "Neon-P T1",
            box_no: "POD-002",
            qty: 1,
            imeis: ["423456789012347"],
          }),
        ])
      );
      expect(explicit.counts).toEqual({ devices: 2, boxes: 2, items: 3 });
    }

    const detected = parseTrustedExcel(
      workbookBytes([
        ["Reference", "Identifier value", "Model", "Groupe"],
        ["A", "523456789012345", "T7 LTE", "pod-003"],
        ["B", "523456789012346", "T7LTE", "POD-003"],
        ["C", "523456789012347", "T7LTE", "POD-003"],
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
      expect(detected.labels[0].box_no).toBe("POD-003");
      expect(detected.debug.idxImei).toBe(1);
    }
  });

  it("ignores Truster Groupe text before the first POD box ID", () => {
    const result = parseTrustedExcel(
      workbookBytes([
        ["Serialnumber", "Model", "Groupe"],
        ["623456789012345", "T7LTE", "Shipment 42 / pod-010"],
        ["623456789012346", "T7LTE", "Warehouse note: POD-010"],
        ["623456789012347", "T1", "Ignored prefix POD-011"],
      ]),
      devices
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          device: "Neon-R T7",
          box_no: "POD-010",
          imeis: ["623456789012345", "623456789012346"],
        }),
        expect.objectContaining({
          device: "Neon-P T1",
          box_no: "POD-011",
          imeis: ["623456789012347"],
        }),
      ])
    );
  });

  it("blocks Truster imports for invalid groups, unsupported models and missing bins", () => {
    const invalidGroup = parseTrustedExcel(
      workbookBytes([
        ["Serialnumber", "Model", "Groupe"],
        ["423456789012345", "T7LTE", "BOX-001"],
      ]),
      devices
    );
    expect(invalidGroup).toMatchObject({
      ok: false,
      error: expect.stringContaining("must contain a box ID starting with POD"),
    });

    const unsupportedModel = parseTrustedExcel(
      workbookBytes([
        ["Serialnumber", "Model", "Groupe"],
        ["423456789012345", "UNKNOWN", "POD-001"],
      ]),
      devices
    );
    expect(unsupportedModel).toMatchObject({
      ok: false,
      error: expect.stringContaining("unsupported Model"),
    });

    const withoutNeonP = devices.filter((device) => device.canonical !== "NEONP");
    const missingBin = parseTrustedExcel(
      workbookBytes([
        ["Serialnumber", "Model", "Groupe"],
        ["423456789012345", "T1", "POD-001"],
      ]),
      withoutNeonP
    );
    expect(missingBin).toMatchObject({
      ok: false,
      unknown_devices: ["Neon-P"],
      error: expect.stringContaining("bin(s) not found or inactive: Neon-P"),
    });
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
