import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { permissionsForApi } from "../../lib/access-control";
import {
  applyDispatchAutomaticAccessoryRules,
  BUILT_IN_DISPATCH_CATALOG,
  buildDispatchPickingSummary,
  createInventoryDispatchCatalog,
  dispatchItemKey,
  inventoryBaseName,
  parseDispatchWorkbook,
  resolveDispatchCatalogItem,
  resolveDispatchLineDeviceModel,
  type DispatchInventoryRecord,
} from "../../lib/dispatch-planning";
import {
  findKinesisNameConflict,
  parseDispatchDimensions,
  parseKinesisNames,
  recordAnswersToLabel,
} from "../../lib/dispatch-dimensions-input";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261019150000_add_dispatch_dimensions_to_inventory.sql"
  ),
  "utf8"
);

const HEADER = [
  "Vehicle Registration",
  "Hardware Type",
  "Device Type",
  "Order ID",
  "Order Line ID",
  "Destination Country",
  "Company Name",
];

// Same layout as the Kinesis export: the report date sits in its own cell.
function kinesisWorkbook(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Kinesis Dispatch Details"],
      ["Report Generated:", "Wed Aug 19 09:59:31 BST 2026"],
      ["Number of Orders:", String(rows.length)],
      [],
      HEADER,
      ...rows,
    ]),
    "Vehicles"
  );
  return workbook;
}

const row = (hardware: string, device: string, line: number) => [
  `TST${line}`,
  hardware,
  device,
  "ORDER-1",
  `LINE-${line}`,
  "GB",
  "Test Company",
];

const record = (
  name: string,
  dimensions: [number, number, number] | null,
  kinesisNames: string[] = []
): DispatchInventoryRecord => ({
  name,
  lengthCm: dimensions?.[0] ?? null,
  widthCm: dimensions?.[1] ?? null,
  heightCm: dimensions?.[2] ?? null,
  kinesisNames,
});

