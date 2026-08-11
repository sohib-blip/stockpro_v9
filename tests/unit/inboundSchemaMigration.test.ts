import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260716_align_movements_with_bins.sql"
  ),
  "utf8"
);

describe("inbound movement schema migration", () => {
  it("aligns movements and box-derived ids with bins", () => {
    expect(migration).toContain("references public.bins(id)");
    expect(migration).toContain("select bin_id");
    expect(migration).toContain(
      "drop constraint if exists movements_device_id_fkey"
    );
    expect(migration).toContain(
      "drop trigger if exists trg_update_device_stock"
    );
    expect(migration).not.toContain("select device_id\n    into new.device_id");
  });
});
