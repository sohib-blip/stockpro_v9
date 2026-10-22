import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAccessoryExportSheets } from "../../lib/accessory-export";
import { permissionsForApi } from "../../lib/access-control";
import {
  dispatchPackagingRuleExtras,
  type DispatchPackagingRule,
} from "../../lib/dispatch-packaging-rules";
import {
  applyDispatchPackagingSelections,
  eligibleDispatchPackagingIds,
  planDispatchPackaging,
  type DispatchOrder,
  type PackagingOption,
} from "../../lib/dispatch-planning";
import { translateUiText } from "../../lib/i18n";
import { formatPackagingDimensions, packagingCategoryLabel } from "../../lib/packaging";
import { packagingCreateSchema } from "../../lib/packaging-validation";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261022100000_add_packaging_sleeves_and_rules.sql"),
  "utf8"
).toLowerCase();

function option(
  overrides: Partial<PackagingOption> & Pick<PackagingOption, "id" | "name">
): PackagingOption {
  return {
    code: overrides.id.toUpperCase(),
    category: "BOX",
    lengthCm: 15,
    widthCm: 11,
    heightCm: 5,
    onHandStock: 100,
    reservedStock: 0,
    active: true,
    ...overrides,
  };
}

const radiusSmall = option({ id: "radius-s", name: "Radius Box Small" });
const radiusXl = option({ id: "radius-xl", name: "Radius Box X-Large", lengthCm: 32, widthCm: 18, heightCm: 11 });
const smallSleeve = option({ id: "sleeve-s", name: "Small Sleeve", category: "SLEEVE", lengthCm: 0, widthCm: 0, heightCm: 0 });
const xlSleeve = option({ id: "sleeve-xl", name: "Extra Large Sleeve", category: "SLEEVE", lengthCm: 0, widthCm: 0, heightCm: 0 });
const cv200Sleeve = option({ id: "sleeve-cv200", name: "CV200 Sleeve", category: "SLEEVE", lengthCm: 0, widthCm: 0, heightCm: 0, onHandStock: 2 });
const smallPlastic = option({ id: "plastic-s", name: "Small Plastic Envelope", category: "PLASTIC_ENVELOPE", lengthCm: 24, widthCm: 35, heightCm: 0.1 });
const largePlastic = option({ id: "plastic-l", name: "Large Plastic Envelope", category: "PLASTIC_ENVELOPE", lengthCm: 50, widthCm: 38, heightCm: 0.1 });
const packages = [radiusSmall, radiusXl, smallSleeve, xlSleeve, cv200Sleeve, smallPlastic, largePlastic];

const rules: DispatchPackagingRule[] = [
  { triggerPackagingTypeId: "radius-s", triggerDeviceModel: null, packagingTypeId: "sleeve-s", quantity: 1 },
  { triggerPackagingTypeId: "radius-s", triggerDeviceModel: null, packagingTypeId: "plastic-s", quantity: 1 },
  { triggerPackagingTypeId: "radius-xl", triggerDeviceModel: null, packagingTypeId: "sleeve-xl", quantity: 1 },
  { triggerPackagingTypeId: "radius-xl", triggerDeviceModel: null, packagingTypeId: "plastic-l", quantity: 1 },
  { triggerPackagingTypeId: null, triggerDeviceModel: "CNHYCV200XEU", packagingTypeId: "sleeve-cv200", quantity: 1 },
];

function order(orderId: string, deviceCounts: Record<string, number> = {}, size = 4): DispatchOrder {
  return {
    orderId,
    destinationCountry: "BE",
    companyName: "Test",
    lineCount: 1,
    totalVolumeCm3: size * size * size,
    adjustedVolumeCm3: size * size * size,
    deviceCounts,
    items: [
      {
        name: "FMC880",
        lengthCm: size,
        widthCm: size,
        heightCm: 1,
        quantity: 1,
        unitVolumeCm3: size * size,
        totalVolumeCm3: size * size,
        sourceItem: "ATOM",
      } as DispatchOrder["items"][number],
    ],
  };
}