describe("dispatch dimensions", () => {
  it("recognises short DVR labels as Howen recorders", () => {
    for (const [label, model] of [
      ["DVR-4CH", "Howen4CH"],
      ["DVR 4CH", "Howen4CH"],
      ["DVR-2CH", "Howen2CH"],
      ["DVR - 8 Channel", "Howen8CH"],
    ]) {
      expect(resolveDispatchCatalogItem(label, "")?.name, label).toBe(model);
      expect(resolveDispatchLineDeviceModel(label, ""), label).toBe(model);
    }
  });

  it("reads the Kinesis report date and suggests the missing item name", () => {
    const parsed = parseDispatchWorkbook(
      kinesisWorkbook([
        row("DVR-4CH", "Teltonika - Atom-H 4G - FMC920", 1),
        row("DVR GPS Antenna - HW-GL-A5 - Replacement", "Teltonika - Atom-H 4G - FMC920", 2),
        row("ATOM", "Teltonika - Atom-X 4G - FMC150", 3),
        row("Teltonika Contactless CAN - ECAN02", "Teltonika - FMC130", 4),
      ])
    );

    expect(parsed.generatedAt).toBe("Wed Aug 19 09:59:31 BST 2026");
    expect(parsed.lines.map((line) => [line.mappedItem, line.deviceModel])).toEqual([
      ["Howen4CH", "Howen4CH"],
    ]);
    expect(parsed.issues.map((issue) => issue.suggestedName)).toEqual([
      "DVR GPS Antenna - HW-GL-A5 - Replacement",
      "FMC150",
      null,
    ]);
  });

  it("strips the product code from accessory record names", () => {
    expect(inventoryBaseName("BUZZER\t4")).toBe("BUZZER");
    expect(inventoryBaseName("*Camera - Front Facing PRO895")).toBe("Camera - Front Facing");
    expect(inventoryBaseName("WIPE TBD011")).toBe("WIPE");
    expect(inventoryBaseName("OBD Cable FMC003")).toBe("OBD Cable FMC003");
  });

  it("uses dimensions stored on device and accessory records", () => {
    const catalog = createInventoryDispatchCatalog(
      [record("FMC150", [6.4, 5.5, 2])],
      [
        record("1TB SSD SATA\tPRO1118", [10, 7, 0.7]),
        record("DVR GPS Antenna - HW-GL-A5 - Replacement\tPRO1147", [6, 5, 2]),
        // No dimensions yet: the built-in list still answers.
        record("BUZZER\t4", null),
      ]
    );

    const parsed = parseDispatchWorkbook(
      kinesisWorkbook([
        row("1TB SSD SATA", "Teltonika - Atom-H 4G - FMC920", 1),
        row("ATOM", "Teltonika - Atom-X 4G - FMC150", 2),
        row("DVR GPS Antenna - HW-GL-A5 - Replacement", "", 3),
        row("BUZZER", "", 4),
      ]),
      catalog
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.orders[0].deviceCounts).toEqual({ FMC150: 1 });
    expect(
      parsed.orders[0].items.map((item) => [item.name, item.totalVolumeCm3])
    ).toEqual([
      ["1TB SSD SATA", 49],
      ["FMC150", 70.4],
      ["DVR GPS Antenna - HW-GL-A5 - Replacement", 60],
      ["BUZZER", 32],
    ]);
  });

  it("keeps Kinesis names ahead of record names and the built-in list", () => {
    const catalog = createInventoryDispatchCatalog(
      [record("Howen2CH", [21, 19, 8], ["DVR - 2 Channel -  (N+)"])],
      [
        record("*Camera - Front Facing PRO895", [9, 9, 11], ["Camera - Front Facing"]),
        record("*Camera - Front Facing (Dash Mounted)\tPRO966", [1, 1, 1]),
      ]
    );

    expect(resolveDispatchCatalogItem("Camera - Front Facing", "", catalog)).toEqual({
      name: "Camera - Front Facing",
      lengthCm: 9,
      widthCm: 9,
      heightCm: 11,
    });
    expect(resolveDispatchCatalogItem("*DVR - 2 Channel -  (N+)", "", catalog)?.name).toBe(
      "Howen2CH"
    );
    expect(resolveDispatchLineDeviceModel("DVR - 2 Channel - (N+)", "", "Howen2CH", catalog)).toBe(
      "Howen2CH"
    );
  });

  it("matches automatic accessories and picking stock to the same record", () => {
    const catalog = createInventoryDispatchCatalog(
      [],
      [record("BUZZER\t4", [2, 4, 4], ["BUZZER"]), record("Velcro Strip\tPRO2000", [5, 2, 0.5])]
    );
    const parsed = parseDispatchWorkbook(
      kinesisWorkbook([row("ATOM", "Teltonika - Atom-E 4G - FMC880", 1), row("BUZZER", "", 2)]),
      catalog
    );
    const enriched = applyDispatchAutomaticAccessoryRules(
      parsed.orders,
      [
        { deviceModel: "FMC880", accessoryName: "BUZZER\t4", quantity: 2, perDevices: 1 },
        { deviceModel: "FMC880", accessoryName: "Velcro Strip\tPRO2000", quantity: 1, perDevices: 1 },
      ],
      catalog
    );

    expect(enriched.issues).toEqual([]);
    expect(
      enriched.orders[0].items.map((item) => [item.name, item.quantity, item.automaticQuantity])
    ).toEqual([
      ["BUZZER", 2, 1],
      ["FMC880", 1, 0],
      ["Velcro Strip", 1, 1],
    ]);

    const summary = buildDispatchPickingSummary(
      enriched.orders.map((order) => ({ ...order, packages: [] })),
      [],
      [],
      [{ name: "BUZZER\t4", availableStock: 10 }],
      catalog
    );
    expect(summary.find((line) => line.name === "BUZZER")?.availableStock).toBe(10);
  });
});

describe("dispatch dimension input", () => {
  it("accepts three dimensions, none, or nothing sent", () => {
    expect(parseDispatchDimensions({ lengthCm: "10", widthCm: 7.004, heightCm: "0.7" })).toEqual({
      ok: true,
      dimensions: { lengthCm: 10, widthCm: 7, heightCm: 0.7 },
    });
    expect(parseDispatchDimensions({ lengthCm: "", widthCm: "", heightCm: "" })).toEqual({
      ok: true,
      dimensions: null,
    });
    expect(parseDispatchDimensions({})).toEqual({ ok: true, dimensions: undefined });
    expect(parseDispatchDimensions({ lengthCm: "5", widthCm: "", heightCm: "1" })).toMatchObject({
      ok: false,
    });
    expect(parseDispatchDimensions({ lengthCm: -1, widthCm: 1, heightCm: 1 })).toMatchObject({
      ok: false,
    });
  });

  it("cleans Kinesis names and refuses Device Type labels", () => {
    expect(parseKinesisNames([" DVR-4CH ", "dvr 4ch", "", "DVR - 4 Channel"])).toEqual({
      ok: true,
      names: ["DVR-4CH", "DVR - 4 Channel"],
    });
    expect(parseKinesisNames(undefined)).toEqual({ ok: true, names: undefined });
    expect(parseKinesisNames(["ATOM"])).toMatchObject({ ok: false });
    expect(parseKinesisNames(["Kinesis Insights"])).toMatchObject({ ok: false });
  });

  it("keeps every Kinesis name on a single record", () => {
    const records = [
      { kind: "device" as const, id: "d1", name: "Howen4CH", kinesisNames: ["DVR-4CH"] },
      { kind: "accessory" as const, id: "a1", name: "BUZZER\t4", kinesisNames: ["BUZZER"] },
    ];

    expect(
      findKinesisNameConflict({ kind: "accessory", id: "a2", kinesisNames: ["dvr 4ch"] }, records)
    ).toBe('"dvr 4ch" is already used by Howen4CH');
    expect(
      findKinesisNameConflict({ kind: "accessory", id: "a2", kinesisNames: ["Howen 4CH"] }, records)
    ).toBe('"Howen 4CH" is already used by Howen4CH');
    expect(
      findKinesisNameConflict({ kind: "accessory", id: "a1", kinesisNames: ["BUZZER"] }, records)
    ).toBeNull();
    expect(recordAnswersToLabel(records[1], "Buzzer")).toBe(true);
    expect(recordAnswersToLabel(records[1], "Buzzer 4")).toBe(true);
    expect(recordAnswersToLabel(records[1], "Beeper")).toBe(false);
  });
});

