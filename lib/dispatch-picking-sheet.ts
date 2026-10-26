// Printable picking sheet for Dispatch Planning: the devices to fetch from
// stock because the Cabinet does not hold enough, the packaging and the
// accessories needed for the day, then every order grouped by kind with a box
// to tick. Kept free of the workbook parser so it can run in the browser.

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
  // Already deducted in an earlier dispatch but still to prepare today.
  carried: boolean;
};

export type PickingSheetGroup = {
  key: "vision" | "other";
  title: string;
  orders: PickingSheetOrder[];
};

export type PickingSheetLine = { name: string; quantity: number };

export type PickingSheet = {
  totalDevices: number;
  shortages: PickingSheetShortage[];
  packaging: PickingSheetLine[];
  accessories: PickingSheetLine[];
  groups: PickingSheetGroup[];
  orders: PickingSheetOrder[];
};

export type PickingSheetInputOrder = {
  orderId: string;
  deviceCounts?: Record<string, number>;
  items?: Array<{ name: string; quantity: number }>;
  packages?: Array<{ name: string; quantity: number }>;
  extras?: Array<{ name: string; quantity: number }>;
  carried?: boolean;
};

function deviceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Vision orders: the AIO camera (Queclink Vision CV200) and the Howen DVRs.
export function isVisionDevice(model: string) {
  const key = deviceKey(model);
  return key.includes("cv200") || key.startsWith("howen") || key.includes("dvr");
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

function addLine(lines: Map<string, PickingSheetLine>, name: string, quantity: number) {
  if (!name || !(quantity > 0)) return;
  const key = deviceKey(name);
  const current = lines.get(key);
  lines.set(key, { name: current?.name ?? name, quantity: (current?.quantity || 0) + quantity });
}

function sortedLines(lines: Map<string, PickingSheetLine>) {
  return Array.from(lines.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// Boxes first, then envelopes, then sleeves: the order they are picked in.
function packagingRank(name: string) {
  const key = name.toLowerCase();
  if (key.includes("sleeve")) return 2;
  if (key.includes("envelope")) return 1;
  return 0;
}

export function buildPickingSheet(
  orders: PickingSheetInputOrder[],
  cabinetStock: Record<string, number>,
  warehouseStock: Record<string, number | null>
): PickingSheet {
  const needed = new Map<string, { device: string; quantity: number }>();
  const packaging = new Map<string, PickingSheetLine>();
  const accessories = new Map<string, PickingSheetLine>();

  const sheetOrders = orders.map((order) => {
    const devices = Object.entries(order.deviceCounts || {})
      .map(([device, quantity]) => ({ device, quantity: Number(quantity) || 0 }))
      .filter((line) => line.quantity > 0)
      .sort((left, right) => left.device.localeCompare(right.device));
    const deviceKeys = new Set(devices.map((line) => deviceKey(line.device)));
    for (const line of devices) {
      const key = deviceKey(line.device);
      const current = needed.get(key);
      needed.set(key, {
        device: current?.device ?? line.device,
        quantity: (current?.quantity || 0) + line.quantity,
      });
    }
    for (const item of order.items || []) {
      if (!deviceKeys.has(deviceKey(item.name))) {
        addLine(accessories, item.name, Number(item.quantity) || 0);
      }
    }
    for (const item of [...(order.packages || []), ...(order.extras || [])]) {
      addLine(packaging, item.name, Number(item.quantity) || 0);
    }
    return { orderId: order.orderId, devices, carried: Boolean(order.carried) };
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

  const vision = sheetOrders.filter((order) =>
    order.devices.some((line) => isVisionDevice(line.device))
  );
  const other = sheetOrders.filter((order) => !vision.includes(order));
  const groups: PickingSheetGroup[] = [
    { key: "vision" as const, title: "Vision — AIO Camera & DVR", orders: vision },
    { key: "other" as const, title: "Other orders", orders: other },
  ].filter((group) => group.orders.length > 0);

  return {
    totalDevices: Array.from(needed.values()).reduce((sum, line) => sum + line.quantity, 0),
    shortages,
    packaging: sortedLines(packaging).sort(
      (a, b) => packagingRank(a.name) - packagingRank(b.name) || a.name.localeCompare(b.name)
    ),
    accessories: sortedLines(accessories),
    groups,
    orders: sheetOrders,
  };
}
