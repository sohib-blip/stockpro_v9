import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { permissionsForApi } from "../../lib/access-control";
import {
  applyDispatchAutomaticAccessoryRules,
  BUILT_IN_DISPATCH_CATALOG,
  createDispatchCatalog,
  parseDispatchWorkbook,
  resolveDispatchCatalogItem,
  resolveDispatchLineDeviceModel,
} from "../../lib/dispatch-planning";
import {
  findDispatchCatalogConflict,
  isRequiredDispatchItem,
  parseDispatchCatalogItemInput,
  requiredItemChangeError,
} from "../../lib/dispatch-catalog-input";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261019120000_add_dispatch_catalog_items.sql"
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

describe("dispatch item catalog", () => {
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
    expect(resolveDispatchCatalogItem("*DVR - 2 Channel -  (N+)", "")?.name).toBe(
      "DVR - 2 Channel -  (N+)"
    );
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

  it("uses dimensions added in the app for unknown hardware and device models", () => {
    const catalog = createDispatchCatalog([
      ...BUILT_IN_DISPATCH_CATALOG,
      { name: "1TB SSD SATA", lengthCm: 10, widthCm: 7, heightCm: 0.7, aliases: [] },
      { name: "FMC150", lengthCm: 8, widthCm: 6, heightCm: 2, aliases: [] },
      {
        name: "DVR GPS Antenna",
        lengthCm: 6,
        widthCm: 5,
        heightCm: 2,
        aliases: ["DVR GPS Antenna - HW-GL-A5 - Replacement"],
      },
    ]);

    const parsed = parseDispatchWorkbook(
      kinesisWorkbook([
        row("1TB SSD SATA", "Teltonika - Atom-H 4G - FMC920", 1),
        row("ATOM", "Teltonika - Atom-X 4G - FMC150", 2),
        row("DVR GPS Antenna - HW-GL-A5 - Replacement", "", 3),
      ]),
      catalog
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.orders[0].deviceCounts).toEqual({ FMC150: 1 });
    expect(
      parsed.orders[0].items.map((item) => [item.name, item.totalVolumeCm3])
    ).toEqual([
      ["1TB SSD SATA", 49],
      ["FMC150", 96],
      ["DVR GPS Antenna", 60],
    ]);
  });

  it("checks automatic accessories against the same catalog", () => {
    const parsed = parseDispatchWorkbook(
      kinesisWorkbook([row("ATOM", "Teltonika - Atom-E 4G - FMC880", 1)])
    );
    const rule = {
      deviceModel: "FMC880",
      accessoryName: "Velcro Strip",
      quantity: 1,
      perDevices: 1,
    };

    expect(
      applyDispatchAutomaticAccessoryRules(parsed.orders, [rule]).issues[0]
        .suggestedName
    ).toBe("Velcro Strip");

    const catalog = createDispatchCatalog([
      ...BUILT_IN_DISPATCH_CATALOG,
      { name: "Velcro Strip", lengthCm: 5, widthCm: 2, heightCm: 0.5, aliases: [] },
    ]);
    expect(
      applyDispatchAutomaticAccessoryRules(parsed.orders, [rule], catalog).issues
    ).toEqual([]);
  });
});

