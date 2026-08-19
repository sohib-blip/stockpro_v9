import { describe, expect, it } from "vitest";
import type { DashboardBinRow } from "../../lib/dashboard-bin-rows";
import {
  buildDashboardStockAlerts,
  mergeDashboardInventoryRows,
} from "../../lib/dashboard-inventory-rows";

describe("dashboard inventory rows", () => {
  it("replaces legacy package accessories with active packaging inventory", () => {
    const rows = mergeDashboardInventoryRows(
      [
        {
          id: "accessory-1",
          name: "Power Cable",
          category: "Items",
          current_stock: 12,
          minimum_stock: 5,
          active: true,
        },
        {
          id: "legacy-package",
          name: "Legacy Box",
          category: "Packages",
          current_stock: 99,
          minimum_stock: 10,
          active: true,
        },
        {
          id: "inactive-accessory",
          name: "Inactive Cable",
          category: "Items",
          current_stock: 0,
          minimum_stock: 5,
          active: false,
        },
      ],
      [
        {
          id: "package-1",
          code: "TBD008",
          name: "Radius Box Medium",
          length_cm: 20,
          width_cm: 13,
          height_cm: 5,
          on_hand_stock: 14,
          reserved_stock: 4,
          minimum_stock: 10,
          active: true,
        },
        {
          id: "inactive-package",
          code: "OLD",
          name: "Inactive Box",
          length_cm: 1,
          width_cm: 1,
          height_cm: 1,
          on_hand_stock: 0,
          reserved_stock: 0,
          minimum_stock: 1,
          active: false,
        },
      ]
    );

    expect(rows.map((row) => row.name)).toEqual([
      "Power Cable",
      "Radius Box Medium",
    ]);
    expect(rows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Legacy Box" })])
    );
    expect(rows.find((row) => row.name === "Radius Box Medium")).toMatchObject({
      bin: "TBD008",
      category: "Packages",
      source: "packaging",
      current_stock: 10,
      minimum_stock: 10,
      status: "LOW",
      details: "TBD008 · 20 × 13 × 5 cm",
      on_hand_stock: 14,
      reserved_stock: 4,
    });
  });

  it("builds one consolidated device, accessory and packaging alert list", () => {
    const bins: DashboardBinRow[] = [
      {
        device_id: "device-empty",
        device: "Neon-P",
        boxes_count: 0,
        imei_count: 0,
        min_stock: 50,
        stock_status: "empty",
      },
      {
        device_id: "device-ok",
        device: "Neon-R",
        boxes_count: 2,
        imei_count: 100,
        min_stock: 20,
        stock_status: "ok",
      },
    ];
    const inventory = mergeDashboardInventoryRows(
      [
        {
          id: "accessory-low",
          name: "Power Cable",
          category: "Items",
          current_stock: 5,
          minimum_stock: 5,
          active: true,
        },
      ],
      [
        {
          id: "package-empty",
          code: "TBD008",
          name: "Radius Box Medium",
          length_cm: 20,
          width_cm: 13,
          height_cm: 5,
          on_hand_stock: 2,
          reserved_stock: 3,
          minimum_stock: 10,
          active: true,
        },
      ]
    );

    expect(buildDashboardStockAlerts(bins, inventory)).toEqual([
      expect.objectContaining({
        inventory_type: "Device",
        name: "Neon-P",
        current_stock: 0,
        status: "EMPTY",
      }),
      expect.objectContaining({
        inventory_type: "Packaging",
        name: "Radius Box Medium",
        current_stock: 0,
        status: "EMPTY",
      }),
      expect.objectContaining({
        inventory_type: "Accessory",
        name: "Power Cable",
        current_stock: 5,
        status: "LOW",
      }),
    ]);
  });
});
