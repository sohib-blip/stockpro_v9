import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { translateUiText } from "../../lib/i18n";
import { buildAccessoryEndOfDayPreview } from "../../lib/outbound/accessoryEndOfDay";
import { parseEndOfDayWorkbook } from "../../lib/outbound/endOfDayParser";
import {
  applyDispatchAutomaticAccessoryRules,
  createInventoryDispatchCatalog,
  parseDispatchWorkbook,
} from "../../lib/dispatch-planning";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261103120000_add_per_order_accessory_rules.sql"),
  "utf8"
);

const imei = (n: number) => `86503106476${String(n).padStart(4, "0")}`;

function endOfDay(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Order Ref", "Item Type", "IMEI / ID", "Companion Device IMEI"], ...rows]),
    "RADIUS"
  );
  return parseEndOfDayWorkbook(book, { accessoryNames: ["QR code"] });
}

const BINS = [
  { id: "qr", name: "QR code", current_stock: 100 },
  { id: "cable", name: "TEST Power Cable", current_stock: 100 },
];

describe("automatic accessory rules per order", () => {
  // O1: 3 FMC880. O2: 1 FMC880. O3: 2 FMC880 + 1 FMB140. O4: 1 FMB140 only.
  const report = endOfDay([
    ["O1", "ATOM", imei(1), "N/A"],
    ["O1", "ATOM", imei(2), "N/A"],
    ["O1", "ATOM", imei(3), "N/A"],
    ["O2", "ATOM", imei(4), "N/A"],
    ["O3", "ATOM", imei(5), "N/A"],
    ["O3", "ATOM", imei(6), "N/A"],
    ["O3", "HARDWIRED", imei(7), "N/A"],
    ["O4", "HARDWIRED", imei(8), "N/A"],
  ]);
  const stockItems = [1, 2, 3, 4, 5, 6].map((n) => ({ imei: imei(n), device_id: "fmc880" }))
    .concat([7, 8].map((n) => ({ imei: imei(n), device_id: "fmb140" })));

  it("removes the quantity once per order that contains the device model", () => {
    const { rows, issues } = buildAccessoryEndOfDayPreview({
      report,
      accessoryBins: BINS,
      stockItems,
      templates: [{ device_id: "fmc880", accessory_bin_id: "qr", quantity: 1, per_devices: 1, per_order: true }],
    });
    expect(issues).toEqual([]);
    // O1, O2 and O3 contain a FMC880: 3 QR codes, not 6 (one per device).
    expect(rows.map((row) => [row.accessory, row.qty])).toEqual([["QR code", 3]]);
  });

  it("gives an order the largest quantity once when several of its models have the rule", () => {
    const { rows } = buildAccessoryEndOfDayPreview({
      report,
      accessoryBins: BINS,
      stockItems,
      templates: [
        { device_id: "fmc880", accessory_bin_id: "qr", quantity: 1, per_devices: 1, per_order: true },
        { device_id: "fmb140", accessory_bin_id: "qr", quantity: 2, per_devices: 1, per_order: true },
        // Rules per devices keep working next to them.
        { device_id: "fmb140", accessory_bin_id: "cable", quantity: 1, per_devices: 1, per_order: false },
      ],
    });
    // QR: O1 1 + O2 1 + O3 max(1, 2) = 2 + O4 2 = 6. Cable: 2 FMB140 devices.
    expect(rows.map((row) => [row.accessory, row.qty])).toEqual([
      ["QR code", 6],
      ["TEST Power Cable", 2],
    ]);
  });

  it("still removes a report line and a rule only once", () => {
    const withLine = endOfDay([
      ["O1", "ATOM", imei(1), "N/A"],
      ["O1", "QR code", imei(1), "N/A"],
      ["O2", "ATOM", imei(4), "N/A"],
    ]);
    const { rows } = buildAccessoryEndOfDayPreview({
      report: withLine,
      accessoryBins: BINS,
      stockItems,
      templates: [{ device_id: "fmc880", accessory_bin_id: "qr", quantity: 1, per_devices: 1, per_order: true }],
    });
    expect(rows.map((row) => [row.report_qty, row.template_qty, row.qty])).toEqual([[1, 1, 2]]);
  });

  it("counts a device line without Order Ref as its own order", () => {
    const noRef = endOfDay([
      ["", "ATOM", imei(1), "N/A"],
      ["", "ATOM", imei(2), "N/A"],
    ]);
    const { rows } = buildAccessoryEndOfDayPreview({
      report: noRef,
      accessoryBins: BINS,
      stockItems,
      templates: [{ device_id: "fmc880", accessory_bin_id: "qr", quantity: 1, per_devices: 1, per_order: true }],
    });
    expect(rows.map((row) => row.qty)).toEqual([2]);
  });

  it("adds the accessory once per order in Dispatch Planning", () => {
    const record = (name: string, dimensions: [number, number, number]) => ({
      name,
      lengthCm: dimensions[0],
      widthCm: dimensions[1],
      heightCm: dimensions[2],
      kinesisNames: [],
    });
    const catalog = createInventoryDispatchCatalog([], [record("QR code", [5, 5, 0.1])]);
    const line = (order: string, n: number) => [`TST${n}`, "ATOM", "Teltonika - Atom-E 4G - FMC880", order, `LINE-${n}`, "GB", "Test Company"];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Kinesis Dispatch Details"],
        ["Report Generated:", "Mon Nov 03 09:00:00 GMT 2026"],
        ["Number of Orders:", "2"],
        [],
        ["Vehicle Registration", "Hardware Type", "Device Type", "Order ID", "Order Line ID", "Destination Country", "Company Name"],
        line("ORDER-1", 1),
        line("ORDER-1", 2),
        line("ORDER-1", 3),
        line("ORDER-2", 4),
      ]),
      "Vehicles"
    );
    const parsed = parseDispatchWorkbook(book, catalog);
    const enriched = applyDispatchAutomaticAccessoryRules(
      parsed.orders,
      [
        { deviceModel: "FMC880", accessoryName: "QR code", quantity: 1, perDevices: 1, perOrder: true },
        // A second per-order rule for the same accessory: the largest, once.
        { deviceModel: "FMC880", accessoryName: "QR code", quantity: 2, perDevices: 1, perOrder: true },
      ],
      catalog
    );
    expect(enriched.issues).toEqual([]);
    expect(
      enriched.orders.map((order) => [order.orderId, order.items.find((item) => item.name === "QR code")?.automaticQuantity])
    ).toEqual([
      ["ORDER-1", 2],
      ["ORDER-2", 2],
    ]);
  });

  it("adds the per-order flag without changing existing rules", () => {
    expect(migration).toContain("add column if not exists per_order boolean not null default false");
    expect(migration.trimEnd()).toMatch(/notify pgrst, 'reload schema';$/);
  });

  it("translates the new texts", () => {
    expect(translateUiText("fr", "Per order")).toBe("Par commande");
    expect(translateUiText("fr", "Per 5 devices")).toBe("Tous les 5 appareils");
    expect(translateUiText("nl", "Per 1 device")).toBe("Per toestel");
  });
});
