export type ActiveDashboardBin = {
  id: string;
  name: string;
  min_stock: number | null;
};

export type DashboardBinRow = {
  device_id: string;
  device: string;
  boxes_count: number;
  imei_count: number;
  min_stock: number;
  stock_status: "ok" | "low" | "empty";
  [key: string]: unknown;
};

export function mergeDashboardBinRows(
  activeBins: ActiveDashboardBin[],
  stockRows: Array<Record<string, unknown>>
): DashboardBinRow[] {
  const stockByBin = new Map(
    stockRows.map((row) => [String(row.device_id), row])
  );

  return activeBins.map((bin) => {
    const stockRow = stockByBin.get(String(bin.id)) ?? {};
    const imeiCount = Number(stockRow.imei_count ?? 0);
    const minimumStock = Number(bin.min_stock ?? stockRow.min_stock ?? 0);
    const stockStatus =
      imeiCount <= 0
        ? "empty"
        : minimumStock > 0 && imeiCount <= minimumStock
          ? "low"
          : "ok";

    return {
      ...stockRow,
      device_id: String(bin.id),
      device: bin.name,
      boxes_count: Number(stockRow.boxes_count ?? 0),
      imei_count: imeiCount,
      min_stock: minimumStock,
      stock_status: stockStatus,
    };
  });
}

export function isDashboardStockAlert(row: DashboardBinRow) {
  return row.stock_status === "low" || row.stock_status === "empty";
}
