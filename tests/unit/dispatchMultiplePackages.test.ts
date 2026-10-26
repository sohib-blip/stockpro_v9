import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DispatchPackagingRule } from "../../lib/dispatch-packaging-rules";
import {
  applyDispatchPackagingSelections,
  type DispatchOrder,
  type PackagingOption,
} from "../../lib/dispatch-planning";
import { translateUiText } from "../../lib/i18n";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261026100000_learn_multiple_dispatch_packages.sql"),
  "utf8"
).toLowerCase();
const previewRoute = readFileSync(
  join(process.cwd(), "app/api/dispatch-planning/preview/route.ts"),
  "utf8"
);

function option(
  overrides: Partial<PackagingOption> & Pick<PackagingOption, "id" | "name">
): PackagingOption {
  return {
    code: overrides.id.toUpperCase(),
    category: "BOX",
    lengthCm: 40,
    widthCm: 30,
    heightCm: 18,
    onHandStock: 100,
    reservedStock: 0,
    active: true,
    ...overrides,
  };
}

const packages = [
  option({ id: "box-c", name: "Normal Box C" }),
  option({ id: "radius-s", name: "Radius Box Small", lengthCm: 15, widthCm: 11, heightCm: 5 }),
  option({ id: "sleeve-s", name: "Small Sleeve", category: "SLEEVE", lengthCm: 0, widthCm: 0, heightCm: 0 }),
];

const rules: DispatchPackagingRule[] = [
  { triggerPackagingTypeId: "radius-s", triggerDeviceModel: null, packagingTypeId: "sleeve-s", quantity: 1 },
];

const order: DispatchOrder = {
  orderId: "231500",
  destinationCountry: "BE",
  companyName: "Test",
  lineCount: 3,
  totalVolumeCm3: 9000,
  adjustedVolumeCm3: 9000,
  deviceCounts: { FMC880: 3 },
  items: [
    {
      name: "FMC880",
      lengthCm: 6,
      widthCm: 9,
      heightCm: 1.5,
      quantity: 3,
      unitVolumeCm3: 81,
      totalVolumeCm3: 243,
      sourceItem: "ATOM",
    } as DispatchOrder["items"][number],
  ],
};

describe("several packages per order", () => {
  it("keeps every package line of an order and applies the rules to each", () => {
    const plan = applyDispatchPackagingSelections(
      [order],
      packages,
      [
        { orderId: "231500", packagingTypeId: "box-c", quantity: 1, source: "manual" },
        { orderId: "231500", packagingTypeId: "radius-s", quantity: 2, source: "manual" },
      ],
      rules
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.orders[0].packages.map((p) => [p.name, p.quantity])).toEqual([
      ["Normal Box C", 1],
      ["Radius Box Small", 2],
    ]);
    expect(plan.orders[0].extras?.map((p) => [p.name, p.quantity])).toEqual([["Small Sleeve", 2]]);
    expect(plan.totalPackages).toBe(5);
  });

  it("adds up two lines of the same packaging", () => {
    const plan = applyDispatchPackagingSelections(
      [order],
      packages,
      [
        { orderId: "231500", packagingTypeId: "radius-s", quantity: 1, source: "manual" },
        { orderId: "231500", packagingTypeId: "radius-s", quantity: 2, source: "manual" },
      ],
      rules
    );
    expect(plan.orders[0].packages.map((p) => [p.name, p.quantity])).toEqual([["Radius Box Small", 3]]);
  });

  it("reuses a learned combination of packages", () => {
    const plan = applyDispatchPackagingSelections(
      [order],
      packages,
      [
        { orderId: "231500", packagingTypeId: "box-c", quantity: 1, source: "learned", learningCount: 3 },
        { orderId: "231500", packagingTypeId: "radius-s", quantity: 1, source: "learned", learningCount: 3 },
      ],
      rules
    );
    expect(plan.orders[0].packages.map((p) => [p.name, p.source, p.learningCount])).toEqual([
      ["Normal Box C", "learned", 3],
      ["Radius Box Small", "learned", 3],
    ]);
  });

  it("learns the whole combination in the database", () => {
    expect(migration.trimStart()).toMatch(/^begin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain("add column if not exists packages jsonb");
    expect(migration).toContain("jsonb_array_length(packages) between 1 and 20");
    expect(migration).toContain("jsonb_array_length(order_row.value -> 'packages') between 1 and 20");
    expect(migration).toContain("to service_role");
    // Older rows keep working through the first package columns.
    expect(previewRoute).toContain('result.error?.code === "42703"');
  });

  it("does not deduct orders that were already confirmed", () => {
    expect(previewRoute).toContain('.overlaps("order_ids", Array.from(allOrderIds))');
    expect(previewRoute).toContain("!confirmedOrders.has(order.orderId)");
    expect(previewRoute).toContain("carried_orders: carriedOrders");
    expect(translateUiText("fr", "3 orders already deducted earlier — not deducted again")).toBe(
      "3 commandes déjà retirées avant — pas retirées une 2e fois"
    );
    expect(translateUiText("nl", "+ Add box")).toBe("+ Doos toevoegen");
  });
});
