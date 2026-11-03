import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { permissionsForApi } from "../../lib/access-control";
import { translateUiText } from "../../lib/i18n";
import { includedAccessoryLines, type InboundAccessoryRule } from "../../lib/inbound-accessories";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261103100000_add_inbound_included_accessories.sql"),
  "utf8"
);

const RULES: InboundAccessoryRule[] = [
  { id: "r1", device_id: "cv200", accessory_bin_id: "harness", accessory: "HARDWIRED Cable for CV200", quantity: 1 },
  { id: "r2", device_id: "fmc003", accessory_bin_id: "obd", accessory: "OBD Cable FMC003", quantity: 1 },
  { id: "r3", device_id: "cv200", accessory_bin_id: "pad", accessory: "CV200 Adhesive Pad\tCVAP01", quantity: 2 },
];

describe("accessories included at inbound", () => {
  it("adds the accessories of the new devices of each model", () => {
    expect(includedAccessoryLines(RULES, { cv200: 10 })).toEqual([
      { ruleId: "r3", deviceId: "cv200", accessory: "CV200 Adhesive Pad\tCVAP01", perDevice: 2, devices: 10, qty: 20 },
      { ruleId: "r1", deviceId: "cv200", accessory: "HARDWIRED Cable for CV200", perDevice: 1, devices: 10, qty: 10 },
    ]);
    expect(includedAccessoryLines(RULES, { cv200: 0, fmc003: 3 }).map((line) => [line.accessory, line.qty])).toEqual([
      ["OBD Cable FMC003", 3],
    ]);
    expect(includedAccessoryLines(RULES, {})).toEqual([]);
  });

  it("adds them in the inbound command itself, for new devices only", () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration).toContain("create table if not exists public.device_inbound_accessories");
    expect(migration).toContain("quantity integer not null check (quantity between 1 and 1000)");
    expect(migration).toContain("alter table public.device_inbound_accessories enable row level security;");
    expect(migration).toContain("revoke all on table public.device_inbound_accessories from public, anon, authenticated;");
    expect(migration).toContain("drop function if exists public.confirm_inbound_batch(uuid, uuid, text, text, text, text, jsonb);");
    expect(migration).toContain("p_skip_included_accessories uuid[] default '{}'");
    expect(migration).toContain("where item.import_id = v_batch_id");
    expect(migration).toContain("and not (rule.id = any(coalesce(p_skip_included_accessories, '{}'::uuid[])))");
    expect(migration).toContain("set current_stock = coalesce(current_stock, 0) + v_included.qty");
    expect(migration).toContain("'IN',");
    expect(migration).toContain("'included_accessories', v_included_accessories");
    expect(migration).toContain(
      "grant execute on function public.confirm_inbound_batch(uuid, uuid, text, text, text, text, jsonb, uuid[])\n  to service_role;"
    );
    // The MatrixIQ rule is kept.
    expect(migration).toContain("!~ public.stockpro_device_id_pattern(bin.name)");
  });

  it("keeps settings for Inventory Setup and the list for Inbound", () => {
    expect(permissionsForApi("/api/bins/inbound-accessories", "POST")).toEqual(["can_bins"]);
    expect(permissionsForApi("/api/inbound/included-accessories", "GET")).toEqual(["can_inbound"]);
  });

  it("translates the new texts", () => {
    expect(translateUiText("fr", "Accessories included with these devices")).toBe("Accessoires inclus avec ces appareils");
    expect(translateUiText("fr", "Included at inbound for CNHYCV200XEU")).toBe("Inclus à la réception pour CNHYCV200XEU");
    expect(translateUiText("nl", "1 per device · 10 new CNHYCV200XEU")).toBe("1 per toestel · 10 nieuwe CNHYCV200XEU");
  });
});
