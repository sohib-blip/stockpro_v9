import type { DashboardBinRow } from "@/lib/dashboard-bin-rows";

export type DashboardInventoryStatus = "OK" | "LOW" | "EMPTY";

export type DashboardAccessoryInput = {
  id: string;
  name: string;
  category: string | null;
  current_stock: number | null;
  minimum_stock: number | null;
  active: boolean;
};

export type DashboardPackagingInput = {
  id: string;
  code: string;
  name: string;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  on_hand_stock: number;
  reserved_stock: number;
  minimum_stock: number;
  active: boolean;
};

export type DashboardInventoryRow = {
  id: string;
  name: string;
  bin: string;
  category: string;
  source: "accessory" | "packaging";
  current_stock: number;
  minimum_stock: number;
  status: DashboardInventoryStatus;
  details?: string;
  on_hand_stock?: number;
  reserved_stock?: number;
};

export type DashboardStockAlertRow = {
  id: string;
  inventory_type: "Device" | "Accessory" | "Packaging";
  name: string;
  current_stock: number;
  minimum_stock: number;
  status: "LOW" | "EMPTY";
};

export function dashboardInventoryStatus(
  stockValue: number,
  minimumValue: number
): DashboardInventoryStatus {
  const stock = Number(stockValue || 0);
  const minimum = Number(minimumValue || 0);
  if (stock <= 0) return "EMPTY";
  if (minimum > 0 && stock <= minimum) return "LOW";
  return "OK";
}

function dimension(value: number) {
  return Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

export function mergeDashboardInventoryRows(
  accessories: DashboardAccessoryInput[],
  packaging: DashboardPackagingInput[]
): DashboardInventoryRow[] {
  const accessoryRows = accessories
    .filter((row) => row.active && row.category !== "Packages")
    .map((row) => {
      const stock = Number(row.current_stock || 0);
      const minimum = Number(row.minimum_stock || 0);
      return {
        id: String(row.id),
        name: row.name,
        bin: row.name,
        category: row.category || "Consumables",
        source: "accessory" as const,
        current_stock: stock,
        minimum_stock: minimum,
        status: dashboardInventoryStatus(stock, minimum),
      };
    });

  const packagingRows = packaging
    .filter((row) => row.active)
    .map((row) => {
      const onHand = Number(row.on_hand_stock || 0);
      const reserved = Number(row.reserved_stock || 0);
      const available = Math.max(0, onHand - reserved);
      const minimum = Number(row.minimum_stock || 0);
      return {
        id: `packaging:${row.id}`,
        name: row.name,
        bin: row.code,
        category: "Packages",
        source: "packaging" as const,
        current_stock: available,
        minimum_stock: minimum,
        status: dashboardInventoryStatus(available, minimum),
        details: `${row.code} · ${dimension(row.length_cm)} × ${dimension(
          row.width_cm
        )} × ${dimension(row.height_cm)} cm`,
        on_hand_stock: onHand,
        reserved_stock: reserved,
      };
    });

  return [...accessoryRows, ...packagingRows].sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" })
  );
}

export function buildDashboardStockAlerts(
  bins: DashboardBinRow[],
  inventoryRows: DashboardInventoryRow[]
): DashboardStockAlertRow[] {
  const deviceAlerts: DashboardStockAlertRow[] = bins.flatMap((row) => {
    if (row.stock_status !== "low" && row.stock_status !== "empty") return [];
    return [
      {
        id: `device:${row.device_id}`,
        inventory_type: "Device",
        name: row.device,
        current_stock: Number(row.imei_count || 0),
        minimum_stock: Number(row.min_stock || 0),
        status: row.stock_status === "empty" ? "EMPTY" : "LOW",
      },
    ];
  });

  const accessoryAlerts: DashboardStockAlertRow[] = inventoryRows.flatMap(
    (row) => {
      if (row.status !== "LOW" && row.status !== "EMPTY") return [];
      return [
        {
          id: `${row.source}:${row.id}`,
          inventory_type: row.source === "packaging" ? "Packaging" : "Accessory",
          name: row.name,
          current_stock: row.current_stock,
          minimum_stock: row.minimum_stock,
          status: row.status,
        },
      ];
    }
  );

  return [...deviceAlerts, ...accessoryAlerts].sort((left, right) => {
    if (left.status !== right.status) return left.status === "EMPTY" ? -1 : 1;
    if (left.inventory_type !== right.inventory_type) {
      return left.inventory_type.localeCompare(right.inventory_type);
    }
    return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
  });
}
