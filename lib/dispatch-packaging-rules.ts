// Automatic packaging rules for Dispatch Planning: extra packaging removed for
// every package of a format (Radius Box Small -> Small Sleeve) or for every
// device of a model (CNHYCV200XEU -> CV200 Sleeve). Kept free of the workbook
// parser so the page can recalculate them in the browser.

export type DispatchPackagingRule = {
  triggerPackagingTypeId: string | null;
  triggerDeviceModel: string | null;
  packagingTypeId: string;
  quantity: number;
  // The rule stops applying when the order holds more triggers than this
  // (e.g. no CV200 Sleeve once an order has 3 cameras or more).
  maxTriggerCount?: number | null;
};

export type DispatchPackagingExtra = {
  packagingTypeId: string;
  quantity: number;
};

function modelKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Only the chosen packages and the devices trigger rules; extras never add
// further extras.
export function dispatchPackagingRuleExtras(
  order: {
    deviceCounts?: Record<string, number>;
    packages: Array<{ packagingTypeId: string; quantity: number }>;
  },
  rules: DispatchPackagingRule[]
): DispatchPackagingExtra[] {
  const quantities = new Map<string, number>();
  for (const rule of rules) {
    let triggers = 0;
    if (rule.triggerPackagingTypeId) {
      for (const allocation of order.packages) {
        if (allocation.packagingTypeId === rule.triggerPackagingTypeId) {
          triggers += Number(allocation.quantity || 0);
        }
      }
    } else if (rule.triggerDeviceModel) {
      const key = modelKey(rule.triggerDeviceModel);
      for (const [model, count] of Object.entries(order.deviceCounts || {})) {
        if (modelKey(model) === key) triggers += Number(count || 0);
      }
    }
    if (rule.maxTriggerCount && triggers > rule.maxTriggerCount) continue;
    if (triggers > 0 && rule.quantity > 0) {
      quantities.set(
        rule.packagingTypeId,
        (quantities.get(rule.packagingTypeId) || 0) + triggers * rule.quantity
      );
    }
  }
  return Array.from(quantities, ([packagingTypeId, quantity]) => ({
    packagingTypeId,
    quantity,
  }));
}
