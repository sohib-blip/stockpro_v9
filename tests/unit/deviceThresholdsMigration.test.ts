import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261106090000_restrict_device_thresholds.sql"
  ),
  "utf8"
)
  .toLowerCase()
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ");

describe("device thresholds RLS migration", () => {
  it("runs in one transaction", () => {
    expect(migration.trim().startsWith("begin;")).toBe(true);
    expect(migration.trim().endsWith("commit;")).toBe(true);
  });

  it("removes the policy that let any signed-in account change thresholds", () => {
    expect(migration).toContain(
      "drop policy if exists thresholds_authenticated_all on public.device_thresholds;"
    );
    expect(migration).not.toContain("create policy thresholds_authenticated_all");
    expect(migration).not.toMatch(/for (all|insert|update|delete) to authenticated/);
  });

  it("keeps reading for StockPro users only", () => {
    expect(migration).toContain(
      "create policy thresholds_authenticated_read on public.device_thresholds for select to authenticated using (private.has_app_role((select auth.uid())));"
    );
  });

  it("revokes browser writes and keeps read access", () => {
    expect(migration).toContain(
      "revoke all privileges on table public.device_thresholds from public, anon;"
    );
    expect(migration).toContain(
      "revoke insert, update, delete, truncate, references, trigger on table public.device_thresholds from authenticated;"
    );
    expect(migration).toContain(
      "grant select on table public.device_thresholds to authenticated;"
    );
    expect(migration).not.toMatch(/grant [^;]*(insert|update|delete|all)[^;]*device_thresholds/);
  });
});
