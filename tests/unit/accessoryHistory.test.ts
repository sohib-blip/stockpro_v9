import { describe, expect, it } from "vitest";
import { buildAccessoryHistoryRows } from "../../lib/accessory-history";

describe("accessory outbound history", () => {
  it("maps movement notes and accessory names for the history table", () => {
    const rows = buildAccessoryHistoryRows(
      [
        {
          id: "movement-1",
          created_at: "2026-07-17T00:00:00.000Z",
          shipment_ref: "SHIP-001",
          note: "Excel shipment",
          qty: 3,
          actor: "operator@example.com",
          source: "excel",
          movement_type: "OUT",
          accessory_bin_id: "accessory-1",
        },
      ],
      [{ id: "accessory-1", name: "QR Guide" }]
    );

    expect(rows).toEqual([
      {
        id: "movement-1",
        created_at: "2026-07-17T00:00:00.000Z",
        shipment_ref: "SHIP-001",
        comment: "Excel shipment",
        note: "Excel shipment",
        qty: 3,
        actor: "operator@example.com",
        source: "excel",
        movement_type: "OUT",
        accessory_name: "QR Guide",
      },
    ]);
  });

  it("keeps legacy rows readable when their accessory was deleted", () => {
    const [row] = buildAccessoryHistoryRows(
      [
        {
          id: "movement-2",
          created_at: "2026-07-17T00:00:00.000Z",
          shipment_ref: null,
          note: null,
          qty: 1,
          actor: null,
          source: "manual",
          movement_type: "OUT",
          accessory_bin_id: null,
        },
      ],
      []
    );

    expect(row.accessory_name).toBe("-");
    expect(row.comment).toBe("");
    expect(row.note).toBe("");
  });
});
