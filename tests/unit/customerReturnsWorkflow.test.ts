import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/migrations/20260811143000_expand_customer_returns.sql"
).toLowerCase();
const deviceMigration = read(
  "supabase/migrations/20260811163500_add_return_reported_device.sql"
).toLowerCase();
const confirmRoute = read("app/api/returns/confirm/route.ts");
const previewRoute = read("app/api/returns/preview/route.ts");
const historyRoute = read("app/api/returns/history/route.ts");
const exportRoute = read("app/api/returns/export/route.ts");
const page = read("app/(app)/returns/page.tsx");
const returnConstants = read("lib/returns.ts");

describe("complete customer return workflow", () => {
  it("keeps a service-only per-IMEI return audit ledger", () => {
    expect(migration).toContain("create table if not exists public.return_records");
    expect(migration).toContain("alter table public.return_records enable row level security");
    expect(migration).toContain(
      "revoke all on table public.return_records\n  from public, anon, authenticated"
    );
    expect(migration).toContain("to service_role");
    expect(migration).toContain("unique\n    references public.movements");
  });

  it("changes canonical inventory only for Available returns", () => {
    expect(migration).toContain("if v_status = 'available' then");
    expect(migration).toContain("set status = 'in'");
    expect(migration).toContain("v_logged_only := v_logged_only + 1");
    expect(migration).toContain(
      "case when v_status = 'available' then 'added_to_stock' else 'no_stock_change' end"
    );
    expect(migration).toContain("insert into public.return_records");
    expect(migration).toContain("return_item_state_changed");
  });

  it("uses canonical devices for stock returns and declared devices otherwise", () => {
    expect(deviceMigration).toContain("add column if not exists reported_device");
    expect(deviceMigration).toContain(
      "when v_status = 'available' then v_item.canonical_device"
    );
    expect(deviceMigration).toContain("else v_reported_device");
    expect(deviceMigration).toContain("return_device_invalid");
    expect(confirmRoute).toContain("p_reported_device");
    expect(previewRoute).toContain("matchReturnDeviceOption");
  });

  it("requires complete business metadata on the server", () => {
    for (const field of [
      "return_ref",
      "return_type",
      "return_reason",
      "return_status",
      "courier",
      "country_code",
      "customer",
      "sur_id",
      "reported_device",
    ]) {
      expect(confirmRoute).toContain(`${field}:`);
      expect(`${migration}\n${deviceMigration}`).toContain(`p_${field}`);
    }
    expect(confirmRoute).toContain('command.return_status === "available"');
    expect(confirmRoute).toContain("A target box is required for Available returns");
    expect(previewRoute).toContain("RETURN_STATUS_VALUES");
  });

  it("removes manual tracking/date fields and explains automatic timestamps", () => {
    expect(page).not.toContain("Tracking number");
    expect(page).not.toContain('aria-label="Return date"');
    expect(page).toContain(
      "Return date and time are recorded automatically on confirmation."
    );
    expect(page).toContain('useState<ReturnStatus>("available")');
    expect(returnConstants).toContain("Returned — Unprocessed");
    expect(page).toContain("stock remains unchanged");
    expect(page).toContain('aria-label="Return device"');
    expect(page).toContain("filteredDeviceOptions");
    for (const model of [
      "LMU2640",
      "FMT100",
      "FMB020",
      "FMB003",
      "FMB920",
      "FMB130",
      "GL50B",
      "FMB640",
      "FMB641",
      "FMB204",
      "Badai",
    ]) {
      expect(returnConstants).toContain(model);
    }
  });

  it("serves bounded filterable history and a complete Brussels-time export", () => {
    expect(historyRoute).toMatch(/\.rpc\(\s*"get_return_history_page"/);
    for (const filter of [
      "p_search",
      "p_month",
      "p_return_status",
      "p_courier",
      "p_country_code",
    ]) {
      expect(historyRoute).toContain(`${filter}:`);
    }
    expect(exportRoute).toContain('.from("return_records")');
    expect(exportRoute).toContain('timeZone: "Europe/Brussels"');
    for (const column of [
      "Return date & time",
      "Return reference",
      "SUR ID",
      "Customer",
      "Courier",
      "Country",
      "Device",
      "IMEI",
      "Status",
      "Stock action",
      "Processed by",
    ]) {
      expect(exportRoute).toContain(column);
    }
    expect(exportRoute).not.toContain("Tracking number");
  });
});
