import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { permissionsForApi } from "../../lib/access-control";
import {
  formatPackagingDimensions,
  packagingAvailableStock,
  packagingCategoryLabel,
  packagingStockStatus,
  type PackagingStockRow,
} from "../../lib/packaging";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260819090000_add_packaging_inventory.sql"),
  "utf8"
).toLowerCase();
const binsPage = readFileSync(
  join(root, "app/(app)/bins/page.tsx"),
  "utf8"
);
const panel = readFileSync(
  join(root, "components/PackagingInventoryPanel.tsx"),
  "utf8"
);

function row(overrides: Partial<PackagingStockRow> = {}): PackagingStockRow {
  return {
    id: "6b7b5685-c8c6-4f9b-8941-f3e1985f7ce5",
    code: "TBD008",
    name: "Radius Box Medium",
    category: "BOX",
    length_cm: 20,
    width_cm: 13,
    height_cm: 5,
    on_hand_stock: 12,
    reserved_stock: 2,
    available_stock: 10,
    minimum_stock: 4,
    active: true,
    sort_order: 70,
    ...overrides,
  };
}

describe("packaging inventory", () => {
  it("computes available stock and status without allowing negative availability", () => {
    expect(packagingAvailableStock(12, 2)).toBe(10);
    expect(packagingAvailableStock(2, 8)).toBe(0);
    expect(packagingStockStatus(row())).toBe("OK");
    expect(packagingStockStatus(row({ available_stock: 4 }))).toBe("LOW");
    expect(packagingStockStatus(row({ available_stock: 0 }))).toBe("EMPTY");
    expect(packagingStockStatus(row({ active: false }))).toBe("INACTIVE");
  });

  it("uses the confirmed Radius Medium dimensions and professional labels", () => {
    expect(formatPackagingDimensions(row())).toBe("20 × 13 × 5 cm");
    expect(packagingCategoryLabel("BOX")).toBe("Box");
    expect(packagingCategoryLabel("BUBBLE_ENVELOPE")).toBe("Bubble Envelope");
    expect(packagingCategoryLabel("PLASTIC_ENVELOPE")).toBe("Plastic Envelope");
    expect(migration).toContain(
      "('tbd008', 'radius box medium', 'box', 20, 13, 5"
    );
    expect(migration).not.toContain("max_weight");
  });

  it("seeds every packaging format from the source workbook", () => {
    for (const code of [
      "tbd007",
      "tbd008",
      "tbd009",
      "tbd010",
      "tbd012",
      "tbd013",
      "tbd014",
      "tbd015",
      "tbd016",
      "sbe27x20",
      "mbe37x29",
      "pcr25b",
      "pcr34b",
      "plastic-l-50x38",
    ]) {
      expect(migration).toContain(`('${code}'`);
    }
  });

  it("keeps packaging tables and adjustment commands behind the service boundary", () => {
    expect(migration.trimStart()).toMatch(/^begin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain("alter table public.packaging_types enable row level security");
    expect(migration).toContain("alter table public.packaging_stock_movements enable row level security");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("function public.adjust_packaging_stock(");
    expect(migration).toContain("security definer");
    expect(migration).toContain("for update of packaging");
    expect(migration).toContain("on conflict (operation_id) do nothing");
    expect(migration).toContain("to service_role;");
    expect(permissionsForApi("/api/packaging/list", "GET")).toEqual(["can_bins"]);
    expect(permissionsForApi("/api/packaging/adjust", "POST")).toEqual(["can_bins"]);
  });

  it("exposes audited packaging management in Inventory Setup", () => {
    expect(binsPage).toContain('"packaging"');
    expect(binsPage).toContain("<PackagingInventoryPanel");
    expect(binsPage).toContain("Packaging Inventory");
    expect(panel).toContain("/api/packaging/adjust");
    expect(panel).toContain("/api/packaging/history");
    expect(panel).toContain("Required for the stock audit history.");
    expect(panel).not.toContain("maximum weight");
  });
});
