import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = join(process.cwd(), "supabase", "migrations");
const exportPermission = readFileSync(
  join(migrations, "20260723090000_add_sensitive_export_permission.sql"),
  "utf8"
).toLowerCase();
const inventoryHardening = readFileSync(
  join(migrations, "20260723090100_harden_inventory_authorization.sql"),
  "utf8"
).toLowerCase();
const inboundPage = readFileSync(
  join(process.cwd(), "app", "(app)", "inbound", "page.tsx"),
  "utf8"
);
const migrationFiles = readdirSync(migrations)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const hardeningIndex = migrationFiles.indexOf(
  "20260723090100_harden_inventory_authorization.sql"
);
const migrationsAfterHardening = migrationFiles
  .slice(hardeningIndex)
  .map((name) => readFileSync(join(migrations, name), "utf8").toLowerCase())
  .join("\n");

describe("inventory authorization boundary migrations", () => {
  it("adds the dedicated export permission to the database permission helper", () => {
    expect(exportPermission).toContain(
      "add column if not exists can_inventory_export"
    );
    expect(exportPermission).toContain(
      "when 'can_inventory_export' then p.can_inventory_export"
    );
    expect(exportPermission).toContain(
      "create or replace function private.has_permission"
    );
  });

  it("makes can_bins the only policy capable of admitting bin writes", () => {
    expect(inventoryHardening).toContain(
      "drop policy if exists bins_authenticated_all on public.bins;"
    );
    expect(inventoryHardening).toContain(
      "create policy bins_authenticated_read"
    );
    expect(inventoryHardening).toContain(
      "create policy bins_permission_write"
    );
    expect(inventoryHardening).toContain(
      "private.has_permission((select auth.uid()), 'can_bins')"
    );
    expect(inventoryHardening).not.toContain(
      "create policy bins_authenticated_all"
    );
  });

  it("removes generic IMEI and movement-history reads", () => {
    expect(inventoryHardening).toContain(
      "revoke select on table public.items from authenticated;"
    );
    expect(inventoryHardening).toContain(
      "revoke select on table public.movements from authenticated;"
    );
    expect(inventoryHardening).toContain(
      "drop policy if exists items_authenticated_read on public.items;"
    );
    expect(inventoryHardening).toContain(
      "drop policy if exists movements_authenticated_read on public.movements;"
    );
    expect(hardeningIndex).toBeGreaterThanOrEqual(0);
    expect(migrationsAfterHardening).not.toMatch(
      /grant\s+select\s+on\s+(table\s+)?public\.(items|movements)\s+to\s+authenticated/
    );
    expect(migrationsAfterHardening).not.toContain(
      "create policy bins_authenticated_all"
    );
  });

  it("exposes only a bounded, permission-aware exact IMEI match RPC", () => {
    expect(inventoryHardening).toContain(
      "function public.check_existing_imeis(requested_imeis text[])"
    );
    expect(inventoryHardening).toContain("security definer");
    expect(inventoryHardening).toContain(
      "set search_path = pg_catalog, public, private"
    );
    expect(inventoryHardening).toContain(
      "private.has_permission((select auth.uid()), 'can_inbound')"
    );
    expect(inventoryHardening).toContain(
      "cardinality(requested_imeis) not between 1 and 200"
    );
    expect(inventoryHardening).toContain(
      "where i.imei = any(requested_imeis)"
    );
    expect(inventoryHardening).toContain("select distinct i.imei::text");
    expect(inventoryHardening).toContain(
      "grant execute on function public.check_existing_imeis(text[]) to authenticated;"
    );
  });

  it("uses the bounded RPC instead of direct browser access to items", () => {
    expect(inboundPage).toContain('.rpc("check_existing_imeis"');
    expect(inboundPage).not.toMatch(
      /\.from\("items"\)[\s\S]{0,120}\.select\("imei"\)/
    );
  });
});
