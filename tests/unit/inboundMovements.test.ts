import { describe, expect, it } from "vitest";

import { buildInboundMovementRows } from "../../lib/inbound/movements";

describe("buildInboundMovementRows", () => {
  it("references the bin through box_id instead of legacy device_id", () => {
    const rows = buildInboundMovementRows(
      [{ item_id: "item-1", imei: "123456789012345" }],
      {
        operationId: "operation-1",
        batchId: "batch-1",
        boxId: "box-for-fmc880",
        actorId: "user-1",
        actor: "tester@example.com",
        createdAt: "2026-07-16T18:00:00.000Z",
        notes: "vendor=teltonika",
      }
    );

    expect(rows).toEqual([
      {
        type: "IN",
        operation_id: "operation-1",
        batch_id: "batch-1",
        item_id: "item-1",
        box_id: "box-for-fmc880",
        imei: "123456789012345",
        qty: 1,
        created_by: "user-1",
        actor: "tester@example.com",
        created_at: "2026-07-16T18:00:00.000Z",
        notes: "vendor=teltonika",
      },
    ]);
    expect(rows[0]).not.toHaveProperty("device_id");
  });
});
