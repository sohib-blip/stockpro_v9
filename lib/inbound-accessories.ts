// Accessories delivered with a device model (Inventory Setup > Included at
// inbound). When those devices are received, the accessories are added to
// accessory stock by confirm_inbound_batch; this computes the same lines for
// the inbound preview, where each line can be unticked.

export type InboundAccessoryRule = {
  id: string;
  device_id: string;
  accessory_bin_id: string;
  accessory: string;
  quantity: number;
};

export type IncludedAccessoryLine = {
  ruleId: string;
  deviceId: string;
  accessory: string;
  perDevice: number;
  devices: number;
  qty: number;
};

export const MAX_INCLUDED_PER_DEVICE = 1000;

/** Accessories added for the new devices of each bin (bin id -> new devices). */
export function includedAccessoryLines(
  rules: InboundAccessoryRule[],
  newDevicesByBin: Record<string, number>
): IncludedAccessoryLine[] {
  return rules
    .filter((rule) => (newDevicesByBin[rule.device_id] || 0) > 0)
    .map((rule) => {
      const devices = newDevicesByBin[rule.device_id];
      return {
        ruleId: rule.id,
        deviceId: rule.device_id,
        accessory: rule.accessory,
        perDevice: rule.quantity,
        devices,
        qty: devices * rule.quantity,
      };
    })
    .sort((left, right) => left.accessory.localeCompare(right.accessory));
}
