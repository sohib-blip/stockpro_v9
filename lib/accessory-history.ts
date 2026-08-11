export type AccessoryMovementHistoryRow = {
  id: string;
  created_at: string;
  shipment_ref: string | null;
  note: string | null;
  qty: number;
  actor: string | null;
  source: string | null;
  movement_type: string;
  accessory_bin_id: string | null;
};

export type AccessoryHistoryBin = {
  id: string;
  name: string;
};

export function buildAccessoryHistoryRows(
  movements: AccessoryMovementHistoryRow[],
  accessoryBins: AccessoryHistoryBin[]
) {
  const accessoryNames = new Map(
    accessoryBins.map((accessory) => [accessory.id, accessory.name])
  );

  return movements.map((movement) => ({
    id: movement.id,
    created_at: movement.created_at,
    shipment_ref: movement.shipment_ref,
    comment: movement.note || "",
    note: movement.note || "",
    qty: movement.qty,
    actor: movement.actor,
    source: movement.source,
    movement_type: movement.movement_type,
    accessory_name:
      (movement.accessory_bin_id
        ? accessoryNames.get(movement.accessory_bin_id)
        : null) || "-",
  }));
}