describe("dispatch item input", () => {
  it("validates names, other names and dimensions", () => {
    expect(
      parseDispatchCatalogItemInput({
        name: "  1TB   SSD SATA ",
        aliases: ["SSD 1TB", "ssd-1tb", "", "1TB SSD SATA"],
        lengthCm: "10",
        widthCm: 7.004,
        heightCm: 0.7,
      })
    ).toEqual({
      ok: true,
      value: {
        name: "1TB SSD SATA",
        aliases: ["SSD 1TB"],
        lengthCm: 10,
        widthCm: 7,
        heightCm: 0.7,
      },
    });

    expect(parseDispatchCatalogItemInput({ name: "" })).toEqual({
      ok: false,
      error: "Item name is required",
    });
    expect(
      parseDispatchCatalogItemInput({ name: "Box", lengthCm: -1, widthCm: 1, heightCm: 1 })
    ).toEqual({
      ok: false,
      error: "Dimensions must be numbers between 0 and 1000 cm",
    });
    expect(
      parseDispatchCatalogItemInput({ name: "ATOM", lengthCm: 1, widthCm: 1, heightCm: 1 })
    ).toMatchObject({ ok: false });
    expect(
      parseDispatchCatalogItemInput({
        name: "Kit",
        aliases: ["Kinesis Insights"],
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
      })
    ).toMatchObject({ ok: false });
  });

  it("keeps every label pointing to a single item", () => {
    const existing = [
      { id: "a", name: "Howen4CH", aliases: ["DVR-4CH"], active: true },
      { id: "b", name: "FOB", aliases: [], active: false },
    ];

    expect(
      findDispatchCatalogConflict({ name: "New DVR", aliases: ["dvr 4ch"] }, existing)
    ).toBe('"dvr 4ch" is already used by Howen4CH');
    expect(findDispatchCatalogConflict({ name: "fob", aliases: [] }, existing)).toBe(
      'An item named "FOB" already exists'
    );
    expect(
      findDispatchCatalogConflict(
        { id: "a", name: "Howen4CH", aliases: ["DVR-4CH", "DVR4"] },
        existing
      )
    ).toBeNull();
  });

  it("protects the items the dispatch rules depend on", () => {
    const howen = { id: "a", name: "Howen4CH", aliases: [], active: true };
    expect(isRequiredDispatchItem("howen 4ch")).toBe(true);
    expect(requiredItemChangeError(howen, { name: "Howen 4CH" })).toBeNull();
    expect(requiredItemChangeError(howen, { name: "DVR 4" })).toBe(
      "Howen4CH is used by the dispatch rules and cannot be renamed"
    );
    expect(requiredItemChangeError(howen, { active: false })).toBe(
      "Howen4CH is used by the dispatch rules and cannot be deactivated"
    );
    expect(
      requiredItemChangeError({ id: "b", name: "WIPE", aliases: [], active: true }, { active: false })
    ).toBeNull();
  });
});

describe("dispatch item storage", () => {
  it("seeds the table with exactly the built-in dimensions", () => {
    const seeded = Array.from(
      migration.matchAll(
        /\('((?:[^']|'')+)', (?:'\{\}'::text\[\]|array\[(.*?)\]::text\[\]), ([\d.]+), ([\d.]+), ([\d.]+)\)/g
      ),
      (match) => ({
        name: match[1].replace(/''/g, "'"),
        aliases: match[2]
          ? Array.from(match[2].matchAll(/'((?:[^']|'')+)'/g), (alias) => alias[1])
          : [],
        lengthCm: Number(match[3]),
        widthCm: Number(match[4]),
        heightCm: Number(match[5]),
      })
    );

    expect(seeded).toEqual(BUILT_IN_DISPATCH_CATALOG);
  });

  it("keeps the table behind server-side routes", () => {
    const sql = migration.toLowerCase();
    expect(sql).toContain(
      "alter table public.dispatch_catalog_items enable row level security;"
    );
    expect(sql).toContain("from public, anon, authenticated;");
    expect(sql).not.toMatch(/grant[^;]+dispatch_catalog_items[^;]+to authenticated/);
    expect(sql).toContain("on conflict do nothing;");
  });

  it("lets Dispatch Planning and Inventory Setup users maintain the list", () => {
    expect(permissionsForApi("/api/dispatch-planning/catalog", "GET")).toEqual([
      "can_outbound",
      "can_bins",
    ]);
    expect(permissionsForApi("/api/dispatch-planning/catalog", "PATCH")).toEqual([
      "can_outbound",
      "can_bins",
    ]);
    expect(permissionsForApi("/api/dispatch-planning/confirm", "POST")).toEqual([
      "can_outbound",
    ]);
  });
});
