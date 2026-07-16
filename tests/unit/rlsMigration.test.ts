import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260716_harden_rls.sql"),
  "utf8"
).toLowerCase();

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

describe("RLS hardening migration", () => {
  it("enables RLS for every active application table", () => {
    for (const table of activeTables) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`
      );
    }
  });

  it("blocks anonymous privileges and removes development policies", () => {
    expect(migration).toContain(
      "revoke all privileges on all tables in schema public from anon, authenticated;"
    );
    expect(migration).toContain(
      "revoke all privileges on all functions in schema public from public, anon, authenticated;"
    );
    expect(migration).not.toContain("create policy dev_all");
    expect(migration).not.toContain("disable row level security");
  });

  it("keeps profile access scoped to the authenticated owner", () => {
    expect(migration).toContain("create policy profiles_select_own");
    expect(migration).toContain("create policy profiles_insert_own");
    expect(migration).toContain("create policy profiles_update_own");
    expect(migration).toContain("(select auth.uid()) = user_id");
  });

  it("makes every active view use the caller's RLS", () => {
    for (const view of activeViews) {
      expect(migration).toMatch(
        new RegExp(
          `(alter view public\\.${view} set \\(security_invoker = true\\)|` +
            `create or replace view public\\.${view}[\\s\\S]*?security_invoker = true)`
        )
      );
    }
  });

  it("keeps the outbound mutation RPC service-only", () => {
    expect(migration).toContain(
      "revoke all privileges on function public.confirm_outbound_batch("
    );
    expect(migration).toContain(
      ") from public, anon, authenticated;"
    );
    expect(migration).toContain(
      ") to service_role;"
    );
  });

  it("avoids destructive shortcuts", () => {
    expect(migration.trimStart()).toMatch(/^begin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).not.toContain(" cascade");
  });
});
