import { describe, expect, it } from "vitest";
import {
  isDashboardStockAlert,
  mergeDashboardBinRows,
} from "../../lib/dashboard-bin-rows";

describe("dashboard bin rows", () => {
  it("keeps active bins that do not have boxes or IMEIs", () => {
    const rows = mergeDashboardBinRows(
      [
        { id: "bin-empty", name: "EMPTY-BIN", min_stock: 10 },
        { id: "bin-stocked", name: "STOCKED-BIN", min_stock: 5 },
      ],
      [
        {
          device_id: "bin-stocked",
          device: "Old name",
          boxes_count: 2,
          imei_count: 12,
          min_stock: 1,
        },
      ]
    );

    expect(rows).toEqual([
      {
        device_id: "bin-empty",
        device: "EMPTY-BIN",
        boxes_count: 0,
        imei_count: 0,
        min_stock: 10,
        stock_status: "empty",
      },
      {
        device_id: "bin-stocked",
        device: "STOCKED-BIN",
        boxes_count: 2,
        imei_count: 12,
        min_stock: 5,
        stock_status: "ok",
      },
    ]);
    expect(rows.filter(isDashboardStockAlert)).toHaveLength(1);
  });

  it("marks stocked bins at or below their minimum as low", () => {
    const [row] = mergeDashboardBinRows(
      [{ id: "bin-low", name: "LOW-BIN", min_stock: 5 }],
      [{ device_id: "bin-low", boxes_count: 1, imei_count: 5 }]
    );

    expect(row.stock_status).toBe("low");
    expect(isDashboardStockAlert(row)).toBe(true);
  });
});
