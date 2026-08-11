import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260716_remove_unused_legacy_schema.sql"
  ),
  "utf8"
).toLowerCase();

const unusedTables = [
  "box_movements",
  "device_aliases",
  "device_stock",
  "imeis",
  "import_batches",
  "inbound_import_boxes",
  "inbound_import_log_boxes",
  "inbound_import_logs",
  "inbound_imports",
  "inbound_imports_log",
  "outbound_batches",
  "stock_count_scans",
  "stock_counts",
];

const activeTables = [
  "accessory_bins",
  "accessory_movements",
  "alert_log",
  "alert_subscribers",
  "audit_events",
  "bins",
  "boxes",
  "device_accessory_templates",
  "device_thresholds",
  "devices",
  "inbound_batches",
  "items",
  "movements",
  "nrd_time_logs",
  "profiles",
  "supplies",
  "supply_items",
  "supply_status_history",
  "user_permissions",
  "user_roles",
];

const activeViews = [
  "dashboard_activity",
  "dashboard_bins_view",
  "dashboard_device_flow",
  "dashboard_drilldown_view",
  "dashboard_floors_view",
  "dashboard_sales_month",
  "inbound_history_view",
  "stock_export_view",
];

describe("legacy schema cleanup migration", () => {
  it("removes every audited unused table", () => {
    for (const table of unusedTables) {
      expect(migration).toContain(`drop table if exists public.${table};`);
    }
  });

  it("does not remove active tables or views", () => {
    for (const table of activeTables) {
      expect(migration).not.toContain(`drop table if exists public.${table};`);
    }

    for (const view of activeViews) {
      expect(migration).not.toContain(`drop view if exists public.${view};`);
    }
  });

  it("avoids cascading or partial cleanup", () => {
    expect(migration.trimStart()).toMatch(/^begin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).not.toContain(" cascade");
  });
});