describe("automatic packaging rules", () => {
  it("adds sleeves and plastics per package and sleeves per device", () => {
    expect(
      dispatchPackagingRuleExtras(
        { packages: [{ packagingTypeId: "radius-s", quantity: 2 }] },
        rules
      )
    ).toEqual([
      { packagingTypeId: "sleeve-s", quantity: 2 },
      { packagingTypeId: "plastic-s", quantity: 2 },
    ]);
    expect(
      dispatchPackagingRuleExtras(
        { packages: [{ packagingTypeId: "radius-xl", quantity: 1 }], deviceCounts: { "CNHYCV200XEU": 3 } },
        rules
      )
    ).toEqual([
      { packagingTypeId: "sleeve-xl", quantity: 1 },
      { packagingTypeId: "plastic-l", quantity: 1 },
      { packagingTypeId: "sleeve-cv200", quantity: 3 },
    ]);
    expect(dispatchPackagingRuleExtras({ packages: [{ packagingTypeId: "plastic-s", quantity: 1 }] }, rules)).toEqual([]);
  });

  it("never chooses a sleeve as the packaging of an order", () => {
    const hugeSleeve = { ...smallSleeve, lengthCm: 999, widthCm: 999, heightCm: 999 };
    const plan = planDispatchPackaging([order("A")], [hugeSleeve, radiusSmall]);
    expect(plan.orders[0].packages[0].packagingTypeId).toBe("radius-s");
    expect(eligibleDispatchPackagingIds(order("A"), [hugeSleeve, radiusSmall])).toEqual(["radius-s"]);

    const manual = applyDispatchPackagingSelections(
      [order("A")],
      packages,
      [{ orderId: "A", packagingTypeId: "sleeve-s", quantity: 1, source: "manual" }]
    );
    expect(manual.blockers).toContain("Order A: Small Sleeve is a sleeve and cannot hold an order.");
  });

  it("deducts the extras together with the chosen boxes", () => {
    const plan = applyDispatchPackagingSelections(
      [order("A"), order("B", { CNHYCV200XEU: 2 })],
      packages,
      [
        { orderId: "A", packagingTypeId: "radius-s", quantity: 2, source: "manual" },
        { orderId: "B", packagingTypeId: "radius-xl", quantity: 1, source: "manual" },
      ],
      rules
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.orders[0].packages.map((p) => [p.name, p.quantity])).toEqual([["Radius Box Small", 2]]);
    expect(plan.orders[0].extras?.map((p) => [p.name, p.quantity, p.source])).toEqual([
      ["Small Plastic Envelope", 2, "rule"],
      ["Small Sleeve", 2, "rule"],
    ]);
    expect(plan.orders[1].extras?.map((p) => [p.name, p.quantity])).toEqual([
      ["CV200 Sleeve", 2],
      ["Extra Large Sleeve", 1],
      ["Large Plastic Envelope", 1],
    ]);
    expect(Object.fromEntries(plan.packageUsage.map((usage) => [usage.name, usage.quantity]))).toEqual({
      "CV200 Sleeve": 2,
      "Extra Large Sleeve": 1,
      "Large Plastic Envelope": 1,
      "Radius Box Small": 2,
      "Radius Box X-Large": 1,
      "Small Plastic Envelope": 2,
      "Small Sleeve": 2,
    });
    expect(plan.totalPackages).toBe(11);
  });

  it("blocks the dispatch when sleeves run out or a rule points to an inactive format", () => {
    const short = applyDispatchPackagingSelections(
      [order("B", { CNHYCV200XEU: 3 })],
      packages,
      [{ orderId: "B", packagingTypeId: "radius-xl", quantity: 1, source: "manual" }],
      rules
    );
    expect(short.blockers).toContain("CV200 Sleeve: 3 required, but only 2 available.");

    const inactive = applyDispatchPackagingSelections(
      [order("A")],
      packages.map((p) => (p.id === "sleeve-s" ? { ...p, active: false } : p)),
      [{ orderId: "A", packagingTypeId: "radius-s", quantity: 1, source: "manual" }],
      rules
    );
    expect(inactive.blockers).toContain(
      "An automatic packaging rule uses Small Sleeve that is inactive or missing."
    );
  });

  it("lets sleeves be saved without dimensions only", () => {
    const base = { code: "SLEEVE-S", name: "Small Sleeve", on_hand_stock: 10, minimum_stock: 2 };
    expect(packagingCreateSchema.safeParse({ ...base, category: "SLEEVE" }).success).toBe(true);
    expect(
      packagingCreateSchema.safeParse({ ...base, category: "SLEEVE", length_cm: 10, width_cm: 5, height_cm: 1 }).success
    ).toBe(false);
    expect(packagingCreateSchema.safeParse({ ...base, category: "BOX" }).success).toBe(false);
    expect(
      packagingCreateSchema.safeParse({ ...base, category: "BOX", length_cm: 15, width_cm: 11, height_cm: 5 }).success
    ).toBe(true);
    expect(packagingCategoryLabel("SLEEVE")).toBe("Sleeve");
    expect(formatPackagingDimensions({ length_cm: null, width_cm: null, height_cm: null })).toBe("—");
  });

  it("lists sleeves in the accessory export packaging sheet", () => {
    const sheet = buildAccessoryExportSheets([], [
      {
        code: "SLEEVE-S",
        name: "Small Sleeve",
        category: "SLEEVE",
        length_cm: null,
        width_cm: null,
        height_cm: null,
        on_hand_stock: 40,
        reserved_stock: 0,
        minimum_stock: 10,
        active: true,
      },
    ]).find((entry) => entry.name === "Packaging")!;
    expect(sheet.rows[1]).toEqual(["Small Sleeve", "SLEEVE-S", "Sleeve", "—", 40, 0, 40, 10, "OK"]);
  });

  it("stores rules and sleeves behind the service boundary", () => {
    expect(migration.trimStart()).toMatch(/^begin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain("'plastic_envelope', 'sleeve'");
    expect(migration).toContain("create table if not exists public.packaging_rules");
    expect(migration).toContain("alter table public.packaging_rules enable row level security");
    expect(migration).toContain("revoke all on table public.packaging_rules from public, anon, authenticated");
    expect(migration).toContain("num_nonnulls(trigger_packaging_type_id, trigger_device_id) = 1");
    expect(permissionsForApi("/api/packaging/rules", "POST")).toEqual(["can_bins"]);
  });

  it("translates the rules screen", () => {
    expect(translateUiText("fr", "Automatic Packaging Rules")).toBe("Règles automatiques d’emballage");
    expect(translateUiText("fr", "2 per package")).toBe("2 par carton");
    expect(translateUiText("nl", "1 per device")).toBe("1 per toestel");
  });
});