describe("dispatch dimension storage", () => {
  type MigrationRow = { key: string; dimensions: [number, number, number]; kinesisNames: string[] };

  function migrationRows(table: "bins" | "accessory_bins"): MigrationRow[] {
    const start = migration.indexOf(`update public.${table} as`);
    const block = migration.slice(start, migration.indexOf("as item(", start));
    return Array.from(
      block.matchAll(
        /\('([a-z0-9]+)', ([\d.]+), ([\d.]+), ([\d.]+), (?:'\{\}'::text\[\]|array\[(.*?)\]::text\[\])\)/g
      ),
      (match) => ({
        key: match[1],
        dimensions: [Number(match[2]), Number(match[3]), Number(match[4])],
        kinesisNames: match[5]
          ? Array.from(match[5].matchAll(/'((?:[^']|'')+)'/g), (name) => name[1].replace(/''/g, "'"))
          : [],
      })
    );
  }

  it("fills every built-in item with the same name and dimensions", () => {
    const devices = migrationRows("bins");
    const accessories = migrationRows("accessory_bins");
    expect(devices).toHaveLength(15);
    expect(accessories).toHaveLength(25);

    // Records named as in production; device bins carry the model name.
    const deviceName = (key: string) =>
      BUILT_IN_DISPATCH_CATALOG.find((item) => dispatchItemKey(item.name) === key)?.name ??
      key.toUpperCase();
    const catalog = createInventoryDispatchCatalog(
      devices.map((item) => record(deviceName(item.key), item.dimensions, item.kinesisNames)),
      accessories.map((item) => record(item.key, item.dimensions, item.kinesisNames))
    );
    const inventoryOnly = createInventoryDispatchCatalog(
      devices.map((item) => record(deviceName(item.key), item.dimensions, item.kinesisNames)),
      accessories.map((item) => record(item.key, item.dimensions, item.kinesisNames))
    ).entries.filter((entry) => !BUILT_IN_DISPATCH_CATALOG.includes(entry));

    for (const builtIn of BUILT_IN_DISPATCH_CATALOG) {
      const resolved = catalog.byKey.get(dispatchItemKey(builtIn.name));
      const expectedName = builtIn.name === "DVR - 2 Channel -  (N+)" ? "Howen2CH" : builtIn.name;
      expect(resolved, builtIn.name).toEqual({
        name: expectedName,
        lengthCm: builtIn.lengthCm,
        widthCm: builtIn.widthCm,
        heightCm: builtIn.heightCm,
      });
      // Answered by an inventory record, not by the safety net.
      expect(
        inventoryOnly.some((entry) => entry.name === expectedName),
        builtIn.name
      ).toBe(true);
    }
    expect(resolveDispatchCatalogItem("ATOM", "Teltonika - Atom-X 4G - FMC150", catalog)).toEqual({
      name: "FMC150",
      lengthCm: 6.4,
      widthCm: 5.5,
      heightCm: 2,
    });
  });

  it("adds optional columns without touching existing values", () => {
    const sql = migration.toLowerCase();
    expect(sql).toContain("drop table if exists public.dispatch_catalog_items;");
    expect(sql).toContain("add column if not exists kinesis_names text[] not null default '{}'::text[]");
    expect(sql.match(/and (bin|accessory)\.length_cm is null/g)).toHaveLength(2);
    expect(sql).toContain("coalesce(accessory.category, '') <> 'packages'");
    expect(sql).not.toMatch(/grant[^;]+to authenticated/);
  });

  it("lets Dispatch Planning and Inventory Setup users add dimensions", () => {
    expect(permissionsForApi("/api/dispatch-planning/items", "GET")).toEqual([
      "can_outbound",
      "can_bins",
    ]);
    expect(permissionsForApi("/api/dispatch-planning/items", "POST")).toEqual([
      "can_outbound",
      "can_bins",
    ]);
    expect(permissionsForApi("/api/bins/dispatch-details", "POST")).toEqual(["can_bins"]);
    expect(permissionsForApi("/api/dispatch-planning/confirm", "POST")).toEqual(["can_outbound"]);
  });
});
