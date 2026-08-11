type InsertedInboundItem = {
  item_id: string;
  imei: string;
};

type InboundMovementContext = {
  operationId: string;
  batchId: string;
  boxId: string;
  binId: string;
  actorId: string;
  actor: string;
  createdAt: string;
  notes?: string | null;
};

/**
 * `movements.device_id` is a legacy column name that now stores a bin id.
 * Keeping it populated preserves movement history and outbound exports.
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
    device_id: context.binId,
    imei: item.imei,
    qty: 1,
    created_by: context.actorId,
    actor: context.actor || "unknown",
    created_at: context.createdAt,
    ...(context.notes ? { notes: context.notes } : {}),
  }));
}
