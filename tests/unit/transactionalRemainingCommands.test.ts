import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = join(
  root,
  "supabase/migrations/20260723160000_transactional_remaining_inventory_commands.sql"
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

const manualAccessoryRoute = read(
  "app/api/accessories/outbound/manual/route.ts"
);
const excelAccessoryRoute = read(
  "app/api/accessories/outbound/excel/route.ts"
);
const transferRoute = read("app/api/transfer/confirm/route.ts");
const outboundRoute = read("app/api/outbound/eod-confirm/route.ts");
const legacyOutboundRoute = read("app/api/outbound/route.ts");
const supplyCreateRoute = read("app/api/supply/create/route.ts");
const supplyUpdateRoute = read("app/api/supply/update/route.ts");
const supplyDeleteRoute = read("app/api/supply/delete/route.ts");
const accessoriesPage = read("app/(app)/accessories/page.tsx");
const transferPage = read("app/(app)/transfer/page.tsx");
const outboundPage = read("app/(app)/outbound/page.tsx");
const supplyPage = read("app/(app)/supply/page.tsx");

describe("remaining transactional inventory commands", () => {
  it("moves all five mutation families behind service-only database transactions", () => {
    for (const functionName of [
      "confirm_accessory_outbound",
      "confirm_transfer_batch",
      "confirm_outbound_batch",
      "create_supply_order",
      "transition_supply_order",
      "delete_supply_order",
    ]) {
      expect(migration).toContain(`function public.${functionName}(`);
      expect(migration).toContain(
        `revoke all on function public.${functionName}(`
      );
    }

    expect(migration.match(/security definer/g)?.length).toBe(6);
    expect(migration).toContain("to service_role;");
  });

  it("locks canonical rows and applies stock or floor changes with their audit rows", () => {
    expect(migration).toContain("from public.accessory_bins");
    expect(migration).toContain("for update");
    expect(migration).toContain(
      "set current_stock = bin.current_stock - v_bin.qty"
    );
    expect(migration).toContain("insert into public.accessory_movements");

    expect(migration).toContain("from public.boxes");
    expect(migration).toContain("insert into public.movements");
    expect(migration).toContain("'transfer'");
    expect(migration).toContain("update public.boxes");
  });

  it("makes confirmations and supply mutations idempotent", () => {
    expect(migration.match(/inventory_command_receipts/g)?.length).toBeGreaterThan(
      12
    );
    expect(migration).toContain("on conflict (operation_id) do nothing");

    for (const page of [
      accessoriesPage,
      transferPage,
      outboundPage,
      supplyPage,
    ]) {
      expect(page).toContain("operation_id:");
    }
  });

  it("cuts routes over to RPCs without direct multi-step table writes", () => {
    expect(manualAccessoryRoute).toMatch(
      /\.rpc\(\s*"confirm_accessory_outbound"/
    );
    expect(excelAccessoryRoute).toMatch(
      /\.rpc\(\s*"confirm_accessory_outbound"/
    );
    expect(transferRoute).toMatch(/\.rpc\(\s*"confirm_transfer_batch"/);
    expect(outboundRoute).toMatch(/\.rpc\(\s*"confirm_outbound_batch"/);
    expect(supplyCreateRoute).toMatch(/\.rpc\(\s*"create_supply_order"/);
    expect(supplyUpdateRoute).toMatch(/\.rpc\(\s*"transition_supply_order"/);
    expect(supplyDeleteRoute).toMatch(/\.rpc\(\s*"delete_supply_order"/);

    for (const route of [
      manualAccessoryRoute,
      excelAccessoryRoute,
      transferRoute,
      outboundRoute,
      supplyCreateRoute,
      supplyUpdateRoute,
      supplyDeleteRoute,
    ]) {
      expect(route).not.toMatch(/\.(insert|update|delete)\s*\(/);
    }
  });

  it("retires the unaudited legacy outbound endpoint", () => {
    expect(legacyOutboundRoute).toContain("status: 410");
    expect(legacyOutboundRoute).not.toContain("createClient");
    expect(legacyOutboundRoute).not.toContain('.from("items")');
  });

  it("keeps terminal supply orders immutable at the database boundary", () => {
    expect(migration).toContain("supply_terminal_locked");
    expect(migration).toContain("in ('imported', 'failed')");
  });
});
