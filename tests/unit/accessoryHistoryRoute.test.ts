import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("accessory outbound history route", () => {
  it("does not require a schema-specific actor column", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "app/api/accessories/outbound/history/route.ts"),
      "utf8"
    );

    expect(route).toContain('.from("accessory_movements")');
    expect(route).toContain('.select("*")');
    expect(route).toContain("movement.actor || movement.performed_by || null");
    expect(route).not.toContain(
      '"id,created_at,shipment_ref,note,qty,actor,source,movement_type,accessory_bin_id"'
    );
  });
});
