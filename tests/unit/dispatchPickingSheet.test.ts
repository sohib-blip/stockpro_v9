import { describe, expect, it } from "vitest";
import {
  buildPickingSheet,
  isVisionDevice,
  type PickingSheetInputOrder,
} from "../../lib/dispatch-picking-sheet";
import { translateUiText } from "../../lib/i18n";

describe("dispatch picking sheet", () => {
  const orders: PickingSheetInputOrder[] = [
    { orderId: "231423", deviceCounts: { FMC880: 4, BarraGps: 18 } },
    { orderId: "231424", deviceCounts: { CNHYCV200XEU: 2 } },
    { orderId: "231425", deviceCounts: { FMC880: 42, FMC150: 5 } },
    { orderId: "231426", deviceCounts: {} },
  ];

  it("lists only the devices the Cabinet cannot cover", () => {
    const sheet = buildPickingSheet(
      orders,
      { FMC880: 30, BarraGps: 10, CNHYCV200XEU: 40, FMC150: 3 },
      { FMC880: 70, BarraGps: 100, CNHYCV200XEU: 40, FMC150: 3 }
    );

    expect(sheet.totalDevices).toBe(71);
    expect(sheet.shortages).toEqual([
      { device: "FMC880", needed: 46, inCabinet: 30, missing: 16, outOfStock: 0 },
      { device: "BarraGps", needed: 18, inCabinet: 10, missing: 8, outOfStock: 0 },
      { device: "FMC150", needed: 5, inCabinet: 3, missing: 2, outOfStock: 2 },
    ]);
  });

  it("writes one line per order with its devices", () => {
    const sheet = buildPickingSheet(orders, {}, {});
    expect(sheet.orders).toEqual([
      {
        orderId: "231423",
        devices: [
          { device: "BarraGps", quantity: 18 },
          { device: "FMC880", quantity: 4 },
        ],
        carried: false,
      },
      { orderId: "231424", devices: [{ device: "CNHYCV200XEU", quantity: 2 }], carried: false },
      {
        orderId: "231425",
        devices: [
          { device: "FMC150", quantity: 5 },
          { device: "FMC880", quantity: 42 },
        ],
        carried: false,
      },
      { orderId: "231426", devices: [], carried: false },
    ]);
    // Unknown warehouse stock does not claim a shortage of stock.
    expect(sheet.shortages.every((line) => line.outOfStock === null)).toBe(true);
  });

  it("puts AIO camera and DVR orders in the Vision group", () => {
    const sheet = buildPickingSheet(
      [
        ...orders,
        { orderId: "231427", deviceCounts: { Howen4CH: 1, FMC880: 1 } },
        { orderId: "231428", deviceCounts: { FMC003: 2 }, carried: true },
      ],
      {},
      {}
    );
    expect(sheet.groups.map((group) => [group.key, group.orders.map((order) => order.orderId)])).toEqual([
      ["vision", ["231424", "231427"]],
      ["other", ["231423", "231425", "231426", "231428"]],
    ]);
    expect(sheet.groups[1].orders.find((order) => order.orderId === "231428")?.carried).toBe(true);
    expect(isVisionDevice("CNHYCV200XEU")).toBe(true);
    expect(isVisionDevice("Howen8CH")).toBe(true);
    expect(isVisionDevice("FMC880")).toBe(false);
  });

  it("adds up the packaging and the accessories of every order", () => {
    const sheet = buildPickingSheet(
      [
        {
          orderId: "A",
          deviceCounts: { FMC880: 2 },
          items: [
            { name: "FMC880", quantity: 2 },
            { name: "Atom Adhesive Pad", quantity: 2 },
            { name: "Large Cable Ties", quantity: 4 },
          ],
          packages: [{ name: "Radius Box Small", quantity: 2 }],
          extras: [
            { name: "Small Sleeve", quantity: 2 },
            { name: "Small Plastic Envelope", quantity: 2 },
          ],
        },
        {
          orderId: "B",
          deviceCounts: { FMC880: 1 },
          items: [
            { name: "FMC880", quantity: 1 },
            { name: "Atom Adhesive Pad", quantity: 1 },
          ],
          packages: [
            { name: "Normal Box C", quantity: 1 },
            { name: "Radius Box Small", quantity: 1 },
          ],
          extras: [{ name: "Small Sleeve", quantity: 1 }],
          carried: true,
        },
      ],
      {},
      {}
    );
    expect(sheet.packaging).toEqual([
      { name: "Normal Box C", quantity: 1 },
      { name: "Radius Box Small", quantity: 3 },
      { name: "Small Plastic Envelope", quantity: 2 },
      { name: "Small Sleeve", quantity: 3 },
    ]);
    expect(sheet.accessories).toEqual([
      { name: "Atom Adhesive Pad", quantity: 3 },
      { name: "Large Cable Ties", quantity: 4 },
    ]);
  });

  it("matches stock names regardless of spelling", () => {
    const sheet = buildPickingSheet(
      [{ orderId: "1", deviceCounts: { "Neon-R": 3 } }],
      { "NEON R": 3 },
      { neonr: 3 }
    );
    expect(sheet.shortages).toEqual([]);
  });

  it("translates the sheet", () => {
    expect(translateUiText("fr", "Go get from stock")).toBe("À aller chercher dans le stock");
    expect(translateUiText("fr", "19 Oct 2026 · 23 orders · 120 devices · day.xlsx")).toBe(
      "19 Oct 2026 · 23 commandes · 120 appareils · day.xlsx"
    );
    expect(translateUiText("fr", "26 Oct 2026 · 23 orders · 120 devices · 86 packages · day.xlsx")).toBe(
      "26 Oct 2026 · 23 commandes · 120 appareils · 86 emballages · day.xlsx"
    );
    expect(translateUiText("fr", "Vision — AIO Camera & DVR (5)")).toBe("Vision — caméra AIO et DVR (5)");
    expect(translateUiText("nl", "needed 46 · Cabinet 30")).toBe("nodig 46 · Cabinet 30");
  });
});
