import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { permissionForPage, permissionsForApi } from "../../lib/access-control";
import {
  applyDispatchAutomaticAccessoryRules,
  applyDispatchPackagingSelections,
  isDispatchVolumeAccessoryCategory,
  itemFitsPackage,
  parseDispatchWorkbook,
  planDispatchPackaging,
  resolveDispatchCatalogItem,
  type PackagingOption,
} from "../../lib/dispatch-planning";
import {
  dispatchComposition,
  dispatchCompositionKey,
} from "../../lib/dispatch-learning";

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
const learningMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260819193000_add_dispatch_packaging_learning.sql"
  ),
  "utf8"
).toLowerCase();

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
    expect(
      resolveDispatchCatalogItem(
        "Teltonika Contactless CAN - ECAN02",
        "Teltonika - Hard-Wired+CAN - FMB140"
      )?.name
    ).toBe("FMB140");
    expect(resolveDispatchCatalogItem("ECAN02", "")?.name).toBe(
      "Teltonika Contactless CAN - ECAN02"
    );
    expect(resolveDispatchCatalogItem("AIO Camera", "")?.name).toBe(
      "CNHYCV200XEU"
    );
    expect(
      resolveDispatchCatalogItem("*DVR - 2 Channel -  (N+)", "")?.name
    ).toBe("DVR - 2 Channel -  (N+)");
    expect(
      resolveDispatchCatalogItem("HARDWIRED Cable for CV200", "")?.name
    ).toBe("HARDWIRED Cable for");
    expect(
      resolveDispatchCatalogItem(
        "OBD",
        "Teltonika OBD tracker - FMC003"
      )?.name
    ).toBe("FMC003");
    expect(
      resolveDispatchCatalogItem(
        "TRAILER",
        "Teltonika trailer tracker - FMC234"
      )?.name
    ).toBe("FMC234");
  });

  it("counts an ECAN02 FMB140 row as one device plus one CAN accessory", () => {
    const workbook = workbookWithRows([
      [
        "AA-ECAN-01",
        "Teltonika Contactless CAN - ECAN02",
        "Teltonika - Hard-Wired+CAN - FMB140",
        "ECAN-ORDER",
        "ECAN-LINE",
        "BE",
        "ECAN Customer",
      ],
    ]);

    const parsed = parseDispatchWorkbook(workbook);

    expect(parsed.issues).toEqual([]);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toMatchObject({
      deviceModel: "FMB140",
      isDevice: true,
      mappedItem: "FMB140",
      additionalMappedItems: ["Teltonika Contactless CAN - ECAN02"],
    });
    expect(parsed.orders[0].deviceCounts).toEqual({ FMB140: 1 });
    expect(parsed.orders[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "FMB140", quantity: 1 }),
        expect.objectContaining({
          name: "Teltonika Contactless CAN - ECAN02",
          quantity: 1,
          unitVolumeCm3: 36,
        }),
      ])
    );
    expect(parsed.orders[0].totalVolumeCm3).toBeCloseTo(106.4);
  });

  it("keeps blocking ECAN02 when its FMB140 Device Type is missing", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        [
          "AA-ECAN-02",
          "Teltonika Contactless CAN - ECAN02",
          "",
          "ECAN-BLOCKED",
          "ECAN-LINE-2",
          "BE",
          "ECAN Customer",
        ],
      ])
    );

    expect(parsed.orders).toEqual([]);
    expect(parsed.issues).toEqual([
      expect.objectContaining({
        hardwareType: "Teltonika Contactless CAN - ECAN02",
        message: "No trusted dimensions match this hardware/device combination.",
      }),
    ]);
  });

  it("treats the agreed hardware names as devices and every other row as packing content", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "HARDWIRED", "Teltonika - Hard-Wired-4G / Atom - FMC920", 2177001, 1, "BE", "Customer A"],
        ["AA-01", "*DVR - 2 Channel -  (N+)", "Teltonika - Hard-Wired-4G / Atom - FMC920", 2177001, 2, "BE", "Customer A"],
        ["AA-01", "BUZZER", "Teltonika - Hard-Wired-4G / Atom - FMC920", 2177001, 3, "BE", "Customer A"],
        ["BB-01", "OBD", "Teltonika OBD tracker - FMC003", 2177002, 4, "BE", "Customer B"],
        ["CC-01", "TRAILER", "Teltonika trailer tracker - FMC234", 2177003, 5, "BE", "Customer C"],
      ])
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.orders[0].deviceCounts).toEqual({
      FMC920: 1,
      Howen2CH: 1,
    });
    expect(parsed.lines[0].vehicleRegistration).toBe("AA-01");
    expect(parsed.orders[1].deviceCounts).toEqual({ FMC003: 1 });
    expect(parsed.orders[2].deviceCounts).toEqual({ FMC234: 1 });
    expect(parsed.lines.find((line) => line.hardwareType === "BUZZER")).toMatchObject({
      isDevice: false,
      deviceModel: null,
    });
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

  it("uses Device Type to add only missing automatic accessories to volume", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "HARDWIRED", "Teltonika - Hard-Wired-4G / Atom - FMC130", 2177001, 1, "BE", "Customer A"],
        ["AA-02", "HARDWIRED", "Teltonika - Hard-Wired-4G / Atom - FMC130", 2177001, 2, "BE", "Customer A"],
        ["AA-01", "FOB", "Teltonika - Hard-Wired-4G / Atom - FMC130", 2177001, 3, "BE", "Customer A"],
      ])
    );
    const enriched = applyDispatchAutomaticAccessoryRules(parsed.orders, [
      {
        deviceModel: "FMC130",
        accessoryName: "FOB",
        quantity: 1,
        perDevices: 1,
      },
      {
        deviceModel: "FMC130",
        accessoryName: "BUZZER",
        quantity: 1,
        perDevices: 2,
      },
    ]);

    expect(parsed.orders[0].deviceCounts).toEqual({ FMC130: 2 });
    expect(enriched.issues).toEqual([]);
    expect(enriched.orders[0].lineCount).toBe(3);
    expect(enriched.orders[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "FOB",
          quantity: 2,
          workbookQuantity: 1,
          automaticQuantity: 1,
        }),
        expect.objectContaining({
          name: "BUZZER",
          quantity: 1,
          workbookQuantity: 0,
          automaticQuantity: 1,
        }),
      ])
    );
    expect(enriched.orders[0].totalVolumeCm3).toBeCloseTo(212.8);
  });

  it("recognizes every current non-package automatic accessory rule", () => {
    const currentRuleNames = [
      "Barra Adhesive Pad\tBAP01",
      "WIPE TBD011",
      "CV200 Adhesive Pad CVAP01",
      "FMB140 connectorized harness\t23",
      "Large Cable Ties\t25",
      "FMB130 connectorized harness\t22",
      "NEON-T Adhesive Pads\t24",
      "Tachograph T-Harness\tTacho-T-harness",
      "Atom Install Guide\tTBD001",
      "T7 Adhesive pad\tT7Pad",
    ];

    for (const name of currentRuleNames) {
      expect(resolveDispatchCatalogItem(name, ""), name).not.toBeNull();
    }
    expect(isDispatchVolumeAccessoryCategory("Consumables")).toBe(true);
    expect(isDispatchVolumeAccessoryCategory("Packages")).toBe(false);
  });

  it("enriches an FMC880 order with the current production rules", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 1, "BE", "Customer A"],
      ])
    );
    const enriched = applyDispatchAutomaticAccessoryRules(parsed.orders, [
      {
        deviceModel: "FMC880",
        accessoryName: "Atom Install Guide\tTBD001",
        quantity: 1,
        perDevices: 5,
      },
      {
        deviceModel: "FMC880",
        accessoryName: "Large Cable Ties\t25",
        quantity: 1,
        perDevices: 1,
      },
      {
        deviceModel: "FMC880",
        accessoryName: "WIPE TBD011",
        quantity: 1,
        perDevices: 1,
      },
    ]);

    expect(enriched.issues).toEqual([]);
    expect(enriched.orders[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Atom Install Guide", automaticQuantity: 1 }),
        expect.objectContaining({ name: "Large Cable Ties", automaticQuantity: 1 }),
        expect.objectContaining({ name: "WIPE", automaticQuantity: 1 }),
      ])
    );
    expect(enriched.orders[0].totalVolumeCm3).toBeCloseTo(100.19);
  });

  it("does not duplicate automatic accessories already present in the workbook", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 1, "BE", "Customer A"],
        ["AA-01", "FOB", "Teltonika - Atom-E 4G - FMC880", 2177001, 2, "BE", "Customer A"],
      ])
    );
    const enriched = applyDispatchAutomaticAccessoryRules(parsed.orders, [
      {
        deviceModel: "FMC880",
        accessoryName: "FOB",
        quantity: 1,
        perDevices: 1,
      },
    ]);

    expect(enriched.issues).toEqual([]);
    expect(enriched.orders[0].items.find((item) => item.name === "FOB")).toMatchObject({
      quantity: 1,
      workbookQuantity: 1,
      automaticQuantity: 0,
    });
  });

  it("blocks an applicable automatic rule without trusted dimensions", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 1, "BE", "Customer A"],
      ])
    );
    const enriched = applyDispatchAutomaticAccessoryRules(parsed.orders, [
      {
        deviceModel: "FMC880",
        accessoryName: "Unknown custom cable",
        quantity: 1,
        perDevices: 1,
      },
    ]);

    expect(enriched.issues[0]?.message).toContain("has no trusted dimensions");
    expect(enriched.orders[0].items).toHaveLength(1);
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

  it("accepts a confirmed package override and recomputes the exact deduction", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 1, "BE", "Customer A"],
        ["AA-02", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 2, "BE", "Customer A"],
      ])
    );
    const packages = [
      packaging({ id: "small", name: "Radius Small" }),
      packaging({
        id: "medium",
        name: "Radius Medium",
        lengthCm: 20,
        widthCm: 13,
        heightCm: 5,
      }),
    ];
    const plan = applyDispatchPackagingSelections(parsed.orders, packages, [
      {
        orderId: "2177001",
        packagingTypeId: "medium",
        quantity: 1,
        source: "manual",
      },
    ]);

    expect(plan.blockers).toEqual([]);
    expect(plan.totalPackages).toBe(1);
    expect(plan.orders[0].packages[0]).toMatchObject({
      packagingTypeId: "medium",
      name: "Radius Medium",
      quantity: 1,
      source: "manual",
    });
    expect(plan.packageUsage).toEqual([
      expect.objectContaining({ packagingTypeId: "medium", quantity: 1 }),
    ]);
  });

  it("rejects package overrides that cannot fit an individual item", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "AIO Camera", "", 2177001, 1, "BE", "Customer A"],
      ])
    );
    const plan = applyDispatchPackagingSelections(
      parsed.orders,
      [packaging({ id: "small", name: "Radius Small" })],
      [
        {
          orderId: "2177001",
          packagingTypeId: "small",
          quantity: 1,
          source: "manual",
        },
      ]
    );

    expect(plan.totalPackages).toBe(0);
    expect(plan.blockers[0]).toContain(
      "Radius Small cannot fit at least one item dimension"
    );
  });

  it("builds a stable learning key from normalized order composition", () => {
    const parsed = parseDispatchWorkbook(
      workbookWithRows([
        ["AA-01", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 1, "BE", "Customer A"],
        ["AA-02", "ATOM", "Teltonika - Atom-E 4G - FMC880", 2177001, 2, "BE", "Customer A"],
      ])
    );
    expect(dispatchComposition(parsed.orders[0])).toEqual([
      { item: "FMC880", quantity: 2 },
    ]);
    expect(dispatchCompositionKey(parsed.orders[0])).toMatch(/^[a-f0-9]{64}$/);
    expect(dispatchCompositionKey(parsed.orders[0])).toBe(
      dispatchCompositionKey({
        ...parsed.orders[0],
        orderId: "another-order",
        destinationCountry: "FR",
      })
    );
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
    expect(learningMigration.trimStart()).toMatch(/^begin;/);
    expect(learningMigration.trimEnd()).toMatch(/commit;$/);
    expect(learningMigration).toContain(
      "alter table public.dispatch_packaging_preferences enable row level security"
    );
    expect(learningMigration).toContain(
      "from public, anon, authenticated"
    );
    expect(learningMigration).toContain(
      "after insert or update of status on public.dispatch_batches"
    );
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
    expect(page).toContain("formatPackageDimensions");
    expect(page).toContain("dispatch-package-dimensions");
    expect(page).toContain("availableStock} available");
  });
});
