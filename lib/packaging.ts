export const PACKAGING_CATEGORIES = [
  "BOX",
  "BUBBLE_ENVELOPE",
  "PLASTIC_ENVELOPE",
] as const;

export type PackagingCategory = (typeof PACKAGING_CATEGORIES)[number];

export type PackagingStockRow = {
  id: string;
  code: string;
  name: string;
  category: PackagingCategory;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  on_hand_stock: number;
  reserved_stock: number;
  available_stock: number;
  minimum_stock: number;
  active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type PackagingStockStatus = "OK" | "LOW" | "EMPTY" | "INACTIVE";

export function packagingCategoryLabel(category: PackagingCategory) {
  if (category === "BOX") return "Box";
  if (category === "BUBBLE_ENVELOPE") return "Bubble Envelope";
  return "Plastic Envelope";
}

export function packagingAvailableStock(
  onHandStock: number,
  reservedStock: number
) {
  return Math.max(0, Number(onHandStock || 0) - Number(reservedStock || 0));
}

export function packagingStockStatus(
  row: Pick<
    PackagingStockRow,
    "active" | "available_stock" | "minimum_stock"
  >
): PackagingStockStatus {
  if (!row.active) return "INACTIVE";
  if (row.available_stock <= 0) return "EMPTY";
  if (row.available_stock <= row.minimum_stock) return "LOW";
  return "OK";
}

function formatDimension(value: number) {
  return Number(value).toLocaleString("en-GB", {
    maximumFractionDigits: 2,
  });
}

export function formatPackagingDimensions(
  row: Pick<PackagingStockRow, "length_cm" | "width_cm" | "height_cm">
) {
  return `${formatDimension(row.length_cm)} × ${formatDimension(
    row.width_cm
  )} × ${formatDimension(row.height_cm)} cm`;
}
