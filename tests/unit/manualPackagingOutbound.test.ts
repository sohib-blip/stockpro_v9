import { describe, expect, it } from "vitest";
import type { DispatchPackagingRule } from "../../lib/dispatch-packaging-rules";
import {
  manualOutboundName,
  planManualPackagingOutbound,
  type PackagingOption,
} from "../../lib/dispatch-planning";
import { translateUiText } from "../../lib/i18n";

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

const packages = [
  option({ id: "radius-s", name: "Radius Box Small" }),
  option({ id: "sleeve-s", name: "Small Sleeve", category: "SLEEVE", onHandStock: 3 }),
  option({ id: "plastic-s", name: "Small Plastic Envelope", category: "PLASTIC_ENVELOPE" }),
  option({ id: "plastic-m", name: "Medium Plastic Envelope", category: "PLASTIC_ENVELOPE" }),
  option({ id: "box-old", name: "Old Box", active: false }),
];

const rules: DispatchPackagingRule[] = [
  { triggerPackagingTypeId: "radius-s", triggerDeviceModel: null, packagingTypeId: "sleeve-s", quantity: 1 },
  { triggerPackagingTypeId: "radius-s", triggerDeviceModel: null, packagingTypeId: "plastic-s", quantity: 1 },
  { triggerPackagingTypeId: null, triggerDeviceModel: "CNHYCV200XEU", packagingTypeId: "sleeve-s", quantity: 1 },
];

describe("manual packaging outbound", () => {
  it("deducts the chosen packaging plus the packaging rules", () => {
    const plan = planManualPackagingOutbound(
      "MANUAL-1",
      [
        { packagingTypeId: "radius-s", quantity: 1 },
        { packagingTypeId: "plastic-m", quantity: 1 },
        { packagingTypeId: "radius-s", quantity: 1 },
      ],
      packages,
      rules
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.orders).toHaveLength(1);
    const [order] = plan.orders;
    expect(order.orderId).toBe("MANUAL-1");
    expect(order.lineCount).toBe(2);
    // No composition key: a manual outbound never teaches the packaging choice.
    expect(order).not.toHaveProperty("compositionKey");
    expect(order.packages.map((p) => [p.name, p.quantity, p.source])).toEqual([
      ["Medium Plastic Envelope", 1, "manual"],
      ["Radius Box Small", 2, "manual"],
    ]);
    expect(order.extras?.map((p) => [p.name, p.quantity])).toEqual([
      ["Small Plastic Envelope", 2],
      ["Small Sleeve", 2],
    ]);
    expect(Object.fromEntries(plan.packageUsage.map((u) => [u.name, [u.quantity, u.stockAfter]]))).toEqual({
      "Medium Plastic Envelope": [1, 99],
      "Radius Box Small": [2, 98],
      "Small Plastic Envelope": [2, 98],
      "Small Sleeve": [2, 1],
    });
    expect(plan.totalPackages).toBe(7);
  });

  it("lets a sleeve be removed on its own without triggering rules", () => {
    const plan = planManualPackagingOutbound("M", [{ packagingTypeId: "sleeve-s", quantity: 2 }], packages, rules);
    expect(plan.blockers).toEqual([]);
    expect(plan.orders[0].extras).toBeUndefined();
    expect(plan.totalPackages).toBe(2);
  });

  it("blocks missing stock, inactive formats and empty lines", () => {
    expect(
      planManualPackagingOutbound("M", [{ packagingTypeId: "radius-s", quantity: 4 }], packages, rules).blockers
    ).toEqual(["Small Sleeve: 4 required, but only 3 available."]);
    expect(
      planManualPackagingOutbound("M", [{ packagingTypeId: "box-old", quantity: 1 }], packages, rules).blockers
    ).toEqual(["A selected packaging format is inactive or missing."]);
    expect(planManualPackagingOutbound("M", [], packages, rules).blockers).toEqual([
      "Add at least one packaging line.",
    ]);
    expect(
      planManualPackagingOutbound("M", [{ packagingTypeId: "radius-s", quantity: 0 }], packages, rules).blockers
    ).toContain("Every line needs a quantity between 1 and 1,000,000.");
  });

  it("names the history entry with the reference and comment", () => {
    expect(manualOutboundName("231500", "Damaged boxes")).toBe("Manual outbound · 231500 · Damaged boxes");
    expect(manualOutboundName("", "  ")).toBe("Manual outbound");
  });

  it("translates the manual mode", () => {
    expect(translateUiText("fr", "Manual packaging outbound")).toBe("Sortie manuelle d’emballages");
    expect(translateUiText("fr", "Radius Box Small — 550 available")).toBe("Radius Box Small — 550 disponibles");
    expect(translateUiText("nl", "7 packages deducted. You can undo it in Dispatch History.")).toBe(
      "7 verpakkingen afgeboekt. U kunt dit ongedaan maken in Dispatch History."
    );
  });
});
