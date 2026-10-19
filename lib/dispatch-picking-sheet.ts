// Printable picking sheet for Dispatch Planning: the devices to fetch from
// stock because the Cabinet does not hold enough, then one line per order.
// Kept free of the workbook parser so it can run in the browser.

export type PickingSheetShortage = {
  device: string;
  needed: number;
  inCabinet: number;
  missing: number;
  // Devices still missing after counting the whole warehouse, if known.
  outOfStock: number | null;
};

export type PickingSheetOrder = {
  orderId: string;
  devices: Array<{ device: string; quantity: number }>;
};

export type PickingSheet = {
  totalDevices: number;
  shortages: PickingSheetShortage[];
  orders: PickingSheetOrder[];
};

function deviceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stockByKey(stock: Record<string, number | null | undefined>) {
  const byKey = new Map<string, number>();
  for (const [name, quantity] of Object.entries(stock)) {
    if (quantity === null || quantity === undefined) continue;
    const key = deviceKey(name);
    byKey.set(key, (byKey.get(key) || 0) + Math.max(0, Number(quantity) || 0));
  }
  return byKey;
}

export function buildPickingSheet(
  orders: Array<{ orderId: string; deviceCounts?: Record<string, number> }>,
  cabinetStock: Record<string, number>,
  warehouseStock: Record<string, number | null>
): PickingSheet {
  const needed = new Map<string, { device: string; quantity: number }>();
  const sheetOrders = orders.map((order) => {
    const devices = Object.entries(order.deviceCounts || {})
      .map(([device, quantity]) => ({ device, quantity: Number(quantity) || 0 }))
      .filter((line) => line.quantity > 0)
      .sort((left, right) => left.device.localeCompare(right.device));
    for (const line of devices) {
      const key = deviceKey(line.device);
      const current = needed.get(key);
      needed.set(key, {
        device: current?.device ?? line.device,
        quantity: (current?.quantity || 0) + line.quantity,
      });
    }
    return { orderId: order.orderId, devices };
  });

  const cabinet = stockByKey(cabinetStock);
  const warehouse = stockByKey(warehouseStock);
  const shortages = Array.from(needed, ([key, line]) => {
    const inCabinet = cabinet.get(key) || 0;
    const total = warehouse.get(key);
    return {
      device: line.device,
      needed: line.quantity,
      inCabinet,
      missing: Math.max(0, line.quantity - inCabinet),
      outOfStock: total === undefined ? null : Math.max(0, line.quantity - total),
    };
  })
    .filter((line) => line.missing > 0)
    .sort((left, right) => right.missing - left.missing || left.device.localeCompare(right.device));

  return {
    totalDevices: Array.from(needed.values()).reduce((sum, line) => sum + line.quantity, 0),
    shortages,
    orders: sheetOrders,
  };
}
