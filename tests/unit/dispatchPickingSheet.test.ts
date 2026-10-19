import { describe, expect, it } from "vitest";
import { buildPickingSheet } from "../../lib/dispatch-picking-sheet";
import { translateUiText } from "../../lib/i18n";

describe("dispatch picking sheet", () => {
  const orders: Array<{ orderId: string; deviceCounts: Record<string, number> }> = [
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
      },
      { orderId: "231424", devices: [{ device: "CNHYCV200XEU", quantity: 2 }] },
      {
        orderId: "231425",
        devices: [
          { device: "FMC150", quantity: 5 },
          { device: "FMC880", quantity: 42 },
        ],
      },
      { orderId: "231426", devices: [] },
    ]);
    // Unknown warehouse stock does not claim a shortage of stock.
    expect(sheet.shortages.every((line) => line.outOfStock === null)).toBe(true);
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
    expect(translateUiText("nl", "needed 46 · Cabinet 30")).toBe("nodig 46 · Cabinet 30");
  });
});
