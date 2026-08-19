import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { permissionForPage, permissionsForApi } from "../../lib/access-control";
import {
  itemFitsPackage,
  parseDispatchWorkbook,
  planDispatchPackaging,
  resolveDispatchCatalogItem,
  type PackagingOption,
} from "../../lib/dispatch-planning";

const root = process.cwd();
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260819143000_add_daily_dispatch_planning.sql"
  ),
  "utf8"
).toLowerCase();
const page = readFileSync(
  join(root, "app/(app)/dispatch-planning/page.tsx"),
  "utf8"
);

function workbookWithRows(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Kinesis Vehicle Sheet"],
      ["Generated Date: 19/08/2026 09:15"],
      [],
      [],
      [
        "Vehicle Registration",
        "Hardware Type",
        "Device Type",
        "Order ID",
        "Order Line ID",
        "Destination Country",
        "Company Name",
      ],
      ...rows,
    ]),
    "Vehicles"
  );
  return workbook;
}

function packaging(
  overrides: Partial<PackagingOption> & Pick<PackagingOption, "id" | "name">
): PackagingOption {
  return {
    id: overrides.id,
    code: overrides.code || overrides.id,
    name: overrides.name,
    category: overrides.category || "BOX",
    lengthCm: overrides.lengthCm ?? 15,
    widthCm: overrides.widthCm ?? 11,
    heightCm: overrides.heightCm ?? 5,
    onHandStock: overrides.onHandStock ?? 100,
    reservedStock: overrides.reservedStock ?? 0,
    active: overrides.active ?? true,
  };
}

describe("daily dispatch planning", () => {
  it("maps Kinesis device rows through Device Type and accessories through Hardware Type", () => {
    expect(
      resolveDispatchCatalogItem(
        "ATOM",
        "Teltonika - Atom-E 4G - FMC880"
      )?.name
    ).toBe("FMC880");
    expect(
      resolveDispatchCatalogItem(
        "HARDWIRED",
        "Teltonika - Hard-Wired-4G / Atom - FMC130"
      )?.name
    ).toBe("FMC130");
    expect(
      resolveDispatchCatalogItem(
        "Neon",
        "Digital Matter - Barra-GPS Neon Battery replaceable - Barra-GPS"
      )?.name
    ).toBe("BarraGps");
    expect(resolveDispatchCatalogItem("AIO Camera", "")?.name).toBe(
      "CNHYCV200XEU"
    );
    expect(
      resolveDispatchCatalogItem("*DVR - 2 Channel -  (N+)", "")?.name
    ).toBe("DVR - 2 Channel -  (N+)");
    expect(
      resolveDispatchCatalogItem("HARDWIRED Cable for CV200", "")?.name
    ).toBe("HARDWIRED Cable for");
  });

  it("groups every physical row by Order ID and calculates trusted volume", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 1, "BE", "Customer A"],
        ["AA-02", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 2, "BE", "Customer A"],
        ["BB-01", "AIO Camera", "", 2177002, 3, "FR", "Customer B"],
        ["BB-01", "CV200 Bullet Camera", "", 2177002, 3, "FR", "Customer B"],
      ])
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.orders).toHaveLength(2);
    expect(parsed.orders[0]).toMatchObject({
      orderId: "2177001",
      lineCount: 2,
      totalVolumeCm3: 162,
    });
    expect(parsed.orders[0].items).toEqual([
      expect.objectContaining({ name: "FMC880", quantity: 2 }),
    ]);
    expect(parsed.orders[1].totalVolumeCm3).toBe(4320);
    expect(parsed.generatedAt).toBe("19/08/2026 09:15");
  });

  it("blocks every unknown item instead of guessing dimensions", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "NEW DEVICE", "Unknown model", 2177001, 1, "BE", "Customer"],
      ])
    );
    expect(parsed.orders).toEqual([]);
    expect(parsed.issues[0]).toMatchObject({
      row: 6,
      hardwareType: "NEW DEVICE",
    });
  });

  it("checks rotation, selects the smallest one-package fit and reports insufficient stock", () => {
    expect(
      itemFitsPackage(
        { lengthCm: 9, widthCm: 20, heightCm: 23.5 },
        { lengthCm: 31, widthCm: 22, heightCm: 15 }
      )
    ).toBe(true);

    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["BB-01", "AIO Camera", "", 2177002, 3, "FR", "Customer B"],
      ])
    );
    const plan = planDispatchPackaging(parsed.orders, [
      packaging({ id: "small", name: "Radius Small" }),
      packaging({
        id: "normal-b",
        name: "Normal Box B",
        lengthCm: 31,
        widthCm: 22,
        heightCm: 15,
        onHandStock: 0,
      }),
      packaging({
        id: "normal-c",
        name: "Normal Box C",
        lengthCm: 40,
        widthCm: 30,
        heightCm: 18,
      }),
    ]);

    expect(plan.orders[0].packages[0]).toMatchObject({
      packagingTypeId: "normal-b",
      quantity: 1,
    });
    expect(plan.blockers).toEqual([
      "Normal Box B: 1 required, but only 0 available.",
    ]);
  });

  it("keeps confirmation and undo transactional, idempotent and service-only", () => {
    expect(migration.trimStart()).toMatch(/^begin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain("alter table public.dispatch_batches enable row level security");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("function public.confirm_dispatch_batch(");
    expect(migration).toContain("function public.undo_dispatch_batch(");
    expect(migration).toContain("on conflict (operation_id) do nothing");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("dispatch_source_already_confirmed");
    expect(migration).toContain("dispatch_orders_already_confirmed");
    expect(migration).toContain("for update of packaging");
    expect(migration).toContain("'undo_consume'");
    expect(migration).toContain("to service_role;");
  });

  it("maps the page and every endpoint to Device Outbound authority", () => {
    expect(permissionForPage("/dispatch-planning")).toBe("can_outbound");
    expect(permissionsForApi("/api/dispatch-planning/preview", "POST")).toEqual([
      "can_outbound",
    ]);
    expect(permissionsForApi("/api/dispatch-planning/export", "GET")).toEqual([
      "can_outbound",
    ]);
    expect(page).toContain("Preview is read-only.");
    expect(page).toContain("Confirm &amp; Deduct Packaging");
    expect(page).toContain("Undo & Restore Stock");
  });
});
