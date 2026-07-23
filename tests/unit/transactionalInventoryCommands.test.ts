import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = join(
  root,
  "supabase/migrations/20260723140000_transactional_returns_and_inbound.sql"
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const returnsRoute = readFileSync(
  join(root, "app/api/returns/confirm/route.ts"),
  "utf8"
);
const inboundRoute = readFileSync(
  join(root, "app/api/inbound/confirm/route.ts"),
  "utf8"
);
const manualInboundRoute = readFileSync(
  join(root, "app/api/inbound/manual-confirm/route.ts"),
  "utf8"
);
const returnsPage = readFileSync(
  join(root, "app/(app)/returns/page.tsx"),
  "utf8"
);
const inboundPage = readFileSync(
  join(root, "app/(app)/inbound/page.tsx"),
  "utf8"
);
const stagingRun = readFileSync(
  join(root, "tests/e2e/support/staging-run.ts"),
  "utf8"
);

describe("transactional returns and inbound commands", () => {
  it("moves both command families behind service-only database transactions", () => {
    expect(migration).toContain(
      "function public.confirm_return_batch("
    );
    expect(migration).toContain(
      "function public.confirm_inbound_batch("
    );
    expect(migration.match(/security definer/g)?.length).toBe(2);
    expect(migration).toContain(
      "revoke all on function public.confirm_return_batch("
    );
    expect(migration).toContain(
      "revoke all on function public.confirm_inbound_batch("
    );
    expect(migration).toContain("to service_role;");
  });

  it("derives return device and IMEI values from the locked canonical item row", () => {
    expect(migration).toContain("from public.items i");
    expect(migration).toContain("for update of i");
    expect(migration).toContain("v_item.device_id");
    expect(migration).toContain("v_item.imei");
    expect(returnsRoute).toMatch(/\.rpc\(\s*"confirm_return_batch"/);
    expect(returnsRoute).toContain("item_ids:");
    expect(returnsRoute).not.toContain(".from(\"items\")");
    expect(returnsRoute).not.toContain("item.device_id");
    expect(returnsRoute).not.toContain("item.imei");
  });

  it("commits inbound batch, boxes, items and movements inside one RPC", () => {
    expect(migration).toContain("insert into public.inbound_batches");
    expect(migration).toContain("insert into public.boxes");
    expect(migration).toContain("insert into public.items");
    expect(migration).toContain("insert into public.movements");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(inboundRoute).toMatch(/\.rpc\(\s*"confirm_inbound_batch"/);
    expect(manualInboundRoute).toMatch(/\.rpc\(\s*"confirm_inbound_batch"/);
    expect(inboundRoute).not.toContain('.from("inbound_batches")');
    expect(inboundRoute).not.toContain('.from("items")');
    expect(inboundRoute).not.toContain('.from("movements")');
    expect(manualInboundRoute).not.toContain('.from("items")');
    expect(manualInboundRoute).not.toContain('.from("movements")');
  });

  it("makes client retries reuse a command receipt instead of replaying writes", () => {
    expect(migration).toContain(
      "create table if not exists public.inventory_command_receipts"
    );
    expect(migration).toContain(
      "on conflict (operation_id) do nothing"
    );
    expect(migration).toContain("update public.inventory_command_receipts");
    expect(migration).toContain("on delete set null");
    expect(stagingRun).toContain('.from("inventory_command_receipts")');
    expect(returnsPage).toContain("operation_id:");
    expect(inboundPage).toContain("operation_id:");
  });

  it("binds manual confirmation to the reviewed inbound snapshot", () => {
    expect(inboundPage).toContain(
      "setManualDevice((current) => current || mapped[0].device_id)"
    );
    expect(inboundPage).toContain("manualDeviceInputRef.current?.value");
    expect(inboundPage).toContain(
      "const previewDevice = String(manualPreview.bin_id || \"\")"
    );
    expect(inboundPage).toContain("device: previewDevice");
    expect(inboundPage).toContain("box_no: previewBox");
    expect(inboundPage).toContain("floor: previewFloor");
    expect(inboundPage).toContain(
      "Inbound details changed. Preview the inbound again before confirming."
    );
  });
});
