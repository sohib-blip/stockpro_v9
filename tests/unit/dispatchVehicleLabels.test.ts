import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildDispatchVehicleLabels,
  createDispatchVehicleLabelsDocx,
  L4731_LABELS_PER_PAGE,
} from "../../lib/dispatch-vehicle-labels";
import { parseDispatchWorkbook } from "../../lib/dispatch-planning";

function workbookWithRows(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Kinesis Vehicle Sheet"],
      [],
      [],
      [],
      [
        "Vehicle Registration",
        "Hardware Type",
        "Device Type",
        "Order ID",
        "Order Line ID",
      ],
      ...rows,
    ]),
    "Vehicles"
  );
  return workbook;
}

describe("dispatch vehicle registration labels", () => {
  it("creates one label per device and ignores accessory duplicate registrations", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "ATOM", "Teltonika - Atom-E 4G - FMC880", 1001, 1],
        ["AA-01", "Atom Install Guide", "", 1001, 1],
        ["AA-01", "Large Cable Ties", "", 1001, 1],
        ["AA-01", "OBD", "Teltonika OBD tracker - FMC003", 1001, 2],
        ["AA-01", "BUZZER", "", 1001, 2],
      ])
    );

    const result = buildDispatchVehicleLabels(parsed.lines);

    expect(parsed.issues).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.labels).toEqual([
      expect.objectContaining({
        registration: "AA-01",
        deviceModel: "FMC880",
        row: 6,
      }),
      expect.objectContaining({
        registration: "AA-01",
        deviceModel: "FMC003",
        row: 9,
      }),
    ]);
  });

  it("reports a missing registration only for a real device row", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["", "ATOM", "Teltonika - Atom-E 4G - FMC880", 1001, 1],
        ["", "Atom Install Guide", "", 1001, 1],
      ])
    );

    const result = buildDispatchVehicleLabels(parsed.lines);

    expect(result.labels).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        row: 6,
        message: "Vehicle Registration is required for every device label.",
      }),
    ]);
  });

  it("uses the complete 7 by 27 L4731 sheet before adding another A4 page", async () => {
    const labels = Array.from(
      { length: L4731_LABELS_PER_PAGE + 1 },
      (_, index) => ({
        registration: `TEST-${index + 1}`,
        deviceModel: "FMC880",
        orderId: "1001",
        sheet: "Vehicles",
        row: index + 6,
      })
    );

    const bytes = await createDispatchVehicleLabelsDocx(labels);
    const archive = await JSZip.loadAsync(bytes);
    const documentXml = await archive.file("word/document.xml")!.async("string");

    expect(L4731_LABELS_PER_PAGE).toBe(189);
    expect(documentXml.match(/<w:tbl(?:\s[^>]*)?>/g)).toHaveLength(2);
    expect(documentXml).not.toContain('<w:br w:type="page"/>');
    expect(documentXml).toContain(">TEST-1</w:t>");
    expect(documentXml).toContain(">TEST-190</w:t>");
    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
  });

  it("keeps the supplied Word template and safely escapes registration text", async () => {
    const bytes = await createDispatchVehicleLabelsDocx([
      {
        registration: "A&B<12>",
        deviceModel: "FMC880",
        orderId: "1001",
        sheet: "Vehicles",
        row: 6,
      },
    ]);
    const archive = await JSZip.loadAsync(bytes);
    const documentXml = await archive.file("word/document.xml")!.async("string");

    expect(documentXml).toContain(">A&amp;B&lt;12&gt;</w:t>");
    expect(documentXml.match(/<w:tr(?:\s[^>]*)?>/g)).toHaveLength(27);
    expect(documentXml.match(/<w:tc(?:\s[^>]*)?>/g)).toHaveLength(351);
    expect(documentXml).toContain('<w:pStyle w:val="AveryStyle1"/>');
  });
});
