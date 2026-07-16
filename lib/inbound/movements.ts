type InsertedInboundItem = {
  item_id: string;
  imei: string;
};

type InboundMovementContext = {
  operationId: string;
  batchId: string;
  boxId: string;
  actorId: string;
  actor: string;
  createdAt: string;
  notes?: string | null;
};

/**
 * `movements.device_id` still targets the legacy devices table. Inbound now
 * stores inventory by bin, so the bin must be referenced through `box_id`.
 */
export function buildInboundMovementRows(
  items: InsertedInboundItem[],
  context: InboundMovementContext
) {
  return items.map((item) => ({
    type: "IN",
    operation_id: context.operationId,
    batch_id: context.batchId,
    item_id: item.item_id,
    box_id: context.boxId,
    imei: item.imei,
    qty: 1,
    created_by: context.actorId,
    actor: context.actor || "unknown",
    created_at: context.createdAt,
    ...(context.notes ? { notes: context.notes } : {}),
  }));
}
